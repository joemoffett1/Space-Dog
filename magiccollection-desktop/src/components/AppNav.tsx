import type { AppTab } from '../types'

interface AppNavProps {
  activeTab: AppTab
  onSelectTab: (tab: AppTab) => void
}

const TABS: Array<{ id: AppTab; label: string; helper: string }> = [
  { id: 'collection', label: 'Collection', helper: 'Owned inventory' },
  { id: 'market', label: 'Market', helper: 'All cards + add flow' },
  { id: 'reports', label: 'Reports', helper: 'Stats and summaries' },
  { id: 'settings', label: 'Settings', helper: 'Profile and app options' },
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
          <span>{tab.label}</span>
          <small>{tab.helper}</small>
        </button>
      ))}
    </nav>
  )
}
