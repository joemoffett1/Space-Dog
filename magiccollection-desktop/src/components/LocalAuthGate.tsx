import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LocalAuthStatus } from '../lib/localAuth'

interface RegisterInput {
  username: string
  email?: string
  password: string
}

interface LoginInput {
  username: string
  password: string
}

interface LocalAuthGateProps {
  status: LocalAuthStatus
  onRegister: (input: RegisterInput) => Promise<boolean>
  onLogin: (input: LoginInput) => Promise<boolean>
  errorMessage?: string
  isBusy?: boolean
}

type AuthMode = 'login' | 'create'

export function LocalAuthGate({
  status,
  onRegister,
  onLogin,
  errorMessage = '',
  isBusy = false,
}: LocalAuthGateProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState(status.username ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState('')

  const hasAccount = status.hasAccount

  function clearError() {
    if (localError) {
      setLocalError('')
    }
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode)
    setLocalError('')
    setPassword('')
    setConfirmPassword('')
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedUsername = username.trim()
    const normalizedPassword = password.trim()
    if (!normalizedUsername) {
      setLocalError('Username is required.')
      return
    }
    if (normalizedPassword.length < 6) {
      setLocalError('Password must be at least 6 characters.')
      return
    }
    if (normalizedPassword !== confirmPassword.trim()) {
      setLocalError('Password confirmation does not match.')
      return
    }
    setLocalError('')
    const ok = await onRegister({
      username: normalizedUsername,
      email: email.trim() || undefined,
      password: normalizedPassword,
    })
    if (ok) {
      setPassword('')
      setConfirmPassword('')
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedUsername = username.trim()
    if (!normalizedUsername) {
      setLocalError('Username is required.')
      return
    }
    if (!password.trim()) {
      setLocalError('Password is required.')
      return
    }
    setLocalError('')
    const ok = await onLogin({
      username: normalizedUsername,
      password: password.trim(),
    })
    if (!ok) {
      setLocalError('Invalid username or password.')
      return
    }
    setPassword('')
  }

  return (
    <main className="gate-wrap">
      <section className="gate-card">
        <p className="app-kicker">MagicCollection Desktop</p>
        <h1>{mode === 'login' ? 'Local Sign In' : 'Create Local Account'}</h1>
        <p className="muted">
          Offline-first account on this device. Cloud sync can be linked later without
          changing collection data.
        </p>

        <div className="gate-mode-switch">
          <button
            type="button"
            className={`mode-pill ${mode === 'login' ? 'active' : ''}`}
            onClick={() => switchMode('login')}
            disabled={isBusy}
          >
            Login
          </button>
          <button
            type="button"
            className={`mode-pill ${mode === 'create' ? 'active' : ''}`}
            onClick={() => switchMode('create')}
            disabled={isBusy}
          >
            Create Account
          </button>
        </div>

        {mode === 'create' ? (
          <form className="create-wizard" onSubmit={handleRegister}>
            <label>
              <span className="step-label">Username</span>
              <input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value)
                  clearError()
                }}
                placeholder="Username"
                autoComplete="username"
                disabled={isBusy}
              />
            </label>
            <label>
              <span className="step-label">Email (optional)</span>
              <input
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  clearError()
                }}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={isBusy}
              />
            </label>
            <div className="passcode-grid">
              <label>
                <span className="step-label">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    clearError()
                  }}
                  placeholder="Minimum 6 characters"
                  autoComplete="new-password"
                  disabled={isBusy}
                />
              </label>
              <label>
                <span className="step-label">Confirm Password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value)
                    clearError()
                  }}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  disabled={isBusy}
                />
              </label>
            </div>
            {hasAccount ? (
              <p className="muted small">
                This device already has a local account. Sign in with the Login tab.
              </p>
            ) : null}
            <button className="button" type="submit" disabled={isBusy || hasAccount}>
              {isBusy
                ? 'Creating...'
                : hasAccount
                ? 'Account Already Exists'
                : 'Create Local Account'}
            </button>
          </form>
        ) : (
          <form className="create-wizard" onSubmit={handleLogin}>
            <label>
              <span className="step-label">Username</span>
              <input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value)
                  clearError()
                }}
                placeholder="Username"
                autoComplete="username"
                disabled={isBusy}
              />
            </label>
            <label>
              <span className="step-label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearError()
                }}
                placeholder="Password"
                autoComplete="current-password"
                disabled={isBusy}
              />
            </label>
            {!hasAccount ? (
              <p className="muted small">
                No local account found on this device yet. Open Create Account to start.
              </p>
            ) : null}
            <button className="button" type="submit" disabled={isBusy || !hasAccount}>
              {isBusy ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
        )}

        {localError ? <p className="error-line">{localError}</p> : null}
        {!localError && errorMessage ? <p className="error-line">{errorMessage}</p> : null}
      </section>
    </main>
  )
}
