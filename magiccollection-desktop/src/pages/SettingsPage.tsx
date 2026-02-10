import { useEffect, useState } from 'react'
import { getCatalogSyncStatus, getSyncDiagnostics } from '../lib/catalogSync'
import type { LocalAuthStatus } from '../lib/localAuth'
import { clearPerfMetrics, getPerfMetrics } from '../lib/perfMetrics'
import type { Profile } from '../types'

const ASSET_CREDITS = [
  {
    name: 'Tabler Icons',
    source: 'https://github.com/tabler/tabler-icons',
    terms: 'MIT License',
    usage: 'UI icon assets in /public/ui-icons.',
  },
  {
    name: 'Google Fonts',
    source: 'https://fonts.google.com/specimen/Space+Grotesk',
    terms: 'Open Font License (family-specific terms on Google Fonts)',
    usage: 'Primary UI typography (Space Grotesk + Orbitron).',
  },
  {
    name: 'Scryfall API',
    source: 'https://scryfall.com/docs/api',
    terms: 'Use subject to Scryfall API terms and rate limits.',
    usage: 'Card metadata, image URLs, market price references.',
  },
  {
    name: 'Card Kingdom Public Pricelist',
    source: 'https://api.cardkingdom.com/api/v2/pricelist',
    terms: 'Use subject to provider terms/policies.',
    usage: 'Buylist quote reporting.',
  },
]

interface SettingsPageProps {
  activeProfile: Profile
  onReturnToCollection: () => void
  localAuthStatus: LocalAuthStatus
  onMarkLocalAuthSynced: () => void
}

export function SettingsPage({
  activeProfile,
  onReturnToCollection,
  localAuthStatus,
  onMarkLocalAuthSynced,
}: SettingsPageProps) {
  const [syncStatusLine, setSyncStatusLine] = useState('Loading sync state...')
  const [diagnostics, setDiagnostics] = useState(getSyncDiagnostics())
  const [perfMetrics, setPerfMetrics] = useState(getPerfMetrics(12))

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      try {
        const status = await getCatalogSyncStatus()
        if (cancelled) {
          return
        }
        setSyncStatusLine(
          `Local ${status.localVersion ?? 'none'} / Latest ${status.latestVersion} / ${
            status.canRefreshNow ? 'Refresh Available' : 'Locked'
          }`,
        )
      } catch (error) {
        if (cancelled) {
          return
        }
        const message =
          error instanceof Error ? error.message : 'Unable to read sync status.'
        setSyncStatusLine(message)
      } finally {
        if (!cancelled) {
          setDiagnostics(getSyncDiagnostics())
          setPerfMetrics(getPerfMetrics(12))
        }
      }
    }

    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 10_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Settings</h2>
          <p className="muted">
            Early baseline settings. App storage currently uses local profile data.
          </p>
        </div>
      </div>

      <div className="setting-grid">
        <article className="report-card">
          <h3>Active Profile</h3>
          <p className="muted">Name</p>
          <strong>{activeProfile.name}</strong>
          <p className="muted">Created</p>
          <strong>{new Date(activeProfile.createdAt).toLocaleString()}</strong>
        </article>

        <article className="report-card">
          <h3>Roadmap Hooks</h3>
          <ul>
            <li>SQLite migration runner</li>
            <li>Scryfall bulk sync settings</li>
            <li>Card Kingdom refresh scheduling</li>
            <li>Optional cloud auth/sync</li>
          </ul>
          <button className="button" onClick={onReturnToCollection} type="button">
            Back to Collection
          </button>
        </article>

        <article className="report-card">
          <h3>Local Account</h3>
          <p className="muted">
            Status: {localAuthStatus.signedIn ? 'Signed In' : 'Signed Out'}
          </p>
          <p className="muted">User: {localAuthStatus.username ?? 'N/A'}</p>
          <p className="muted">
            Cloud sync: {localAuthStatus.syncPending ? 'Pending' : 'Synced'}
          </p>
          <p className="muted">
            Last cloud sync:{' '}
            {localAuthStatus.lastSyncedAt
              ? new Date(localAuthStatus.lastSyncedAt).toLocaleString()
              : 'Never'}
          </p>
          <button
            className="button subtle"
            type="button"
            onClick={onMarkLocalAuthSynced}
            disabled={!localAuthStatus.syncPending}
          >
            Mark Local Auth Synced
          </button>
        </article>

        <article className="report-card">
          <h3>Sync Diagnostics</h3>
          <p className="muted">{syncStatusLine}</p>
          <p className="muted">Outcome: {diagnostics.lastOutcome}</p>
          <p className="muted">
            Last run: {diagnostics.lastRunAt ? new Date(diagnostics.lastRunAt).toLocaleString() : 'N/A'}
          </p>
          <p className="muted">
            Strategy: {diagnostics.lastStrategy ?? 'N/A'}
          </p>
          <p className="muted">
            Duration: {diagnostics.lastDurationMs === null ? 'N/A' : `${diagnostics.lastDurationMs}ms`}
          </p>
          <p className="muted">Retries: {diagnostics.retryCount}</p>
          <p className="muted">Cancels: {diagnostics.cancelCount}</p>
          <p className="muted">In-flight joins: {diagnostics.inFlightJoinCount}</p>
          <p className="muted">Timeout: {diagnostics.timeoutMs}ms</p>
          {diagnostics.lastError ? (
            <p className="error-line">Last error: {diagnostics.lastError}</p>
          ) : null}
        </article>

        <article className="report-card">
          <h3>Performance Metrics</h3>
          {perfMetrics.length === 0 ? (
            <p className="muted">No local perf samples yet.</p>
          ) : (
            <ul>
              {perfMetrics
                .slice()
                .reverse()
                .map((metric) => (
                  <li key={`${metric.key}-${metric.at}`}>
                    <span>{metric.key}</span>
                    <strong>{metric.valueMs.toFixed(1)}ms</strong>
                  </li>
                ))}
            </ul>
          )}
          <button
            className="button subtle"
            type="button"
            onClick={() => {
              clearPerfMetrics()
              setPerfMetrics(getPerfMetrics(12))
            }}
          >
            Clear Perf History
          </button>
        </article>

        <article className="report-card">
          <h3>Credits And Licenses</h3>
          <p className="muted small">
            Full attribution ledger: <code>ASSET_CREDITS.md</code>
          </p>
          <ul>
            {ASSET_CREDITS.map((credit) => (
              <li key={credit.name}>
                <span>{credit.name}</span>
                <p className="muted small">{credit.terms}</p>
                <p className="muted small">Source: {credit.source}</p>
                <p className="muted small">{credit.usage}</p>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  )
}
