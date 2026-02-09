interface SyncPolicy {
  compactedThresholdMissed?: number
  forceFullThresholdMissed?: number
}

interface VersionEntry {
  version: string
  snapshot?: string
  snapshotHash?: string
  patchFromPrevious?: string
}

interface CompactedPatchEntry {
  fromVersion: string
  toVersion: string
  path: string
  patchHash?: string
  createdAt?: string
}

interface SyncManifest {
  dataset?: string
  latestVersion?: string
  latestSnapshot?: string
  latestHash?: string
  generatedAt?: string
  syncPolicy?: SyncPolicy
  versions?: VersionEntry[]
  compactedPatches?: CompactedPatchEntry[]
}

interface Env {
  SYNC_BUCKET: R2Bucket
  SYNC_PREFIX?: string
}

type Strategy = 'noop' | 'chain' | 'compacted' | 'full'

let manifestCache: { etag: string; payload: SyncManifest } | null = null

function asJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function normalizePrefix(value: string | undefined): string {
  const raw = (value || 'sync').trim().replace(/\\/g, '/')
  return raw.replace(/^\/+|\/+$/g, '')
}

function buildKey(prefix: string, relativePath: string): string {
  const rel = relativePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  return `${prefix}/${rel}`
}

async function getJsonFromR2<T>(
  env: Env,
  key: string,
): Promise<{ data: T | null; etag: string | null }> {
  const object = await env.SYNC_BUCKET.get(key)
  if (!object) {
    return { data: null, etag: null }
  }
  const text = await object.text()
  return {
    data: JSON.parse(text) as T,
    etag: object.httpEtag ?? null,
  }
}

async function getManifest(env: Env): Promise<SyncManifest | null> {
  const prefix = normalizePrefix(env.SYNC_PREFIX)
  const key = buildKey(prefix, 'manifest.json')
  const { data, etag } = await getJsonFromR2<SyncManifest>(env, key)
  if (!data) {
    return null
  }
  if (etag && manifestCache?.etag === etag) {
    return manifestCache.payload
  }
  if (etag) {
    manifestCache = { etag, payload: data }
  }
  return data
}

function chooseStrategy(manifest: SyncManifest, currentVersion: string | null): { strategy: Strategy; missed: number } {
  const versions = manifest.versions ?? []
  const latestVersion = manifest.latestVersion
  if (!versions.length || !latestVersion) {
    return { strategy: 'full', missed: 0 }
  }
  if (!currentVersion) {
    return { strategy: 'full', missed: versions.length }
  }

  const index = new Map<string, number>()
  versions.forEach((entry, idx) => {
    if (entry.version) {
      index.set(entry.version, idx)
    }
  })

  const latestIdx = index.get(latestVersion)
  const currentIdx = index.get(currentVersion)
  if (latestIdx === undefined || currentIdx === undefined) {
    return { strategy: 'full', missed: versions.length }
  }
  if (latestIdx === currentIdx) {
    return { strategy: 'noop', missed: 0 }
  }

  const missed = latestIdx - currentIdx
  const compactedThreshold = Math.max(1, manifest.syncPolicy?.compactedThresholdMissed ?? 5)
  const forceFullThreshold = Math.max(compactedThreshold + 1, manifest.syncPolicy?.forceFullThresholdMissed ?? 21)
  if (missed >= forceFullThreshold) {
    return { strategy: 'full', missed }
  }

  if (missed >= compactedThreshold) {
    const hasCompacted = (manifest.compactedPatches ?? []).some(
      (entry) => entry.fromVersion === currentVersion && entry.toVersion === latestVersion,
    )
    if (hasCompacted) {
      return { strategy: 'compacted', missed }
    }
  }

  return { strategy: 'chain', missed }
}

function resolveChainPatchPaths(
  manifest: SyncManifest,
  fromVersion: string,
  toVersion: string,
): string[] {
  const versions = manifest.versions ?? []
  const chainPaths: string[] = []
  let collecting = false

  for (const entry of versions) {
    if (entry.version === fromVersion) {
      collecting = true
      continue
    }

    if (collecting && entry.patchFromPrevious) {
      chainPaths.push(entry.patchFromPrevious)
    }

    if (entry.version === toVersion) {
      break
    }
  }

  return chainPaths
}

function findVersionEntry(manifest: SyncManifest, version: string): VersionEntry | null {
  return (manifest.versions ?? []).find((entry) => entry.version === version) ?? null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const manifest = await getManifest(env)
    if (!manifest) {
      return asJson({ error: 'manifest_missing' }, 500)
    }

    if (path === '/health') {
      return asJson({
        ok: true,
        dataset: manifest.dataset ?? 'default_cards',
        latestVersion: manifest.latestVersion ?? null,
        generatedAt: manifest.generatedAt ?? null,
      })
    }

    if (path === '/sync/status') {
      const current = url.searchParams.get('current')
      const decision = chooseStrategy(manifest, current)
      return asJson({
        dataset: manifest.dataset ?? 'default_cards',
        latestVersion: manifest.latestVersion ?? null,
        latestHash: manifest.latestHash ?? null,
        currentVersion: current,
        needsSync: current !== manifest.latestVersion,
        strategyHint: decision.strategy,
        missedCount: decision.missed,
        policy: manifest.syncPolicy ?? {},
      })
    }

    if (path === '/sync/patch') {
      const fromVersion = url.searchParams.get('from')
      const toVersion = url.searchParams.get('to') ?? manifest.latestVersion ?? ''
      const expand = url.searchParams.get('expand') === '1'
      if (!fromVersion) {
        return asJson({ error: 'missing_from' }, 400)
      }

      const decision = chooseStrategy(manifest, fromVersion)
      if (decision.strategy === 'full') {
        return asJson(
          { mode: 'full_required', latestVersion: manifest.latestVersion ?? null },
          409,
        )
      }
      if (decision.strategy === 'noop') {
        return asJson({ mode: 'noop', fromVersion, toVersion })
      }

      const prefix = normalizePrefix(env.SYNC_PREFIX)
      if (decision.strategy === 'compacted') {
        const compacted = (manifest.compactedPatches ?? []).find(
          (entry) => entry.fromVersion === fromVersion && entry.toVersion === toVersion,
        )
        if (!compacted) {
          return asJson({ error: 'patch_not_found' }, 404)
        }
        const compactedKey = buildKey(prefix, compacted.path)
        const { data } = await getJsonFromR2<Record<string, unknown>>(env, compactedKey)
        if (!data) {
          return asJson({ error: 'patch_file_missing' }, 404)
        }
        return asJson(data)
      }

      const paths = resolveChainPatchPaths(manifest, fromVersion, toVersion)
      if (!paths.length) {
        return asJson({ error: 'patch_not_found' }, 404)
      }

      if (!expand) {
        return asJson({
          mode: 'chain',
          fromVersion,
          toVersion,
          patches: paths,
        })
      }

      const payloads: unknown[] = []
      for (const relPath of paths) {
        const { data } = await getJsonFromR2<Record<string, unknown>>(
          env,
          buildKey(prefix, relPath),
        )
        if (!data) {
          return asJson({ error: 'patch_file_missing', path: relPath }, 404)
        }
        payloads.push(data)
      }
      return asJson({
        mode: 'chain',
        fromVersion,
        toVersion,
        patches: payloads,
      })
    }

    if (path === '/sync/snapshot') {
      const targetVersion = url.searchParams.get('version') ?? manifest.latestVersion ?? ''
      const includeRecords = url.searchParams.get('includeRecords') === '1'
      const versionEntry = findVersionEntry(manifest, targetVersion)
      const snapshotPath = versionEntry?.snapshot ?? manifest.latestSnapshot
      const snapshotHash = versionEntry?.snapshotHash ?? manifest.latestHash ?? null
      if (!snapshotPath) {
        return asJson({ error: 'snapshot_not_found' }, 404)
      }

      const payload: Record<string, unknown> = {
        version: targetVersion,
        snapshotPath,
        snapshotHash,
      }

      if (includeRecords) {
        const prefix = normalizePrefix(env.SYNC_PREFIX)
        const { data } = await getJsonFromR2<unknown[]>(env, buildKey(prefix, snapshotPath))
        if (!data) {
          return asJson({ error: 'snapshot_file_missing' }, 404)
        }
        payload.records = data
      }

      return asJson(payload)
    }

    return asJson({ error: 'not_found' }, 404)
  },
}
