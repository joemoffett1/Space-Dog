import type { AppTab } from '../types'

interface AppNavProps {
  activeTab: AppTab
  onSelectTab: (tab: AppTab) => void
}

const TABS: Array<{ id: AppTab; label: string; helper: string; glyph: string }> = [
  { id: 'collection', label: 'Collection', helper: 'Owned inventory', glyph: 'C' },
  { id: 'market', label: 'Market', helper: 'All cards + add flow', glyph: 'M' },
  { id: 'reports', label: 'Reports', helper: 'Stats and summaries', glyph: 'R' },
  { id: 'settings', label: 'Settings', helper: 'Profile and app options', glyph: 'S' },
]

export function AppNav({ activeTab, onSelectTab }: AppNavProps) {
  return (
    <nav className="app-nav" aria-label="Primary">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onSelectTab(tab.id)}
          type="button"
        >
          <span className="tab-glyph" aria-hidden="true">
            {tab.glyph}
          </span>
          <span className="tab-copy">
            <span className="tab-label">{tab.label}</span>
            <small>{tab.helper}</small>
          </span>
        </button>
      ))}
    </nav>
  )
}
