export interface PerfMetric {
  key: string
  valueMs: number
  at: string
}

const PERF_KEY = 'magiccollection.perf.metrics.v1'
const MAX_METRICS = 100

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function readMetrics(): PerfMetric[] {
  if (!hasWindow()) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(PERF_KEY)
    if (!raw) {
      return []
    }
    return JSON.parse(raw) as PerfMetric[]
  } catch {
    return []
  }
}

function writeMetrics(metrics: PerfMetric[]): void {
  if (!hasWindow()) {
    return
  }
  window.localStorage.setItem(PERF_KEY, JSON.stringify(metrics.slice(-MAX_METRICS)))
}

export function recordPerfMetric(key: string, valueMs: number): void {
  if (!Number.isFinite(valueMs)) {
    return
  }
  const next = [
    ...readMetrics(),
    {
      key,
      valueMs: Math.max(0, Math.round(valueMs * 100) / 100),
      at: new Date().toISOString(),
    },
  ]
  writeMetrics(next)
}

export function getPerfMetrics(limit = 20): PerfMetric[] {
  const all = readMetrics()
  return all.slice(Math.max(0, all.length - limit))
}

export function clearPerfMetrics(): void {
  if (!hasWindow()) {
    return
  }
  window.localStorage.removeItem(PERF_KEY)
}
