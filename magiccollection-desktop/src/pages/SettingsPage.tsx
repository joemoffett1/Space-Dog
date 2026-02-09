import type { Profile } from '../types'

interface SettingsPageProps {
  activeProfile: Profile
  onReturnToCollection: () => void
}

export function SettingsPage({
  activeProfile,
  onReturnToCollection,
}: SettingsPageProps) {
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
      </div>
    </section>
  )
}
