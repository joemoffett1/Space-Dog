import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, UIEvent } from 'react'
import type { OwnedCard, PriceDirection } from '../types'

type CollectionViewMode = 'text' | 'image' | 'compact'

interface CollectionPageProps {
  profileName: string
  cards: OwnedCard[]
  onIncrement: (cardId: string, foil: boolean) => Promise<void>
  onDecrement: (cardId: string, foil: boolean) => Promise<void>
  onRemove: (cardId: string) => Promise<void>
  onTagCard: (cardId: string, tag: string) => Promise<void>
  onOpenMarket: () => void
  onImportArchidektCsv: (file: File) => Promise<{
    rowsImported: number
    copiesImported: number
    rowsSkipped: number
  }>
  isSyncing?: boolean
}

interface VersionRow {
  scryfallId: string
  setCode: string
  collectorNumber: string
  releasedAt: string | null
  imageUrl: string | null
  ownedQuantity: number
  ownedFoilQuantity: number
}

const VIRTUAL_HEIGHT = 560
const TEXT_ROW_HEIGHT = 46
const COMPACT_ROW_HEIGHT = 44
const OVERSCAN = 12
const IMAGE_PAGE_SIZE = 140

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '--'
  }
  return `$${value.toFixed(2)}`
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

function deltaText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '--'
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'Unknown'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleDateString()
}

function fallbackScryfallImageUrl(scryfallId: string): string {
  return `https://api.scryfall.com/cards/${encodeURIComponent(
    scryfallId,
  )}?format=image&version=normal`
}

async function fetchVersionsForCard(
  name: string,
  ownedByScryfallId: Map<string, OwnedCard>,
): Promise<VersionRow[]> {
  const query = encodeURIComponent(`!"${name}"`)
  const url = `https://api.scryfall.com/cards/search?q=${query}&unique=prints&order=released&dir=asc`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Unable to load versions from Scryfall (${response.status}).`)
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id?: string
      set?: string
      collector_number?: string
      released_at?: string
      image_uris?: { normal?: string }
      card_faces?: Array<{ image_uris?: { normal?: string } }>
    }>
  }

  return (payload.data ?? [])
    .map((entry) => {
      const scryfallId = entry.id ?? ''
      if (!scryfallId) {
        return null
      }
      const owned = ownedByScryfallId.get(scryfallId)
      const normalImage =
        entry.image_uris?.normal ?? entry.card_faces?.[0]?.image_uris?.normal ?? null

      return {
        scryfallId,
        setCode: (entry.set ?? '').toUpperCase(),
        collectorNumber: entry.collector_number ?? '',
        releasedAt: entry.released_at ?? null,
        imageUrl: normalImage,
        ownedQuantity: owned?.quantity ?? 0,
        ownedFoilQuantity: owned?.foilQuantity ?? 0,
      } as VersionRow
    })
    .filter((entry): entry is VersionRow => entry !== null)
    .sort((a, b) => {
      const aOwned = a.ownedQuantity + a.ownedFoilQuantity > 0 ? 1 : 0
      const bOwned = b.ownedQuantity + b.ownedFoilQuantity > 0 ? 1 : 0
      if (aOwned !== bOwned) {
        return bOwned - aOwned
      }
      return (a.releasedAt ?? '').localeCompare(b.releasedAt ?? '')
    })
}

export function CollectionPage({
  profileName,
  cards,
  onIncrement,
  onDecrement,
  onRemove,
  onTagCard,
  onOpenMarket,
  onImportArchidektCsv,
  isSyncing = false,
}: CollectionPageProps) {
  const [importMessage, setImportMessage] = useState('')
  const [importError, setImportError] = useState('')
  const [viewMode, setViewMode] = useState<CollectionViewMode>('text')
  const [searchTerm, setSearchTerm] = useState('')
  const [listScrollTop, setListScrollTop] = useState(0)
  const [imageLimit, setImageLimit] = useState(IMAGE_PAGE_SIZE)
  const [versionAnchor, setVersionAnchor] = useState<OwnedCard | null>(null)
  const [versionRows, setVersionRows] = useState<VersionRow[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [versionError, setVersionError] = useState('')
  const [foilModeByCard, setFoilModeByCard] = useState<Record<string, boolean>>({})
  const [activeTagByCard, setActiveTagByCard] = useState<Record<string, string>>({})

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const uniqueCards = cards.length
  const totalCards = cards.reduce((sum, card) => sum + card.quantity + card.foilQuantity, 0)
  const totalFoils = cards.reduce((sum, card) => sum + card.foilQuantity, 0)

  const pricedCards = cards.filter((card) => card.currentPrice !== null)
  const estimatedMarket = pricedCards.reduce(
    (sum, card) => sum + (card.currentPrice ?? 0) * (card.quantity + card.foilQuantity),
    0,
  )

  const versionCountsByName = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const card of cards) {
      const key = normalize(card.name)
      if (!map.has(key)) {
        map.set(key, new Set())
      }
      map.get(key)?.add(card.scryfallId)
    }

    const counts = new Map<string, number>()
    for (const [key, ids] of map.entries()) {
      counts.set(key, ids.size)
    }
    return counts
  }, [cards])

  const ownedByScryfallId = useMemo(() => {
    const map = new Map<string, OwnedCard>()
    for (const card of cards) {
      map.set(card.scryfallId, card)
    }
    return map
  }, [cards])

  const filteredCards = useMemo(() => {
    const needle = normalize(searchTerm)
    if (!needle) {
      return cards
    }

    return cards.filter((card) => {
      if (normalize(card.name).includes(needle)) {
        return true
      }
      if (normalize(card.setCode).includes(needle)) {
        return true
      }
      if (normalize(card.collectorNumber).includes(needle)) {
        return true
      }
      return card.tags.some((tag) => normalize(tag).includes(needle))
    })
  }, [cards, searchTerm])

  useEffect(() => {
    setListScrollTop(0)
    listRef.current?.scrollTo({ top: 0 })
    setImageLimit(IMAGE_PAGE_SIZE)
  }, [viewMode, searchTerm])

  const rowHeight = viewMode === 'compact' ? COMPACT_ROW_HEIGHT : TEXT_ROW_HEIGHT
  const totalHeight = filteredCards.length * rowHeight
  const startIndex = Math.max(0, Math.floor(listScrollTop / rowHeight) - OVERSCAN)
  const visibleCount = Math.ceil(VIRTUAL_HEIGHT / rowHeight) + OVERSCAN * 2
  const endIndex = Math.min(filteredCards.length, startIndex + visibleCount)
  const visibleRows = filteredCards.slice(startIndex, endIndex)
  const topPad = startIndex * rowHeight
  const bottomPad = Math.max(0, totalHeight - topPad - visibleRows.length * rowHeight)

  const visibleImageCards = filteredCards.slice(0, imageLimit)

  function handleChooseCsvFile() {
    fileInputRef.current?.click()
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    setImportError('')
    setImportMessage('')
    try {
      const result = await onImportArchidektCsv(file)
      setImportMessage(
        `Imported ${result.rowsImported} rows (${result.copiesImported} copies). Skipped ${result.rowsSkipped}.`,
      )
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to import Archidekt CSV.')
    }
  }

  function handleVirtualScroll(event: UIEvent<HTMLDivElement>) {
    setListScrollTop(event.currentTarget.scrollTop)
  }

  function toggleFoilMode(cardId: string) {
    setFoilModeByCard((previous) => ({ ...previous, [cardId]: !previous[cardId] }))
  }

  function toggleTagSelection(cardId: string, tag: string) {
    setActiveTagByCard((previous) => {
      if (previous[cardId] === tag) {
        const copy = { ...previous }
        delete copy[cardId]
        return copy
      }
      return { ...previous, [cardId]: tag }
    })
  }

  async function handleAdjust(card: OwnedCard, delta: 1 | -1) {
    const useFoil = !!foilModeByCard[card.scryfallId]
    if (delta > 0) {
      await onIncrement(card.scryfallId, useFoil)
    } else {
      await onDecrement(card.scryfallId, useFoil)
    }

    const selectedTag = activeTagByCard[card.scryfallId]
    if (selectedTag) {
      await onTagCard(card.scryfallId, selectedTag)
    }
  }

  async function handleOpenVersions(card: OwnedCard) {
    setVersionAnchor(card)
    setVersionError('')
    setIsLoadingVersions(true)
    try {
      const rows = await fetchVersionsForCard(card.name, ownedByScryfallId)
      setVersionRows(rows)
    } catch (error) {
      setVersionRows([])
      setVersionError(error instanceof Error ? error.message : 'Failed to load versions.')
    } finally {
      setIsLoadingVersions(false)
    }
  }

  function handleCloseVersions() {
    setVersionAnchor(null)
    setVersionRows([])
    setVersionError('')
  }

  return (
    <section className="panel collection-panel">
      <div className="panel-head">
        <div>
          <h2>{profileName} Collection</h2>
          <p className="muted">Collection-first view with quantity controls, tags, and market movement.</p>
        </div>
        <div className="collection-actions">
          <button className="button" onClick={onOpenMarket} type="button">
            Open Market
          </button>
          <button className="button subtle" onClick={handleChooseCsvFile} type="button" disabled={isSyncing}>
            Import Archidekt CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileSelected} style={{ display: 'none' }} />
        </div>
      </div>

      <div className="collection-toolbar">
        <div className="view-toggle">
          <button className={`mode-pill ${viewMode === 'text' ? 'active' : ''}`} onClick={() => setViewMode('text')} type="button">
            Text View
          </button>
          <button className={`mode-pill ${viewMode === 'image' ? 'active' : ''}`} onClick={() => setViewMode('image')} type="button">
            Image View
          </button>
          <button className={`mode-pill ${viewMode === 'compact' ? 'active' : ''}`} onClick={() => setViewMode('compact')} type="button">
            Compact View
          </button>
        </div>
        <input className="collection-search" type="search" placeholder="Search cards, set, number, or tags" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
      </div>

      {importMessage ? <p className="muted">{importMessage}</p> : null}
      {importError ? <p className="error-line">{importError}</p> : null}

      <div className="stat-strip">
        <article className="stat-chip"><h3>Unique Cards</h3><strong>{uniqueCards}</strong></article>
        <article className="stat-chip"><h3>Total Copies</h3><strong>{totalCards}</strong></article>
        <article className="stat-chip"><h3>Foil Copies</h3><strong>{totalFoils}</strong></article>
        <article className="stat-chip"><h3>Est. Market</h3><strong>{formatUsd(estimatedMarket)}</strong></article>
      </div>

      {cards.length === 0 ? (
        <div className="empty-state">
          <h3>No cards tracked yet</h3>
          <p className="muted">Open Market and add cards to begin building this collection profile.</p>
        </div>
      ) : (
        <>
          <p className="muted small">Showing {filteredCards.length} of {cards.length} printings.</p>
          {viewMode === 'image' ? (
            <>
              <div className="collection-image-grid">
                {visibleImageCards.map((card) => {
                  const total = card.quantity + card.foilQuantity
                  const versions = versionCountsByName.get(normalize(card.name)) ?? 1
                  const imageSrc = card.imageUrl ?? fallbackScryfallImageUrl(card.scryfallId)
                  const foilMode = !!foilModeByCard[card.scryfallId]
                  const activeTag = activeTagByCard[card.scryfallId]

                  return (
                    <article key={card.scryfallId} className="collection-image-card">
                      <button className="ghost-side-button ghost-side-button-left" type="button" onClick={() => void handleAdjust(card, 1)} title={foilMode ? 'Add foil' : 'Add nonfoil'}>
                        +
                      </button>
                      <button className="ghost-side-button ghost-side-button-right" type="button" onClick={() => void handleAdjust(card, -1)} title={foilMode ? 'Remove foil' : 'Remove nonfoil'}>
                        -
                      </button>

                      <button className="image-card-button" type="button" onClick={() => void handleOpenVersions(card)}>
                        <div className="card-image-wrap">
                          <img src={imageSrc} alt={card.name} loading="lazy" />
                        </div>
                      </button>

                      <div className="market-card-body">
                        <button className="linkish-title" type="button" onClick={() => void handleOpenVersions(card)}>{card.name}</button>
                        <p className="muted small">{card.setCode.toUpperCase()} #{card.collectorNumber} · versions owned {versions}</p>

                        <div className="price-line">
                          <span className="price-current">{formatUsd(card.currentPrice)}</span>
                          <span className={`trend trend-${card.priceDirection}`}>{trendGlyph(card.priceDirection)} {deltaText(card.priceDelta)}</span>
                        </div>

                        <div className="tag-line">
                          {card.tags.slice(0, 5).map((tag) => (
                            <button
                              key={`${card.scryfallId}-${tag}`}
                              type="button"
                              className={`tag-chip tag-chip-button ${activeTag === tag ? 'selected' : ''}`}
                              onClick={() => toggleTagSelection(card.scryfallId, tag)}
                            >
                              {tag.toUpperCase()}
                            </button>
                          ))}
                        </div>

                        <div className="row-actions">
                          <span className="muted small">Qty {total}</span>
                          <button
                            className={`foil-check ${foilMode ? 'active' : ''}`}
                            type="button"
                            onClick={() => toggleFoilMode(card.scryfallId)}
                            title="Toggle foil mode for + and -"
                          >
                            ✓ Foil Mode
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>

              {imageLimit < filteredCards.length ? (
                <div className="centered-row">
                  <button className="button subtle" type="button" onClick={() => setImageLimit((current) => current + IMAGE_PAGE_SIZE)}>
                    Load More
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="virtual-list-shell">
              <div className={`collection-head-row ${viewMode === 'compact' ? 'compact' : ''}`}>
                <span>Card</span>
                {viewMode === 'text' ? (
                  <>
                    <span>Set</span><span>#</span><span>Tags</span><span>Price</span><span>Trend</span>
                  </>
                ) : null}
                {viewMode === 'compact' ? <span>Versions</span> : null}
                <span>Nonfoil</span><span>Foil</span><span>Total</span><span>Actions</span>
              </div>
              <div ref={listRef} className="virtual-list" onScroll={handleVirtualScroll} style={{ height: `${VIRTUAL_HEIGHT}px` }}>
                <div style={{ height: `${topPad}px` }} />
                {visibleRows.map((card) => {
                  const total = card.quantity + card.foilQuantity
                  const versions = versionCountsByName.get(normalize(card.name)) ?? 1

                  return (
                    <div key={card.scryfallId} className={`collection-row ${viewMode === 'compact' ? 'compact' : ''}`}>
                      <button className="linkish-title" type="button" onClick={() => void handleOpenVersions(card)}>{card.name}</button>
                      {viewMode === 'text' ? (
                        <>
                          <span>{card.setCode.toUpperCase()}</span>
                          <span>{card.collectorNumber}</span>
                          <div className="tag-line inline">{card.tags.slice(0, 3).map((tag) => <span key={`${card.scryfallId}-${tag}`} className="tag-chip">{tag.toUpperCase()}</span>)}</div>
                          <span>{formatUsd(card.currentPrice)}</span>
                          <span className={`trend trend-${card.priceDirection}`}>{trendGlyph(card.priceDirection)} {deltaText(card.priceDelta)}</span>
                        </>
                      ) : null}
                      {viewMode === 'compact' ? <span className="muted">{versions}</span> : null}
                      <span>{card.quantity}</span><span>{card.foilQuantity}</span><span>{total}</span>
                      <div className="row-actions">
                        <button className="button tiny" onClick={() => void onIncrement(card.scryfallId, false)} type="button">+N</button>
                        <button className="button tiny subtle" onClick={() => void onIncrement(card.scryfallId, true)} type="button">+F</button>
                        <button className="button tiny subtle" onClick={() => void onDecrement(card.scryfallId, false)} type="button">-N</button>
                        <button className="button tiny subtle" onClick={() => void onDecrement(card.scryfallId, true)} type="button">-F</button>
                        <button className="button tiny danger" onClick={() => void onRemove(card.scryfallId)} type="button">Remove</button>
                      </div>
                    </div>
                  )
                })}
                <div style={{ height: `${bottomPad}px` }} />
              </div>
            </div>
          )}
        </>
      )}

      {versionAnchor ? (
        <section className="version-panel">
          <div className="version-head">
            <div>
              <h3>{versionAnchor.name} Versions</h3>
              <p className="muted small">Owned versions are at the top. Unowned prints are dimmed and sorted by release date.</p>
            </div>
            <button className="button subtle tiny" type="button" onClick={handleCloseVersions}>Close</button>
          </div>

          {isLoadingVersions ? <p className="muted">Loading versions from Scryfall...</p> : null}
          {versionError ? <p className="error-line">{versionError}</p> : null}

          {!isLoadingVersions && !versionError ? (
            <div className="version-grid">
              {versionRows.map((row) => {
                const total = row.ownedQuantity + row.ownedFoilQuantity
                const owned = total > 0
                return (
                  <article key={row.scryfallId} className={`version-card ${owned ? 'owned' : 'unowned'}`}>
                    <div className="version-image-wrap"><img src={row.imageUrl ?? fallbackScryfallImageUrl(row.scryfallId)} alt={`${versionAnchor.name} ${row.setCode}`} loading="lazy" /></div>
                    <div className="version-body">
                      <p>{row.setCode} #{row.collectorNumber}</p>
                      <p className="muted small">Released {formatDate(row.releasedAt)}</p>
                      <p className="small">Owned: {row.ownedQuantity} nonfoil / {row.ownedFoilQuantity} foil</p>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  )
}
