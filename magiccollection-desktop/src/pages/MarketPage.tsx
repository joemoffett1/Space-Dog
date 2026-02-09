import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
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
const DISPLAY_LIMIT = 120
const DISPLAY_PAGE_SIZE = 30
const SAVED_QUERIES_KEY = 'magiccollection.market.saved-queries.v1'
const HELPER_QUERIES = [
  'is:foil',
  'rarity:mythic',
  'set:lea',
  't:legendary',
  'c>=3',
]

function validateQuery(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) {
    return ''
  }
  const quoteCount = (trimmed.match(/"/g) ?? []).length
  if (quoteCount % 2 !== 0) {
    return 'Query warning: unmatched quote detected.'
  }
  if (trimmed.length < 2) {
    return 'Query warning: very short query may return broad results.'
  }
  return ''
}

function parseScryfallUrlToQuery(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.includes('scryfall.com/card/')) {
    return ''
  }
  try {
    const url = new URL(trimmed)
    const segments = url.pathname.split('/').filter(Boolean)
    const nameSegment = segments[3] ?? ''
    if (!nameSegment) {
      return ''
    }
    const cardName = decodeURIComponent(nameSegment).replace(/-/g, ' ').trim()
    return cardName ? `!"${cardName}"` : ''
  } catch {
    return ''
  }
}

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
  const [visibleLimit, setVisibleLimit] = useState(DISPLAY_PAGE_SIZE)
  const [savedQueries, setSavedQueries] = useState<string[]>([])
  const [activeCard, setActiveCard] = useState<MarketCard | null>(null)
  const [queryWarning, setQueryWarning] = useState('')
  const searchAbortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<number | null>(null)

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
    setVisibleLimit(DISPLAY_PAGE_SIZE)

    if (searchAbortRef.current) {
      searchAbortRef.current.abort()
    }
    const controller = new AbortController()
    searchAbortRef.current = controller

    try {
      const endpoint = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(
        trimmedQuery,
      )}&order=name&dir=asc&unique=prints`
      const response = await fetch(endpoint, { signal: controller.signal })

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
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to load market data.',
      )
      setResults([])
    } finally {
      searchAbortRef.current = null
      setIsLoading(false)
    }
  }, [mergeTrends])

  useEffect(() => {
    runSearch(DEFAULT_QUERY)
  }, [runSearch])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_QUERIES_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        setSavedQueries(parsed.filter((entry) => !!entry.trim()).slice(0, 12))
      }
    } catch {
      setSavedQueries([])
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      const trimmed = queryInput.trim()
      if (!trimmed || trimmed === queryLabel) {
        return
      }
      void runSearch(trimmed)
    }, 420)

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
      }
    }
  }, [queryInput, queryLabel, runSearch])

  useEffect(() => {
    setQueryWarning(validateQuery(queryInput))
  }, [queryInput])

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

  function appendHelperQuery(fragment: string) {
    const current = queryInput.trim()
    const next = current ? `${current} ${fragment}` : fragment
    setQueryInput(next)
  }

  function applyDroppedText(text: string) {
    const normalized = text.trim()
    if (!normalized) {
      return
    }
    const query = parseScryfallUrlToQuery(normalized) || normalized
    setQueryInput(query)
    void runSearch(query)
  }

  function saveCurrentQuery() {
    const trimmed = queryLabel.trim()
    if (!trimmed) {
      return
    }
    const next = [trimmed, ...savedQueries.filter((entry) => entry !== trimmed)].slice(0, 12)
    setSavedQueries(next)
    window.localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(next))
  }

  const visibleResults = results.slice(0, visibleLimit)

  async function handleKeyboardAction(
    event: KeyboardEvent<HTMLElement>,
    card: MarketCard,
  ) {
    if (event.key === 'Enter') {
      event.preventDefault()
      setActiveCard(card)
      return
    }
    if (event.key === '+') {
      event.preventDefault()
      await onAddCard({
        scryfallId: card.scryfallId,
        name: card.name,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
        imageUrl: card.imageUrl,
        foil: false,
        currentPrice: card.currentPrice,
        tags: card.tags,
      })
      return
    }
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault()
      await onAddCard({
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
          onPaste={(event) => {
            const text = event.clipboardData.getData('text/plain')
            const parsed = parseScryfallUrlToQuery(text)
            if (parsed) {
              event.preventDefault()
              applyDroppedText(parsed)
            }
          }}
          onDrop={(event) => {
            const text = event.dataTransfer.getData('text/plain')
            if (!text) {
              return
            }
            event.preventDefault()
            applyDroppedText(text)
          }}
          onDragOver={(event) => {
            event.preventDefault()
          }}
          placeholder="Scryfall query, e.g. set:lea, oracle:draw"
          aria-label="Scryfall search query"
        />
        <button className="button" type="submit" disabled={isLoading}>
          {isLoading ? 'Searching...' : 'Search'}
        </button>
        <button className="button subtle" type="button" onClick={saveCurrentQuery}>
          Save Query
        </button>
      </form>

      <p className="muted small">Showing up to {DISPLAY_LIMIT} results for: {queryLabel}</p>
      <div className="tag-line">
        {HELPER_QUERIES.map((helper) => (
          <button
            key={helper}
            className="tag-chip tag-chip-button"
            type="button"
            onClick={() => appendHelperQuery(helper)}
          >
            {helper}
          </button>
        ))}
      </div>

      {savedQueries.length > 0 ? (
        <div className="tag-line">
          {savedQueries.map((saved) => (
            <button
              key={saved}
              className="tag-chip tag-chip-button selected"
              type="button"
              onClick={() => {
                setQueryInput(saved)
                void runSearch(saved)
              }}
            >
              {saved}
            </button>
          ))}
        </div>
      ) : null}

      {errorMessage ? <p className="error-line">{errorMessage}</p> : null}
      {queryWarning ? <p className="muted small">{queryWarning}</p> : null}

      <div className="market-grid">
        {visibleResults.map((card, index) => {
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
              onDoubleClick={() => setActiveCard(card)}
              tabIndex={0}
              onKeyDown={(event) => {
                void handleKeyboardAction(event, card)
              }}
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
                <button className="linkish-title" type="button" onClick={() => setActiveCard(card)}>
                  <h3>{card.name}</h3>
                </button>
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

      {visibleLimit < results.length ? (
        <div className="centered-row">
          <button
            className="button subtle"
            type="button"
            onClick={() => setVisibleLimit((current) => current + DISPLAY_PAGE_SIZE)}
          >
            Load More Results
          </button>
        </div>
      ) : null}

      {activeCard ? (
        <section className="version-panel">
          <div className="version-head">
            <div>
              <h3>{activeCard.name}</h3>
              <p className="muted small">
                Printings with owned/unowned visibility and quick add controls.
              </p>
            </div>
            <button className="button subtle tiny" type="button" onClick={() => setActiveCard(null)}>
              Close
            </button>
          </div>
          <div className="version-grid">
            {[...results]
              .filter((row) => row.name === activeCard.name)
              .sort((a, b) => {
                const aOwned = ownedCards[a.scryfallId] ? 1 : 0
                const bOwned = ownedCards[b.scryfallId] ? 1 : 0
                if (aOwned !== bOwned) {
                  return bOwned - aOwned
                }
                return a.setCode.localeCompare(b.setCode)
              })
              .map((row) => {
                const owned = ownedCards[row.scryfallId]
                const totalOwned = (owned?.quantity ?? 0) + (owned?.foilQuantity ?? 0)
                return (
                  <article
                    key={`detail-${row.scryfallId}`}
                    className={`version-card ${totalOwned > 0 ? 'owned' : 'unowned'}`}
                  >
                    <div className="version-image-wrap">
                      {row.imageUrl ? (
                        <img src={row.imageUrl} alt={row.name} loading="lazy" />
                      ) : null}
                    </div>
                    <div className="version-body">
                      <p>{row.setCode.toUpperCase()} #{row.collectorNumber}</p>
                      <p className="muted small">Owned: {totalOwned}</p>
                      <div className="row-actions">
                        <button
                          className="button tiny"
                          type="button"
                          onClick={() =>
                            onAddCard({
                              scryfallId: row.scryfallId,
                              name: row.name,
                              setCode: row.setCode,
                              collectorNumber: row.collectorNumber,
                              imageUrl: row.imageUrl,
                              foil: false,
                              currentPrice: row.currentPrice,
                              tags: row.tags,
                            })
                          }
                        >
                          +N
                        </button>
                        <button
                          className="button tiny subtle"
                          type="button"
                          onClick={() =>
                            onAddCard({
                              scryfallId: row.scryfallId,
                              name: row.name,
                              setCode: row.setCode,
                              collectorNumber: row.collectorNumber,
                              imageUrl: row.imageUrl,
                              foil: true,
                              currentPrice: row.currentPrice,
                              tags: row.tags,
                            })
                          }
                        >
                          +F
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
          </div>
        </section>
      ) : null}
    </section>
  )
}
