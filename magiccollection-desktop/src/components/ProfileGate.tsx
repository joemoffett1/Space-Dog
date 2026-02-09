import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { verifyProfilePasscode } from '../lib/profileAuth'
import type { CreateProfileRequest, Profile } from '../types'

type GateMode = 'open' | 'create'

interface ProfileGateProps {
  profiles: Profile[]
  protectedProfileIds: Set<string>
  onCreateProfile: (input: CreateProfileRequest) => Promise<boolean>
  onOpenProfile: (profileId: string) => Promise<boolean>
  errorMessage?: string
  isSyncing?: boolean
}

export function ProfileGate({
  profiles,
  protectedProfileIds,
  onCreateProfile,
  onOpenProfile,
  errorMessage = '',
  isSyncing = false,
}: ProfileGateProps) {
  const [mode, setMode] = useState<GateMode>('open')
  const [localError, setLocalError] = useState('')
  const [selectedOpenProfileId, setSelectedOpenProfileId] = useState<string | null>(null)
  const [openPasscode, setOpenPasscode] = useState('')
  const [createName, setCreateName] = useState('')
  const [protectWithPasscode, setProtectWithPasscode] = useState(false)
  const [createPasscode, setCreatePasscode] = useState('')
  const [confirmPasscode, setConfirmPasscode] = useState('')

  const effectiveSelectedOpenProfileId = selectedOpenProfileId ?? profiles[0]?.id ?? null
  const selectedOpenProfile = useMemo(
    () => profiles.find((profile) => profile.id === effectiveSelectedOpenProfileId) ?? null,
    [profiles, effectiveSelectedOpenProfileId],
  )

  function resetCreateWizard() {
    setCreateName('')
    setProtectWithPasscode(false)
    setCreatePasscode('')
    setConfirmPasscode('')
  }

  function clearErrors() {
    if (localError) {
      setLocalError('')
    }
  }

  function switchMode(nextMode: GateMode) {
    setMode(nextMode)
    clearErrors()
    setSelectedOpenProfileId(null)
    setOpenPasscode('')
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = createName.trim()
    if (!normalizedName) {
      setLocalError('Collection name is required for new collection setup.')
      return
    }

    if (protectWithPasscode) {
      const normalizedPasscode = createPasscode.trim()
      if (normalizedPasscode.length < 4) {
        setLocalError('Passcode must be at least 4 characters.')
        return
      }
      if (normalizedPasscode !== confirmPasscode.trim()) {
        setLocalError('Passcode confirmation does not match.')
        return
      }
    }

    setLocalError('')
    const created = await onCreateProfile({
      name: normalizedName,
      passcode: protectWithPasscode ? createPasscode.trim() : undefined,
    })
    if (created) {
      resetCreateWizard()
    }
  }

  function handleOpenSelection(profileId: string) {
    setLocalError('')
    setSelectedOpenProfileId(profileId)
    setOpenPasscode('')
  }

  async function handleOpenSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!effectiveSelectedOpenProfileId) {
      setLocalError('Select a collection to open.')
      return
    }

    const locked = protectedProfileIds.has(effectiveSelectedOpenProfileId)
    if (locked && !openPasscode.trim()) {
      setLocalError('Enter your passcode to open this collection.')
      return
    }

    if (locked && !verifyProfilePasscode(effectiveSelectedOpenProfileId, openPasscode)) {
      setLocalError('Invalid passcode for this collection.')
      return
    }

    setLocalError('')
    const opened = await onOpenProfile(effectiveSelectedOpenProfileId)
    if (opened) {
      setSelectedOpenProfileId(null)
      setOpenPasscode('')
    }
  }

  return (
    <main className="gate-wrap">
      <section className="gate-card">
        <p className="app-kicker">MagicCollection Desktop</p>
        <h1>Collection Access</h1>
        <p className="muted">
          Open an existing collection or create a new one with optional local passcode protection.
        </p>

        <div className="gate-mode-switch">
          <button
            type="button"
            className={`mode-pill ${mode === 'open' ? 'active' : ''}`}
            onClick={() => switchMode('open')}
            disabled={isSyncing}
          >
            Open Collection
          </button>
          <button
            type="button"
            className={`mode-pill ${mode === 'create' ? 'active' : ''}`}
            onClick={() => switchMode('create')}
            disabled={isSyncing}
          >
            Create New
          </button>
        </div>

        {mode === 'open' && (
          <section className="gate-section">
            <h2>Open Collection</h2>
            {profiles.length === 0 ? (
              <p className="muted">No collections yet. Switch to Create New to start one.</p>
            ) : (
              <div className="existing-profile-list">
                {profiles.map((profile) => {
                  const locked = protectedProfileIds.has(profile.id)
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      className={`profile-row ${effectiveSelectedOpenProfileId === profile.id ? 'selected' : ''}`}
                      onClick={() => handleOpenSelection(profile.id)}
                      disabled={isSyncing}
                    >
                      <div className="profile-row-main">
                        <span>{profile.name}</span>
                        <small>{new Date(profile.createdAt).toLocaleDateString()}</small>
                      </div>
                      <span className={`lock-chip ${locked ? 'locked' : 'open'}`}>
                        {locked ? 'Passcode' : 'Open'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {selectedOpenProfile ? (
              <form className="unlock-form" onSubmit={handleOpenSubmit}>
                <h3>Selected: {selectedOpenProfile.name}</h3>
                {protectedProfileIds.has(selectedOpenProfile.id) ? (
                  <input
                    type="password"
                    value={openPasscode}
                    onChange={(event) => {
                      setOpenPasscode(event.target.value)
                      clearErrors()
                    }}
                    placeholder="Collection passcode"
                    disabled={isSyncing}
                    aria-label="Collection passcode"
                  />
                ) : (
                  <p className="muted">No passcode required for this collection.</p>
                )}
                <div className="unlock-actions">
                  <button className="button" type="submit" disabled={isSyncing}>
                    {isSyncing ? 'Opening...' : 'Open Collection'}
                  </button>
                  <button
                    className="button subtle"
                    type="button"
                    onClick={() => {
                      setSelectedOpenProfileId(null)
                      setOpenPasscode('')
                      clearErrors()
                    }}
                    disabled={isSyncing}
                  >
                    Clear Selection
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        )}

        {mode === 'create' && (
          <section className="gate-section">
            <h2>Create New Collection</h2>
            <form className="create-wizard" onSubmit={handleCreateSubmit}>
              <label>
                <span className="step-label">Step 1: Collection Name</span>
                <input
                  value={createName}
                  onChange={(event) => {
                    setCreateName(event.target.value)
                    clearErrors()
                  }}
                  placeholder="Collection name"
                  aria-label="Collection name"
                  disabled={isSyncing}
                />
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={protectWithPasscode}
                  onChange={(event) => {
                    setProtectWithPasscode(event.target.checked)
                    clearErrors()
                  }}
                  disabled={isSyncing}
                />
                <span>Require local passcode on open</span>
              </label>

              {protectWithPasscode ? (
                <div className="passcode-grid">
                  <label>
                    <span className="step-label">Step 2: Passcode</span>
                    <input
                      type="password"
                      value={createPasscode}
                      onChange={(event) => {
                        setCreatePasscode(event.target.value)
                        clearErrors()
                      }}
                      placeholder="Minimum 4 characters"
                      aria-label="Collection passcode"
                      disabled={isSyncing}
                    />
                  </label>
                  <label>
                    <span className="step-label">Confirm Passcode</span>
                    <input
                      type="password"
                      value={confirmPasscode}
                      onChange={(event) => {
                        setConfirmPasscode(event.target.value)
                        clearErrors()
                      }}
                      placeholder="Re-enter passcode"
                      aria-label="Confirm collection passcode"
                      disabled={isSyncing}
                    />
                  </label>
                </div>
              ) : null}

              <button className="button" type="submit" disabled={isSyncing}>
                {isSyncing ? 'Creating...' : 'Create Collection'}
              </button>
            </form>
          </section>
        )}

        {localError ? <p className="error-line">{localError}</p> : null}
        {!localError && errorMessage ? <p className="error-line">{errorMessage}</p> : null}
      </section>
    </main>
  )
}
