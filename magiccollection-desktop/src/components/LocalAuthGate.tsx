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

export function LocalAuthGate({
  status,
  onRegister,
  onLogin,
  errorMessage = '',
  isBusy = false,
}: LocalAuthGateProps) {
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
        <h1>{hasAccount ? 'Local Sign In' : 'Create Local Account'}</h1>
        <p className="muted">
          Offline-first account on this device. Cloud sync can be linked later without
          changing collection data.
        </p>

        {!hasAccount ? (
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
            <button className="button" type="submit" disabled={isBusy}>
              {isBusy ? 'Creating...' : 'Create Local Account'}
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
            <button className="button" type="submit" disabled={isBusy}>
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
