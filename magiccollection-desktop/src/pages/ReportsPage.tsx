import { useMemo, useState } from 'react'
import { buildCkSellIntentUrl, loadCkBuylistQuotes } from '../lib/ckAdapter'
import type { OwnedCard } from '../types'

interface ReportsPageProps {
  cards: OwnedCard[]
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

export function ReportsPage({ cards }: ReportsPageProps) {
  const [isLoadingCk, setIsLoadingCk] = useState(false)
  const [ckWarning, setCkWarning] = useState('')
  const [ckProvider, setCkProvider] = useState<'mock' | 'api' | 'disabled' | 'public'>('disabled')
  const [ckEnabled, setCkEnabled] = useState(false)
  const [ckQuotes, setCkQuotes] = useState<
    Array<{
      scryfallId: string
      name: string
      quantity: number
      cashPrice: number
      creditPrice: number
      qtyCap: number
      sourceUrl: string
    }>
  >([])

  const totalCopies = cards.reduce(
    (sum, card) => sum + card.quantity + card.foilQuantity,
    0,
  )
  const foilCopies = cards.reduce((sum, card) => sum + card.foilQuantity, 0)
  const nonFoilCopies = totalCopies - foilCopies

  const topCards = [...cards]
    .sort(
      (a, b) =>
        b.quantity + b.foilQuantity - (a.quantity + a.foilQuantity) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 8)

  const bySet = cards.reduce<Record<string, number>>((acc, card) => {
    const key = card.setCode.toUpperCase()
    acc[key] = (acc[key] ?? 0) + card.quantity + card.foilQuantity
    return acc
  }, {})

  const topSets = Object.entries(bySet)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const ckMetrics = useMemo(() => {
    if (!ckQuotes.length) {
      return {
        cashTotal: 0,
        creditTotal: 0,
        coveredCopies: 0,
      }
    }

    let cashTotal = 0
    let creditTotal = 0
    let coveredCopies = 0

    for (const quote of ckQuotes) {
      const acceptedQty = Math.max(0, Math.min(quote.quantity, quote.qtyCap))
      if (acceptedQty <= 0) {
        continue
      }
      coveredCopies += acceptedQty
      cashTotal += acceptedQty * quote.cashPrice
      creditTotal += acceptedQty * quote.creditPrice
    }

    return { cashTotal, creditTotal, coveredCopies }
  }, [ckQuotes])

  const coveragePct = totalCopies > 0 ? (ckMetrics.coveredCopies / totalCopies) * 100 : 0
  const topCkQuotes = [...ckQuotes]
    .sort((a, b) => b.cashPrice - a.cashPrice)
    .slice(0, 8)

  async function handleLoadCkQuotes() {
    setIsLoadingCk(true)
    setCkWarning('')
    try {
      const result = await loadCkBuylistQuotes(cards)
      setCkEnabled(result.enabled)
      setCkProvider(result.provider)
      setCkQuotes(result.quotes)
      setCkWarning(result.warning ?? '')
    } catch (error) {
      setCkEnabled(false)
      setCkProvider('disabled')
      setCkQuotes([])
      setCkWarning(error instanceof Error ? error.message : 'Unable to load CK quotes.')
    } finally {
      setIsLoadingCk(false)
    }
  }

  function handleSellIntent() {
    if (!ckQuotes.length) {
      return
    }
    const url = buildCkSellIntentUrl(ckQuotes)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Reports</h2>
          <p className="muted">
            Baseline analytics panel with early CK buylist metrics and sell-intent handoff.
          </p>
        </div>
      </div>

      <div className="stat-strip">
        <article className="stat-chip">
          <h3>Total Copies</h3>
          <strong>{totalCopies}</strong>
        </article>
        <article className="stat-chip">
          <h3>Nonfoil</h3>
          <strong>{nonFoilCopies}</strong>
        </article>
        <article className="stat-chip">
          <h3>Foil</h3>
          <strong>{foilCopies}</strong>
        </article>
      </div>

      <div className="report-grids">
        <article className="report-card">
          <h3>Top Cards by Quantity</h3>
          {topCards.length === 0 ? (
            <p className="muted">No data yet.</p>
          ) : (
            <ul>
              {topCards.map((card) => (
                <li key={card.scryfallId}>
                  <span>{card.name}</span>
                  <strong>{card.quantity + card.foilQuantity}</strong>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="report-card">
          <h3>Top Sets by Quantity</h3>
          {topSets.length === 0 ? (
            <p className="muted">No data yet.</p>
          ) : (
            <ul>
              {topSets.map(([setCode, qty]) => (
                <li key={setCode}>
                  <span>{setCode}</span>
                  <strong>{qty}</strong>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <div className="report-grids">
        <article className="report-card">
          <h3>CK Buylist Snapshot</h3>
          <p className="muted">Provider: {ckProvider}</p>
          <p className="muted">Coverage: {coveragePct.toFixed(1)}%</p>
          <p className="muted">Cash payout: {formatUsd(ckMetrics.cashTotal)}</p>
          <p className="muted">Credit payout: {formatUsd(ckMetrics.creditTotal)}</p>
          {ckWarning ? <p className="muted small">{ckWarning}</p> : null}
          <div className="row-actions">
            <button className="button tiny" type="button" onClick={() => void handleLoadCkQuotes()} disabled={isLoadingCk}>
              {isLoadingCk ? 'Loading...' : 'Refresh CK Quotes'}
            </button>
            <button className="button tiny subtle" type="button" onClick={handleSellIntent} disabled={!ckEnabled || !ckQuotes.length}>
              Sell to CK
            </button>
          </div>
        </article>

        <article className="report-card">
          <h3>Top CK Buylist Cards</h3>
          {topCkQuotes.length === 0 ? (
            <p className="muted">Load CK quotes to view buylist candidates.</p>
          ) : (
            <ul>
              {topCkQuotes.map((quote) => (
                <li key={quote.scryfallId}>
                  <span>{quote.name}</span>
                  <strong>{formatUsd(quote.cashPrice)}</strong>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  )
}
