import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { getMarketPriceTrends, recordMarketSnapshots } from '../lib/backend'
import type {
  AddCardInput,
  MarketCard,
  MarketSnapshotInput,
  MarketTrend,
  OwnedCardMap,
  PriceDirection,
} from '../types'

interface ScryfallCardResponse {
  id: string
  name: string
  set: string
  collector_number: string
  image_uris?: {
    normal?: string
  }
  card_faces?: Array<{
    image_uris?: {
      normal?: string
    }
  }>
  prices?: {
    usd?: string | null
  }
}

interface ScryfallSearchResponse {
  data?: ScryfallCardResponse[]
}

type MarketAddInput = Omit<AddCardInput, 'profileId'>

interface MarketPageProps {
  profileId: string
  ownedCards: OwnedCardMap
  onAddCard: (card: MarketAddInput) => Promise<void>
}

const DEFAULT_QUERY = 'game:paper unique:prints'
const DISPLAY_LIMIT = 60

function parseUsd(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function inferTagSet(totalOwned: number, foilOwned: number): string[] {
  const tags: string[] = []
  if (totalOwned > 0) {
    tags.push('owned')
  }
  if (foilOwned > 0) {
    tags.push('foil')
  }
  if (totalOwned >= 4) {
    tags.push('playset')
  }
  return tags
}

function toMarketCard(card: ScryfallCardResponse): MarketCard {
  return {
    scryfallId: card.id,
    name: card.name,
    setCode: card.set,
    collectorNumber: card.collector_number,
    imageUrl: card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal,
    currentPrice: parseUsd(card.prices?.usd),
    previousPrice: null,
    priceDelta: null,
    priceDirection: 'none',
    lastPriceAt: null,
    tags: [],
  }
}

function toTrendMap(trends: MarketTrend[]): Record<string, MarketTrend> {
  return trends.reduce<Record<string, MarketTrend>>((acc, trend) => {
    acc[trend.scryfallId] = trend
    return acc
  }, {})
}

function trendGlyph(direction: PriceDirection): string {
  if (direction === 'up') {
    return '^'
  }
  if (direction === 'down') {
    return 'v'
  }
  if (direction === 'flat') {
    return '='
  }
  return '-'
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '--'
  }
  return `$${value.toFixed(2)}`
}

export default function MarketPage({
  profileId,
  ownedCards,
  onAddCard,
}: MarketPageProps) {
  const [queryInput, setQueryInput] = useState(DEFAULT_QUERY)
  const [queryLabel, setQueryLabel] = useState(DEFAULT_QUERY)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [results, setResults] = useState<MarketCard[]>([])
  const [isSyncingPrices, setIsSyncingPrices] = useState(false)

  const ownedTotals = useMemo(() => {
    return Object.values(ownedCards).reduce(
      (sum, card) => sum + card.quantity + card.foilQuantity,
      0,
    )
  }, [ownedCards])

  const mergeTrends = useCallback(async (cards: MarketCard[]) => {
    if (!cards.length) {
      return
    }

    const snapshotBatch: MarketSnapshotInput[] = cards
      .filter(
        (card) => typeof card.currentPrice === 'number' && Number.isFinite(card.currentPrice),
      )
      .map((card) => ({
        scryfallId: card.scryfallId,
        name: card.name,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
        imageUrl: card.imageUrl,
        marketPrice: card.currentPrice,
      }))

    setIsSyncingPrices(true)
    try {
      await recordMarketSnapshots(snapshotBatch)
      const trends = await getMarketPriceTrends(cards.map((card) => card.scryfallId))
      const trendMap = toTrendMap(trends)

      setResults((current) =>
        current.map((card) => {
          const trend = trendMap[card.scryfallId]
          const merged = trend
            ? {
                ...card,
                currentPrice: trend.currentPrice ?? card.currentPrice,
                previousPrice: trend.previousPrice,
                priceDelta: trend.priceDelta,
                priceDirection: trend.priceDirection,
                lastPriceAt: trend.lastPriceAt,
              }
            : card

          const owned = ownedCards[card.scryfallId]
          const totalOwned = (owned?.quantity ?? 0) + (owned?.foilQuantity ?? 0)
          const foilOwned = owned?.foilQuantity ?? 0
          const inferredTags = inferTagSet(totalOwned, foilOwned)

          return {
            ...merged,
            tags: [...new Set([...(owned?.tags ?? []), ...inferredTags])],
          }
        }),
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to sync market price movement.',
      )
    } finally {
      setIsSyncingPrices(false)
    }
  }, [ownedCards])

  const runSearch = useCallback(async (query: string) => {
    const trimmedQuery = query.trim() || DEFAULT_QUERY
    setQueryLabel(trimmedQuery)
    setErrorMessage('')
    setIsLoading(true)

    try {
      const endpoint = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(
        trimmedQuery,
      )}&order=name&dir=asc&unique=prints`
      const response = await fetch(endpoint)

      if (!response.ok) {
        if (response.status === 404) {
          setResults([])
          setErrorMessage('No cards matched this query.')
          return
        }

        throw new Error(`Scryfall request failed with status ${response.status}`)
      }

      const payload = (await response.json()) as ScryfallSearchResponse
      const cards = (payload.data ?? []).slice(0, DISPLAY_LIMIT).map(toMarketCard)

      setResults(cards)
      void mergeTrends(cards)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to load market data.',
      )
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [mergeTrends])

  useEffect(() => {
    runSearch(DEFAULT_QUERY)
  }, [runSearch])

  useEffect(() => {
    if (!results.length) {
      return
    }

    setResults((current) =>
      current.map((card) => {
        const owned = ownedCards[card.scryfallId]
        const totalOwned = (owned?.quantity ?? 0) + (owned?.foilQuantity ?? 0)
        const foilOwned = owned?.foilQuantity ?? 0
        return {
          ...card,
          tags: [...new Set([...(owned?.tags ?? []), ...inferTagSet(totalOwned, foilOwned)])],
        }
      }),
    )
  }, [ownedCards, results.length])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    runSearch(queryInput)
  }

  return (
    <section className="panel market-panel">
      <div className="panel-head">
        <div>
          <h2>Market</h2>
          <p className="muted">
            Scryfall-driven market browser with ownership tags and price movement
            indicators.
          </p>
        </div>
        <div className="market-summary">
          <span className="profile-pill">Profile: {profileId.slice(0, 8)}</span>
          <span className="profile-pill">Owned cards: {ownedTotals}</span>
          <span className="profile-pill">Loaded: {results.length}</span>
          <span className="profile-pill">
            {isSyncingPrices ? 'Syncing trends...' : 'Trends synced'}
          </span>
        </div>
      </div>

      <form className="market-search" onSubmit={handleSubmit}>
        <input
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder="Scryfall query, e.g. set:lea, oracle:draw"
          aria-label="Scryfall search query"
        />
        <button className="button" type="submit" disabled={isLoading}>
          {isLoading ? 'Searching...' : 'Search'}
        </button>
      </form>

      <p className="muted small">Showing up to {DISPLAY_LIMIT} results for: {queryLabel}</p>

      {errorMessage ? <p className="error-line">{errorMessage}</p> : null}

      <div className="market-grid">
        {results.map((card, index) => {
          const owned = ownedCards[card.scryfallId]
          const totalOwned = (owned?.quantity ?? 0) + (owned?.foilQuantity ?? 0)
          const foilOwned = owned?.foilQuantity ?? 0
          const trendClass = `trend trend-${card.priceDirection}`
          const deltaText =
            card.priceDelta === null ? '--' : `${card.priceDelta >= 0 ? '+' : ''}${card.priceDelta.toFixed(2)}`

          return (
            <article
              key={card.scryfallId}
              className="market-card"
              style={{ animationDelay: `${index * 12}ms` }}
            >
              <div className="card-image-wrap">
                {totalOwned > 0 ? (
                  <div className="overlay-badges">
                    <span className="badge badge-owned">Owned {totalOwned}</span>
                    {foilOwned > 0 ? (
                      <span className="badge badge-foil">Foil {foilOwned}</span>
                    ) : null}
                  </div>
                ) : null}
                {card.imageUrl ? (
                  <img src={card.imageUrl} alt={card.name} loading="lazy" />
                ) : (
                  <div className="image-fallback">
                    <span>No image</span>
                  </div>
                )}
              </div>

              <div className="market-card-body">
                <h3>{card.name}</h3>
                <p className="muted small">
                  {card.setCode.toUpperCase()} #{card.collectorNumber}
                </p>

                <div className="price-line">
                  <span className="price-current">{formatUsd(card.currentPrice)}</span>
                  <span className={trendClass}>
                    {trendGlyph(card.priceDirection)} {deltaText}
                  </span>
                </div>

                <div className="tag-line">
                  {card.tags.length === 0 ? (
                    <span className="tag-chip muted">No tags</span>
                  ) : (
                    card.tags.slice(0, 4).map((tag) => (
                      <span key={`${card.scryfallId}-${tag}`} className="tag-chip">
                        {tag.toUpperCase()}
                      </span>
                    ))
                  )}
                </div>

                <div className="market-actions">
                  <button
                    className="button tiny"
                    type="button"
                    onClick={() =>
                      onAddCard({
                        scryfallId: card.scryfallId,
                        name: card.name,
                        setCode: card.setCode,
                        collectorNumber: card.collectorNumber,
                        imageUrl: card.imageUrl,
                        foil: false,
                        currentPrice: card.currentPrice,
                        tags: card.tags,
                      })
                    }
                  >
                    + Nonfoil
                  </button>
                  <button
                    className="button tiny subtle"
                    type="button"
                    onClick={() =>
                      onAddCard({
                        scryfallId: card.scryfallId,
                        name: card.name,
                        setCode: card.setCode,
                        collectorNumber: card.collectorNumber,
                        imageUrl: card.imageUrl,
                        foil: true,
                        currentPrice: card.currentPrice,
                        tags: card.tags,
                      })
                    }
                  >
                    + Foil
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
