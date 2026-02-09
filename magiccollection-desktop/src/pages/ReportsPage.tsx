import type { OwnedCard } from '../types'

interface ReportsPageProps {
  cards: OwnedCard[]
}

export function ReportsPage({ cards }: ReportsPageProps) {
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

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Reports</h2>
          <p className="muted">
            Baseline analytics panel. Full `cardBuy` stat parity will be layered here next.
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
    </section>
  )
}
