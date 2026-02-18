import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, UIEvent } from 'react'
import { createPortal } from 'react-dom'
import { getCollectionPriceTrendsBySource, getFilterTokens, syncFilterTokens } from '../lib/backend'
import { ImportWizardModal } from '../components/ImportWizardModal'
import type {
  AddCardInput,
  CollectionImportRow,
  FilterToken,
  OwnedCard,
  PriceDirection,
  UpdateOwnedCardMetadataInput,
} from '../types'

type CollectionViewMode = 'text' | 'image'
type FinishFilter = 'all' | 'any-foil' | 'nonfoil-only'
type RowDensity = 'comfortable' | 'balanced' | 'dense'
type SortColumn =
  | 'card'
  | 'set'
  | 'number'
  | 'type'
  | 'color'
  | 'tags'
  | 'location'
  | 'condition'
  | 'language'
  | 'dateAdded'
  | 'purchasePrice'
  | 'price'
  | 'trend'
  | 'nonfoil'
  | 'foil'
  | 'total'
  | 'versions'
  | 'updated'
type SortDirection = 'asc' | 'desc'
type PriceByMode = 'unit' | 'position'
type TextColumnId =
  | 'set'
  | 'number'
  | 'type'
  | 'color'
  | 'tags'
  | 'location'
  | 'condition'
  | 'language'
  | 'dateAdded'
  | 'purchasePrice'
  | 'price'
  | 'trend'
  | 'updated'
type TextColumnState = Record<TextColumnId, boolean>
type CollectionModalMode = 'versions' | 'add'

interface CollectionPageProps {
  profileId: string
  profileName: string
  cards: OwnedCard[]
  onIncrement: (cardId: string, foil: boolean) => Promise<void>
  onDecrement: (cardId: string, foil: boolean) => Promise<void>
  onAddPrinting: (input: Omit<AddCardInput, 'profileId'>) => Promise<void>
  onRemove: (cardId: string) => Promise<void>
  onRemoveSelected: (cardIds: string[]) => Promise<void>
  onTagCard: (cardId: string, tag: string) => Promise<void>
  onUpdateMetadata: (
    cardId: string,
    metadata: Omit<UpdateOwnedCardMetadataInput, 'profileId' | 'scryfallId'>,
  ) => Promise<void>
  onBulkUpdateMetadata: (
    cardIds: string[],
    metadata: Omit<UpdateOwnedCardMetadataInput, 'profileId' | 'scryfallId'>,
  ) => Promise<void>
  onOpenMarket: () => void
  onUndoLastAction: () => Promise<void>
  canUndo: boolean
  undoLabel?: string
  onImportCollectionRows: (rows: CollectionImportRow[]) => Promise<void>
  onHydrateTypeMetadata?: () => Promise<void>
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

interface AddMenuCard {
  scryfallId: string
  name: string
  setCode: string
  collectorNumber: string
  releasedAt: string | null
  imageUrl: string | null
  typeLine: string | null
  colorIdentity: string[]
  manaValue: number | null
  rarity: string | null
  marketPrice: number | null
}

interface ManaComparator {
  op: '<' | '<=' | '=' | '>=' | '>'
  value: number
}

interface ParsedSearchPlan {
  freeText: string[]
  setCodes: string[]
  typeTerms: string[]
  tags: string[]
  colorContains: string[]
  colorExact: string | null
  rarities: string[]
  languages: string[]
  conditions: string[]
  foilMode: 'any' | 'foil' | 'nonfoil'
  manaComparators: ManaComparator[]
}

interface SearchTermBox {
  token: string
  kind: string
}

const VIRTUAL_HEIGHT = 560
const OVERSCAN = 12
const IMAGE_PAGE_SIZE = 140
const CONDITION_OPTIONS = ['NM', 'LP', 'MP', 'HP', 'DMG']
const LANGUAGE_OPTIONS = ['en', 'jp', 'de', 'fr', 'it', 'es', 'pt', 'ko', 'ru', 'zhs', 'zht']
const COLOR_SYMBOLS = ['W', 'U', 'B', 'R', 'G']
const ADD_RESULT_LIMIT = 80
const SYSTEM_TAGS = new Set(['owned', 'foil', 'playset'])
const TEXT_COLUMNS: Array<{ id: TextColumnId; label: string }> = [
  { id: 'set', label: 'Set' },
  { id: 'number', label: '#' },
  { id: 'type', label: 'Type' },
  { id: 'color', label: 'Color' },
  { id: 'tags', label: 'Tags' },
  { id: 'location', label: 'Location' },
  { id: 'condition', label: 'Condition' },
  { id: 'language', label: 'Language' },
  { id: 'dateAdded', label: 'Date Added' },
  { id: 'purchasePrice', label: 'Purchase' },
  { id: 'price', label: 'Price' },
  { id: 'trend', label: 'Trend' },
  { id: 'updated', label: 'Updated' },
]
const DENSITY_ROW_HEIGHT: Record<RowDensity, number> = {
  comfortable: 54,
  balanced: 46,
  dense: 38,
}
const DENSITY_IMAGE_MIN_WIDTH: Record<RowDensity, number> = {
  comfortable: 182,
  balanced: 170,
  dense: 158,
}
const PRICE_SOURCE_OPTIONS = [
  { id: 'tcg-low', label: 'TCGplayer Low', providerId: 3, channelId: 6 },
  { id: 'tcg-market', label: 'TCGplayer Market', providerId: 3, channelId: 4 },
  { id: 'tcg-high', label: 'TCGplayer High', providerId: 3, channelId: 8 },
  { id: 'ck-sell', label: 'CK Sell', providerId: 2, channelId: 11 },
  { id: 'ck-buylist', label: 'CK Buylist', providerId: 2, channelId: 10 },
] as const
type PriceSourceId = (typeof PRICE_SOURCE_OPTIONS)[number]['id']
const SEARCH_FIELD_PREFIXES = [
  'set:',
  'tag:',
  't:',
  'type:',
  'c:',
  'id:',
  'lang:',
  'cond:',
  'rarity:',
] as const
const DEFAULT_TYPE_OPTIONS = [
  'artifact',
  'battle',
  'creature',
  'enchantment',
  'instant',
  'land',
  'planeswalker',
  'sorcery',
  'tribal',
] as const
const SORT_COLUMN_LABELS: Record<SortColumn, string> = {
  card: 'Card',
  set: 'Set',
  number: '#',
  type: 'Type',
  color: 'Color',
  tags: 'Tags',
  location: 'Location',
  condition: 'Condition',
  language: 'Language',
  dateAdded: 'Date Added',
  purchasePrice: 'Purchase Price',
  price: 'Price',
  trend: 'Trend',
  nonfoil: 'Nonfoil',
  foil: 'Foil',
  total: 'Total',
  versions: 'Versions',
  updated: 'Updated',
}

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

function compareNullableNumber(left: number | null | undefined, right: number | null | undefined): number {
  const a = typeof left === 'number' && Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY
  const b = typeof right === 'number' && Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY
  return a - b
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function visibleUserTags(tags: string[]): string[] {
  return tags.filter((tag) => !SYSTEM_TAGS.has(normalize(tag)))
}

function colorIdentityLabel(colors: string[] | undefined): string {
  if (!colors || colors.length === 0) {
    return 'C'
  }
  return COLOR_SYMBOLS.filter((symbol) => colors.includes(symbol)).join('')
}

function inferPrimaryType(typeLine: string | null | undefined): string {
  const normalized = (typeLine ?? '').trim().toLowerCase()
  if (!normalized) {
    return 'unknown'
  }
  const [left] = normalized.split('—')
  const typePart = left.trim()
  const known = [
    'artifact',
    'battle',
    'creature',
    'enchantment',
    'instant',
    'land',
    'planeswalker',
    'sorcery',
    'tribal',
  ]
  for (const value of known) {
    if (typePart.includes(value)) {
      return value
    }
  }
  return typePart.split(/\s+/)[0] ?? 'unknown'
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

function resolveCardImageUrl(imageUrl: string | null | undefined, scryfallId: string): string | null {
  if (imageUrl && imageUrl.trim()) {
    return imageUrl
  }
  const normalized = scryfallId.trim()
  if (!normalized) {
    return null
  }
  return fallbackScryfallImageUrl(normalized)
}

function tokenizeSearchInput(value: string): string[] {
  const matches = value.match(/"[^"]+"|\S+/g)
  if (!matches) {
    return []
  }
  return matches.map((part) => {
    const trimmed = part.trim()
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  })
}

function parseSearchPlan(rawSearch: string): ParsedSearchPlan {
  const plan: ParsedSearchPlan = {
    freeText: [],
    setCodes: [],
    typeTerms: [],
    tags: [],
    colorContains: [],
    colorExact: null,
    rarities: [],
    languages: [],
    conditions: [],
    foilMode: 'any',
    manaComparators: [],
  }
  const terms = tokenizeSearchInput(rawSearch)
  for (const rawTerm of terms) {
    const term = rawTerm.trim().toLowerCase()
    if (!term) {
      continue
    }
    if (term.startsWith('set:')) {
      const value = term.slice(4).trim()
      if (value) {
        plan.setCodes.push(value.toUpperCase())
      }
      continue
    }
    if (term.startsWith('t:') || term.startsWith('type:')) {
      const value = term.startsWith('type:') ? term.slice(5) : term.slice(2)
      if (value.trim()) {
        plan.typeTerms.push(value.trim())
      }
      continue
    }
    if (term.startsWith('tag:')) {
      const value = term.slice(4).trim()
      if (value) {
        plan.tags.push(value)
      }
      continue
    }
    if (term.startsWith('c:')) {
      const value = term
        .slice(2)
        .toUpperCase()
        .replace(/[^WUBRGC]/g, '')
      if (value) {
        plan.colorContains.push(value)
      }
      continue
    }
    if (term.startsWith('id:')) {
      const value = term
        .slice(3)
        .toUpperCase()
        .replace(/[^WUBRGC]/g, '')
      if (value) {
        plan.colorExact = value
      }
      continue
    }
    if (term.startsWith('rarity:')) {
      const value = term.slice(7).trim()
      if (value) {
        plan.rarities.push(value)
      }
      continue
    }
    if (term.startsWith('lang:')) {
      const value = term.slice(5).trim()
      if (value) {
        plan.languages.push(value)
      }
      continue
    }
    if (term.startsWith('cond:')) {
      const value = term.slice(5).trim()
      if (value) {
        plan.conditions.push(value.toUpperCase())
      }
      continue
    }
    if (term === 'is:foil') {
      plan.foilMode = 'foil'
      continue
    }
    if (term === 'is:nonfoil') {
      plan.foilMode = 'nonfoil'
      continue
    }
    const manaMatch = term.match(/^mv(<=|>=|=|:|<|>)(\d+(?:\.\d+)?)$/)
    if (manaMatch) {
      const parsed = Number(manaMatch[2])
      if (Number.isFinite(parsed)) {
        plan.manaComparators.push({
          op: manaMatch[1] === ':' ? '=' : (manaMatch[1] as ManaComparator['op']),
          value: parsed,
        })
      }
      continue
    }
    const nameTerm = term.startsWith('name:') ? term.slice(5).trim() : term
    if (nameTerm) {
      plan.freeText.push(nameTerm)
    }
  }
  return plan
}

function compareMana(left: number, comparator: ManaComparator): boolean {
  if (comparator.op === '<') {
    return left < comparator.value
  }
  if (comparator.op === '<=') {
    return left <= comparator.value
  }
  if (comparator.op === '>') {
    return left > comparator.value
  }
  if (comparator.op === '>=') {
    return left >= comparator.value
  }
  return left === comparator.value
}

function matchesSearchPlan(card: OwnedCard, plan: ParsedSearchPlan): boolean {
  const typeName = inferPrimaryType(card.typeLine)
  const normalizedTypeLine = normalize(card.typeLine ?? '')
  const colorLabel = colorIdentityLabel(card.colorIdentity)
  const cardTagsNormalized = visibleUserTags(card.tags).map((tag) => normalize(tag))
  const searchable = [
    card.name,
    card.setCode,
    card.collectorNumber,
    typeName,
    colorLabel,
    ...visibleUserTags(card.tags),
  ]
    .join(' ')
    .toLowerCase()

  if (
    plan.freeText.length > 0 &&
    !plan.freeText.every((term) => searchable.includes(term))
  ) {
    return false
  }
  if (
    plan.setCodes.length > 0 &&
    !plan.setCodes.some((setCode) => setCode === card.setCode.toUpperCase())
  ) {
    return false
  }
  if (
    plan.typeTerms.length > 0 &&
    !plan.typeTerms.every(
      (term) =>
        normalize(typeName).includes(term) ||
        normalizedTypeLine.includes(term) ||
        cardTagsNormalized.some((tag) => tag.includes(term)),
    )
  ) {
    return false
  }
  if (
    plan.tags.length > 0 &&
    !plan.tags.every((tag) => cardTagsNormalized.some((ownedTag) => ownedTag.includes(tag)))
  ) {
    return false
  }

  const normalizedIdentity = colorIdentityLabel(card.colorIdentity).toUpperCase()
  if (plan.colorContains.length > 0) {
    const identitySet = new Set(normalizedIdentity.split('').filter(Boolean))
    for (const target of plan.colorContains) {
      const symbols = target.split('').filter(Boolean)
      if (symbols.includes('C') && identitySet.size !== 0) {
        return false
      }
      if (!symbols.every((symbol) => identitySet.has(symbol))) {
        return false
      }
    }
  }
  if (plan.colorExact) {
    if (plan.colorExact === 'C') {
      if (normalizedIdentity !== 'C') {
        return false
      }
    } else {
      const exact = plan.colorExact
        .split('')
        .filter(Boolean)
        .sort()
        .join('')
      const cardIdentity = normalizedIdentity
        .split('')
        .filter((value) => value !== 'C')
        .sort()
        .join('')
      if (exact !== cardIdentity) {
        return false
      }
    }
  }
  if (
    plan.rarities.length > 0 &&
    !plan.rarities.includes((card.rarity ?? '').toLowerCase())
  ) {
    return false
  }
  if (
    plan.languages.length > 0 &&
    !plan.languages.includes(card.language.toLowerCase())
  ) {
    return false
  }
  if (
    plan.conditions.length > 0 &&
    !plan.conditions.includes(card.conditionCode.toUpperCase())
  ) {
    return false
  }
  if (plan.foilMode === 'foil' && card.foilQuantity <= 0) {
    return false
  }
  if (plan.foilMode === 'nonfoil' && card.quantity <= 0) {
    return false
  }
  if (plan.manaComparators.length > 0) {
    if (card.manaValue === null || card.manaValue === undefined) {
      return false
    }
    if (!plan.manaComparators.every((comparator) => compareMana(card.manaValue ?? 0, comparator))) {
      return false
    }
  }
  return true
}

function inferTokenKind(token: string): string {
  const normalized = token.trim().toLowerCase()
  if (normalized.startsWith('set:')) return 'set'
  if (normalized.startsWith('tag:')) return 'tag'
  if (normalized.startsWith('t:') || normalized.startsWith('type:')) return 'type'
  if (normalized.startsWith('c:') || normalized.startsWith('id:')) return 'color'
  if (normalized.startsWith('mv') || normalized.startsWith('mana:')) return 'mana'
  if (normalized.startsWith('rarity:')) return 'rarity'
  if (normalized.startsWith('lang:')) return 'language'
  if (normalized.startsWith('cond:')) return 'condition'
  if (normalized.startsWith('is:')) return 'state'
  return 'generic'
}

function normalizeSearchTerms(terms: string[]): string[] {
  return terms.map((term) => term.trim()).filter((term) => term.length > 0)
}

function getBareSearchFieldPrefix(term: string): string | null {
  const normalized = term.trim().toLowerCase()
  for (const prefix of SEARCH_FIELD_PREFIXES) {
    if (normalized === prefix) {
      return prefix
    }
  }
  return null
}

function buildSearchQueryTerms(terms: string[], draft: string): string[] {
  const normalizedTerms = normalizeSearchTerms(terms)
  const normalizedDraft = draft.trim()
  if (normalizedTerms.length > 0) {
    const lastIndex = normalizedTerms.length - 1
    const lastPrefix = getBareSearchFieldPrefix(normalizedTerms[lastIndex])
    if (lastPrefix && normalizedDraft) {
      normalizedTerms[lastIndex] = `${lastPrefix}${normalizedDraft.toLowerCase()}`
      return normalizedTerms
    }
  }
  if (normalizedDraft) {
    normalizedTerms.push(normalizedDraft)
  }
  return normalizedTerms
}

function getSearchTermBoxes(terms: string[]): SearchTermBox[] {
  return normalizeSearchTerms(terms).map((term) => ({
    token: term,
    kind: inferTokenKind(term),
  }))
}

function CardArtImage({
  src,
  alt,
  className,
}: {
  src: string | null
  alt: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return <div className={`image-fallback ${className ?? ''}`}>{alt.slice(0, 1).toUpperCase()}</div>
  }

  return <img src={src} alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} />
}

function parseUsd(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
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

async function searchCardsForAddMenu(query: string): Promise<AddMenuCard[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(
    trimmed,
  )}&unique=prints&order=name&dir=asc`
  const response = await fetch(url)
  if (!response.ok) {
    if (response.status === 404) {
      return []
    }
    throw new Error(`Unable to search Scryfall (${response.status}).`)
  }
  const payload = (await response.json()) as {
    data?: Array<{
      id?: string
      name?: string
      set?: string
      collector_number?: string
      released_at?: string
      type_line?: string
      color_identity?: string[]
      cmc?: number
      rarity?: string
      image_uris?: { normal?: string }
      card_faces?: Array<{ image_uris?: { normal?: string } }>
      prices?: { usd?: string | null; usd_foil?: string | null }
    }>
  }

  return (payload.data ?? [])
    .slice(0, ADD_RESULT_LIMIT)
    .map((entry) => {
      const scryfallId = entry.id ?? ''
      if (!scryfallId) {
        return null
      }
      return {
        scryfallId,
        name: entry.name ?? 'Unknown',
        setCode: (entry.set ?? '').toUpperCase(),
        collectorNumber: entry.collector_number ?? '',
        releasedAt: entry.released_at ?? null,
        imageUrl:
          entry.image_uris?.normal ?? entry.card_faces?.[0]?.image_uris?.normal ?? null,
        typeLine: entry.type_line ?? null,
        colorIdentity: entry.color_identity ?? [],
        manaValue: typeof entry.cmc === 'number' && Number.isFinite(entry.cmc) ? entry.cmc : null,
        rarity: entry.rarity ?? null,
        marketPrice: parseUsd(entry.prices?.usd ?? entry.prices?.usd_foil),
      } as AddMenuCard
    })
    .filter((entry): entry is AddMenuCard => entry !== null)
}

export function CollectionPage({
  profileId,
  profileName,
  cards,
  onIncrement,
  onDecrement,
  onAddPrinting,
  onRemove,
  onRemoveSelected,
  onTagCard,
  onUpdateMetadata,
  onBulkUpdateMetadata,
  onOpenMarket,
  onUndoLastAction,
  canUndo,
  undoLabel = '',
  onImportCollectionRows,
  onHydrateTypeMetadata,
  isSyncing = false,
}: CollectionPageProps) {
  const [viewMode, setViewMode] = useState<CollectionViewMode>('text')
  const [rowDensity, setRowDensity] = useState<RowDensity>('balanced')
  const [compactMode, setCompactMode] = useState(false)
  const [searchTerms, setSearchTerms] = useState<string[]>([])
  const [searchDraft, setSearchDraft] = useState('')
  const [activeSearchBoxIndex, setActiveSearchBoxIndex] = useState(-1)
  const [searchHasFocus, setSearchHasFocus] = useState(false)
  const [tokenSuggestions, setTokenSuggestions] = useState<FilterToken[]>([])
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const [isSuggestionLoading, setIsSuggestionLoading] = useState(false)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [finishFilter, setFinishFilter] = useState<FinishFilter>('all')
  const [sortColumn, setSortColumn] = useState<SortColumn>('total')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [priceSource, setPriceSource] = useState<PriceSourceId>('tcg-market')
  const [priceByMode, setPriceByMode] = useState<PriceByMode>('unit')
  const [sourceTrendById, setSourceTrendById] = useState<
    Record<
      string,
      {
        currentPrice: number | null
        previousPrice: number | null
        priceDelta: number | null
        priceDirection: PriceDirection
        lastPriceAt: string | null
      }
    >
  >({})
  const [quickSetFilter, setQuickSetFilter] = useState('')
  const [quickTypeFilter, setQuickTypeFilter] = useState('')
  const [quickColorFilter, setQuickColorFilter] = useState('')
  const [setFilters, setSetFilters] = useState<Set<string>>(new Set())
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set())
  const [colorFilters, setColorFilters] = useState<Set<string>>(new Set())
  const [tagFilters, setTagFilters] = useState<Set<string>>(new Set())
  const [conditionFilters, setConditionFilters] = useState<Set<string>>(new Set())
  const [languageFilters, setLanguageFilters] = useState<Set<string>>(new Set())
  const [textColumnState, setTextColumnState] = useState<TextColumnState>({
    set: true,
    number: true,
    type: false,
    color: false,
    tags: true,
    location: true,
    condition: false,
    language: false,
    dateAdded: false,
    purchasePrice: false,
    price: true,
    trend: true,
    updated: false,
  })
  const [listScrollTop, setListScrollTop] = useState(0)
  const [imageLimit, setImageLimit] = useState(IMAGE_PAGE_SIZE)
  const [modalMode, setModalMode] = useState<CollectionModalMode | null>(null)
  const [versionAnchor, setVersionAnchor] = useState<OwnedCard | null>(null)
  const [versionRows, setVersionRows] = useState<VersionRow[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [versionError, setVersionError] = useState('')
  const [addMenuQuery, setAddMenuQuery] = useState('')
  const [addMenuResults, setAddMenuResults] = useState<AddMenuCard[]>([])
  const [isSearchingAddMenu, setIsSearchingAddMenu] = useState(false)
  const [addMenuError, setAddMenuError] = useState('')
  const [foilModeByCard, setFoilModeByCard] = useState<Record<string, boolean>>({})
  const [activeTagByCard, setActiveTagByCard] = useState<Record<string, string>>({})
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set())
  const [bulkCondition, setBulkCondition] = useState('')
  const [bulkLanguage, setBulkLanguage] = useState('')
  const [bulkLocation, setBulkLocation] = useState('')
  const [metadataError, setMetadataError] = useState('')
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [editCondition, setEditCondition] = useState('NM')
  const [editLanguage, setEditLanguage] = useState('en')
  const [editLocation, setEditLocation] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editPurchasePrice, setEditPurchasePrice] = useState('')
  const [editDateAdded, setEditDateAdded] = useState('')
  const [didRequestTypeHydration, setDidRequestTypeHydration] = useState(false)
  const [isHydratingTypeMetadata, setIsHydratingTypeMetadata] = useState(false)
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false)

  const listRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchTokenInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const searchBlurTimeoutRef = useRef<number | null>(null)

  const uniqueCards = cards.length
  const totalCards = cards.reduce((sum, card) => sum + card.quantity + card.foilQuantity, 0)
  const totalFoils = cards.reduce((sum, card) => sum + card.foilQuantity, 0)

  function trendForSource(card: OwnedCard) {
    const bySource = sourceTrendById[card.scryfallId]
    if (bySource) {
      return bySource
    }
    return {
      currentPrice: card.currentPrice,
      previousPrice: card.previousPrice,
      priceDelta: card.priceDelta,
      priceDirection: card.priceDirection,
      lastPriceAt: card.lastPriceAt,
    }
  }

  function unitPriceForCard(card: OwnedCard): number | null {
    return trendForSource(card).currentPrice
  }

  function displayPriceForCard(card: OwnedCard): number | null {
    const unit = unitPriceForCard(card)
    if (unit === null) {
      return null
    }
    if (priceByMode === 'position') {
      return unit * (card.quantity + card.foilQuantity)
    }
    return unit
  }

  const estimatedMarket = cards.reduce((sum, card) => {
    const unit = unitPriceForCard(card)
    if (unit === null) {
      return sum
    }
    return sum + unit * (card.quantity + card.foilQuantity)
  }, 0)

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

  const setOptions = useMemo(
    () =>
      [...new Set(cards.map((card) => card.setCode.toUpperCase()))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [cards],
  )
  const typeOptions = useMemo(
    () => {
      const merged = new Set<string>()
      for (const card of cards) {
        const inferred = inferPrimaryType(card.typeLine)
        if (inferred && inferred !== 'unknown') {
          merged.add(inferred)
        }
      }
      for (const canonical of DEFAULT_TYPE_OPTIONS) {
        merged.add(canonical)
      }
      return [...merged].sort((a, b) => a.localeCompare(b))
    },
    [cards],
  )
  const colorOptions = useMemo(
    () =>
      [...new Set(cards.map((card) => colorIdentityLabel(card.colorIdentity)))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [cards],
  )
  const tagOptions = useMemo(
    () =>
      [...new Set(cards.flatMap((card) => visibleUserTags(card.tags).map((tag) => tag.trim()).filter(Boolean)))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [cards],
  )
  const conditionOptions = useMemo(
    () =>
      [...new Set(cards.map((card) => card.conditionCode.toUpperCase()))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [cards],
  )
  const languageOptions = useMemo(
    () =>
      [...new Set(cards.map((card) => card.language.toLowerCase()))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [cards],
  )
  const rarityOptions = useMemo(
    () =>
      [...new Set(cards.map((card) => (card.rarity ?? '').toLowerCase()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [cards],
  )
  const searchQueryTerms = useMemo(
    () => buildSearchQueryTerms(searchTerms, searchDraft),
    [searchTerms, searchDraft],
  )
  const searchQuery = useMemo(() => searchQueryTerms.join(' '), [searchQueryTerms])
  const searchTermBoxes = useMemo(() => getSearchTermBoxes(searchTerms), [searchTerms])
  const activeSuggestionNeedle = useMemo(() => {
    if (activeSearchBoxIndex >= 0) {
      return (searchTerms[activeSearchBoxIndex] ?? '').trim().toLowerCase()
    }
    const draft = searchDraft.trim().toLowerCase()
    const lastCommittedPrefix =
      searchTerms.length > 0 ? getBareSearchFieldPrefix(searchTerms[searchTerms.length - 1]) : null
    if (lastCommittedPrefix) {
      return `${lastCommittedPrefix}${draft}`
    }
    return draft
  }, [activeSearchBoxIndex, searchTerms, searchDraft])

  const contextualTokenSuggestions = useMemo(() => {
    const needle = activeSuggestionNeedle
    const prefixMatch = needle.match(/^(set:|tag:|t:|type:|c:|id:|lang:|cond:|rarity:)(.*)$/)
    if (!prefixMatch) {
      return { suggestions: [] as FilterToken[], isContextMode: false }
    }
    const prefix = prefixMatch[1]
    const rawQuery = prefixMatch[2].trim().toLowerCase()
    const mapValues = (
      values: string[],
      kind: string,
      labelBuilder: (value: string) => string,
      tokenBuilder: (value: string) => string,
    ): FilterToken[] =>
      values
        .filter((value) => {
          if (!rawQuery) return true
          return value.toLowerCase().includes(rawQuery)
        })
        .slice(0, 18)
        .map((value, index) => ({
          token: tokenBuilder(value),
          label: labelBuilder(value),
          kind,
          source: 'contextual',
          priority: index + 1,
        }))

    if (prefix === 'set:') {
      return {
        suggestions: mapValues(
          setOptions,
          'set',
          (value) => `Set ${value.toUpperCase()}`,
          (value) => `set:${value.toLowerCase()}`,
        ),
        isContextMode: true,
      }
    }
    if (prefix === 'tag:') {
      return {
        suggestions: mapValues(
          tagOptions,
          'tag',
          (value) => `Tag ${value}`,
          (value) => `tag:${value.toLowerCase()}`,
        ),
        isContextMode: true,
      }
    }
    if (prefix === 't:' || prefix === 'type:') {
      const outPrefix = prefix === 'type:' ? 'type:' : 't:'
      return {
        suggestions: mapValues(
          typeOptions,
          'type',
          (value) => `Type ${value}`,
          (value) => `${outPrefix}${value.toLowerCase()}`,
        ),
        isContextMode: true,
      }
    }
    if (prefix === 'c:' || prefix === 'id:') {
      return {
        suggestions: mapValues(
          colorOptions,
          'color',
          (value) => `Color ${value}`,
          (value) => `${prefix}${value.toLowerCase()}`,
        ),
        isContextMode: true,
      }
    }
    if (prefix === 'lang:') {
      return {
        suggestions: mapValues(
          languageOptions,
          'language',
          (value) => `Language ${value.toUpperCase()}`,
          (value) => `lang:${value.toLowerCase()}`,
        ),
        isContextMode: true,
      }
    }
    if (prefix === 'cond:') {
      return {
        suggestions: mapValues(
          conditionOptions,
          'condition',
          (value) => `Condition ${value.toUpperCase()}`,
          (value) => `cond:${value.toUpperCase()}`,
        ),
        isContextMode: true,
      }
    }
    if (prefix === 'rarity:') {
      return {
        suggestions: mapValues(
          rarityOptions,
          'rarity',
          (value) => `Rarity ${value}`,
          (value) => `rarity:${value.toLowerCase()}`,
        ),
        isContextMode: true,
      }
    }
    return { suggestions: [] as FilterToken[], isContextMode: false }
  }, [
    activeSuggestionNeedle,
    setOptions,
    tagOptions,
    typeOptions,
    colorOptions,
    languageOptions,
    conditionOptions,
    rarityOptions,
  ])

  const parsedSearchPlan = useMemo(() => parseSearchPlan(searchQuery), [searchQuery])
  const missingTypeMetadataCount = useMemo(
    () =>
      cards.reduce(
        (count, card) => count + ((card.typeLine ?? '').trim() ? 0 : 1),
        0,
      ),
    [cards],
  )

  useEffect(() => {
    setDidRequestTypeHydration(false)
    setIsHydratingTypeMetadata(false)
  }, [profileId])

  useEffect(() => {
    let cancelled = false

    async function loadSourcePrices() {
      if (!cards.length) {
        setSourceTrendById({})
        return
      }
      try {
        const trends = await getCollectionPriceTrendsBySource({
          profileId,
          sourceId: priceSource,
        })
        if (cancelled) {
          return
        }
        const next: Record<
          string,
          {
            currentPrice: number | null
            previousPrice: number | null
            priceDelta: number | null
            priceDirection: PriceDirection
            lastPriceAt: string | null
          }
        > = {}
        for (const trend of trends) {
          next[trend.scryfallId] = {
            currentPrice: trend.currentPrice,
            previousPrice: trend.previousPrice,
            priceDelta: trend.priceDelta,
            priceDirection: trend.priceDirection,
            lastPriceAt: trend.lastPriceAt,
          }
        }
        setSourceTrendById(next)
      } catch {
        if (!cancelled) {
          setSourceTrendById({})
        }
      }
    }

    void loadSourcePrices()
    return () => {
      cancelled = true
    }
  }, [profileId, priceSource, cards.length])

  useEffect(() => {
    if (parsedSearchPlan.typeTerms.length <= 0) {
      return
    }
    if (!onHydrateTypeMetadata || didRequestTypeHydration || missingTypeMetadataCount <= 0) {
      return
    }
    setDidRequestTypeHydration(true)
    setIsHydratingTypeMetadata(true)
    void onHydrateTypeMetadata().finally(() => {
      setIsHydratingTypeMetadata(false)
    })
  }, [
    parsedSearchPlan.typeTerms.length,
    onHydrateTypeMetadata,
    didRequestTypeHydration,
    missingTypeMetadataCount,
  ])

  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      const typeName = inferPrimaryType(card.typeLine)
      const colorLabel = colorIdentityLabel(card.colorIdentity)
      if (!matchesSearchPlan(card, parsedSearchPlan)) {
        return false
      }

      if (finishFilter === 'any-foil' && card.foilQuantity <= 0) {
        return false
      }
      if (finishFilter === 'nonfoil-only' && card.foilQuantity > 0) {
        return false
      }
      if (quickSetFilter && card.setCode.toUpperCase() !== quickSetFilter) {
        return false
      }
      if (quickTypeFilter && typeName !== quickTypeFilter) {
        return false
      }
      if (quickColorFilter && colorLabel !== quickColorFilter) {
        return false
      }

      if (setFilters.size > 0 && !setFilters.has(card.setCode.toUpperCase())) {
        return false
      }
      if (typeFilters.size > 0 && !typeFilters.has(typeName)) {
        return false
      }
      if (colorFilters.size > 0 && !colorFilters.has(colorLabel)) {
        return false
      }
      if (
        tagFilters.size > 0 &&
        !visibleUserTags(card.tags).some((tag) => tagFilters.has(tag.trim()))
      ) {
        return false
      }
      if (
        conditionFilters.size > 0 &&
        !conditionFilters.has(card.conditionCode.toUpperCase())
      ) {
        return false
      }
      if (
        languageFilters.size > 0 &&
        !languageFilters.has(card.language.toLowerCase())
      ) {
        return false
      }
      return true
    })
  }, [
    cards,
    parsedSearchPlan,
    finishFilter,
    quickSetFilter,
    quickTypeFilter,
    quickColorFilter,
    setFilters,
    typeFilters,
    colorFilters,
    tagFilters,
    conditionFilters,
    languageFilters,
  ])

  const sortedFilteredCards = useMemo(() => {
    const typeById = new Map<string, string>()
    const colorById = new Map<string, string>()
    const tagLineById = new Map<string, string>()
    const locationById = new Map<string, string>()
    const conditionById = new Map<string, string>()
    const languageById = new Map<string, string>()
    const dateAddedMsById = new Map<string, number>()
    const updatedMsById = new Map<string, number>()
    const displayPriceById = new Map<string, number | null>()
    const trendDeltaById = new Map<string, number | null>()

    for (const card of filteredCards) {
      const bySource = sourceTrendById[card.scryfallId] ?? {
        currentPrice: card.currentPrice,
        previousPrice: card.previousPrice,
        priceDelta: card.priceDelta,
        priceDirection: card.priceDirection,
        lastPriceAt: card.lastPriceAt,
      }
      const unit = bySource.currentPrice
      const displayPrice =
        unit === null
          ? null
          : priceByMode === 'position'
            ? unit * (card.quantity + card.foilQuantity)
            : unit

      typeById.set(card.scryfallId, inferPrimaryType(card.typeLine))
      colorById.set(card.scryfallId, colorIdentityLabel(card.colorIdentity))
      tagLineById.set(card.scryfallId, visibleUserTags(card.tags).join('|'))
      locationById.set(card.scryfallId, card.locationName ?? '')
      conditionById.set(card.scryfallId, card.conditionCode ?? '')
      languageById.set(card.scryfallId, card.language ?? '')
      dateAddedMsById.set(card.scryfallId, Date.parse(card.dateAdded ?? '') || 0)
      updatedMsById.set(card.scryfallId, Date.parse(card.updatedAt) || 0)
      displayPriceById.set(card.scryfallId, displayPrice)
      trendDeltaById.set(card.scryfallId, bySource.priceDelta)
    }

    const next = [...filteredCards]
    next.sort((a, b) => {
      const aId = a.scryfallId
      const bId = b.scryfallId
      let delta = 0
      if (sortColumn === 'card') {
        delta = a.name.localeCompare(b.name)
      } else if (sortColumn === 'set') {
        delta = a.setCode.localeCompare(b.setCode)
      } else if (sortColumn === 'number') {
        delta = a.collectorNumber.localeCompare(b.collectorNumber, undefined, { numeric: true })
      } else if (sortColumn === 'type') {
        delta = (typeById.get(aId) ?? '').localeCompare(typeById.get(bId) ?? '')
      } else if (sortColumn === 'color') {
        delta = (colorById.get(aId) ?? '').localeCompare(colorById.get(bId) ?? '')
      } else if (sortColumn === 'tags') {
        delta = (tagLineById.get(aId) ?? '').localeCompare(tagLineById.get(bId) ?? '')
      } else if (sortColumn === 'location') {
        delta = (locationById.get(aId) ?? '').localeCompare(locationById.get(bId) ?? '')
      } else if (sortColumn === 'condition') {
        delta = (conditionById.get(aId) ?? '').localeCompare(conditionById.get(bId) ?? '')
      } else if (sortColumn === 'language') {
        delta = (languageById.get(aId) ?? '').localeCompare(languageById.get(bId) ?? '')
      } else if (sortColumn === 'dateAdded') {
        delta = (dateAddedMsById.get(aId) ?? 0) - (dateAddedMsById.get(bId) ?? 0)
      } else if (sortColumn === 'purchasePrice') {
        delta = compareNullableNumber(a.purchasePrice, b.purchasePrice)
      } else if (sortColumn === 'price') {
        delta = compareNullableNumber(displayPriceById.get(aId) ?? null, displayPriceById.get(bId) ?? null)
      } else if (sortColumn === 'trend') {
        delta = compareNullableNumber(trendDeltaById.get(aId) ?? null, trendDeltaById.get(bId) ?? null)
      } else if (sortColumn === 'nonfoil') {
        delta = a.quantity - b.quantity
      } else if (sortColumn === 'foil') {
        delta = a.foilQuantity - b.foilQuantity
      } else if (sortColumn === 'versions') {
        delta =
          (versionCountsByName.get(normalize(a.name)) ?? 1) -
          (versionCountsByName.get(normalize(b.name)) ?? 1)
      } else if (sortColumn === 'updated') {
        delta = (updatedMsById.get(aId) ?? 0) - (updatedMsById.get(bId) ?? 0)
      } else {
        delta = a.quantity + a.foilQuantity - (b.quantity + b.foilQuantity)
      }

      if (delta === 0) {
        delta = a.name.localeCompare(b.name)
      }
      return sortDirection === 'asc' ? delta : -delta
    })
    return next
  }, [filteredCards, sortColumn, sortDirection, priceByMode, sourceTrendById, versionCountsByName])

  useEffect(() => {
    setListScrollTop(0)
    listRef.current?.scrollTo({ top: 0 })
    setImageLimit(IMAGE_PAGE_SIZE)
  }, [viewMode, compactMode, rowDensity, searchQuery, sortedFilteredCards.length, sortColumn, sortDirection])

  useEffect(() => {
    setSelectedCardIds((previous) => {
      if (!previous.size) {
        return previous
      }
      const validIds = new Set(cards.map((card) => card.scryfallId))
      const next = new Set<string>()
      for (const id of previous) {
        if (validIds.has(id)) {
          next.add(id)
        }
      }
      return next
    })
  }, [cards])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void syncFilterTokens(profileId).catch(() => {
        // Best effort. Search still works with fallback tokens.
      })
    }, 240)
    return () => {
      window.clearTimeout(timer)
    }
  }, [profileId, cards.length])

  useEffect(() => {
    if (!searchHasFocus) {
      setTokenSuggestions([])
      setActiveSuggestionIndex(0)
      return
    }
    if (contextualTokenSuggestions.isContextMode) {
      setTokenSuggestions(contextualTokenSuggestions.suggestions)
      setActiveSuggestionIndex((current) =>
        contextualTokenSuggestions.suggestions.length === 0
          ? 0
          : Math.min(current, contextualTokenSuggestions.suggestions.length - 1),
      )
      setIsSuggestionLoading(false)
      return
    }
    setIsSuggestionLoading(true)
    const timer = window.setTimeout(() => {
      const needle = activeSuggestionNeedle
      void getFilterTokens(needle, 12)
        .then((rows) => {
          setTokenSuggestions(rows)
          setActiveSuggestionIndex((current) =>
            rows.length === 0 ? 0 : Math.min(current, rows.length - 1),
          )
        })
        .catch(() => {
          setTokenSuggestions([])
          setActiveSuggestionIndex(0)
        })
        .finally(() => {
          setIsSuggestionLoading(false)
        })
    }, 120)
    return () => {
      window.clearTimeout(timer)
    }
  }, [activeSuggestionNeedle, searchHasFocus, contextualTokenSuggestions])

  useEffect(() => {
    return () => {
      if (searchBlurTimeoutRef.current !== null) {
        window.clearTimeout(searchBlurTimeoutRef.current)
      }
    }
  }, [])

  const baseRowHeight = DENSITY_ROW_HEIGHT[rowDensity]
  const rowHeight = compactMode ? Math.max(34, baseRowHeight - 4) : baseRowHeight
  const totalHeight = sortedFilteredCards.length * rowHeight
  const startIndex = Math.max(0, Math.floor(listScrollTop / rowHeight) - OVERSCAN)
  const visibleCount = Math.ceil(VIRTUAL_HEIGHT / rowHeight) + OVERSCAN * 2
  const endIndex = Math.min(sortedFilteredCards.length, startIndex + visibleCount)
  const visibleRows = sortedFilteredCards.slice(startIndex, endIndex)
  const topPad = startIndex * rowHeight
  const bottomPad = Math.max(0, totalHeight - topPad - visibleRows.length * rowHeight)

  const visibleImageCards = sortedFilteredCards.slice(0, imageLimit)
  const imageGridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(auto-fill, minmax(${DENSITY_IMAGE_MIN_WIDTH[rowDensity]}px, 1fr))`,
    }),
    [rowDensity],
  )
  const listGridTemplate = useMemo(() => {
    if (compactMode) {
      return 'minmax(260px, 2.4fr) 90px 72px 72px 72px minmax(248px, 1.8fr)'
    }
    const columns: string[] = ['minmax(220px, 2fr)']
    if (textColumnState.set) {
      columns.push('80px')
    }
    if (textColumnState.number) {
      columns.push('80px')
    }
    if (textColumnState.type) {
      columns.push('minmax(128px, 1.2fr)')
    }
    if (textColumnState.color) {
      columns.push('72px')
    }
    if (textColumnState.tags) {
      columns.push('minmax(220px, 2fr)')
    }
    if (textColumnState.location) {
      columns.push('minmax(140px, 1.2fr)')
    }
    if (textColumnState.condition) {
      columns.push('88px')
    }
    if (textColumnState.language) {
      columns.push('88px')
    }
    if (textColumnState.dateAdded) {
      columns.push('112px')
    }
    if (textColumnState.purchasePrice) {
      columns.push('96px')
    }
    if (textColumnState.price) {
      columns.push('88px')
    }
    if (textColumnState.trend) {
      columns.push('108px')
    }
    if (textColumnState.updated) {
      columns.push('112px')
    }
    columns.push('72px', '72px', '72px', 'minmax(248px, 1.8fr)')
    return columns.join(' ')
  }, [compactMode, textColumnState])

  function closeSearchSuggestions() {
    setSearchHasFocus(false)
    setTokenSuggestions([])
    setActiveSuggestionIndex(0)
  }

  function handleSearchFocus() {
    if (searchBlurTimeoutRef.current !== null) {
      window.clearTimeout(searchBlurTimeoutRef.current)
      searchBlurTimeoutRef.current = null
    }
    setSearchHasFocus(true)
  }

  function handleSearchBlur() {
    if (searchBlurTimeoutRef.current !== null) {
      window.clearTimeout(searchBlurTimeoutRef.current)
    }
    searchBlurTimeoutRef.current = window.setTimeout(() => {
      closeSearchSuggestions()
    }, 120)
  }

  function handleSearchDraftChange(nextValue: string) {
    if (!/\s/.test(nextValue)) {
      setSearchDraft(nextValue)
      return
    }
    const pieces = nextValue.split(/\s+/)
    const normalizedPieces = normalizeSearchTerms(pieces)
    const keepDraft = /\s$/.test(nextValue) ? '' : normalizedPieces.pop() ?? ''
    if (normalizedPieces.length > 0) {
      setSearchTerms((previous) => [...previous, ...normalizedPieces])
    }
    setSearchDraft(keepDraft)
  }

  function commitDraftAsTerm() {
    const normalizedDraft = searchDraft.trim()
    if (!normalizedDraft) {
      return
    }
    setSearchTerms((previous) => {
      const next = [...previous]
      const lastIndex = next.length - 1
      if (lastIndex >= 0) {
        const prefix = getBareSearchFieldPrefix(next[lastIndex])
        if (prefix) {
          next[lastIndex] = `${prefix}${normalizedDraft.toLowerCase()}`
          return next
        }
      }
      next.push(normalizedDraft)
      return next
    })
    setSearchDraft('')
    setActiveSearchBoxIndex(-1)
  }

  function updateSearchTermAt(index: number, value: string) {
    setSearchTerms((previous) => {
      if (index < 0 || index >= previous.length) {
        return previous
      }
      const next = [...previous]
      next[index] = value
      return next
    })
  }

  function removeSearchTermAt(index: number) {
    setSearchTerms((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
    setActiveSearchBoxIndex(-1)
    window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
  }

  function commitSearchTermNormalization() {
    setSearchTerms((previous) => normalizeSearchTerms(previous))
  }

  function applyTokenSuggestion(token: string) {
    if (activeSearchBoxIndex >= 0) {
      updateSearchTermAt(activeSearchBoxIndex, token)
    } else {
      setSearchTerms((previous) => {
        const next = [...previous]
        const lastIndex = next.length - 1
        if (lastIndex >= 0 && getBareSearchFieldPrefix(next[lastIndex])) {
          next[lastIndex] = token
          return next
        }
        next.push(token)
        return next
      })
      setSearchDraft('')
    }
    setActiveSuggestionIndex(0)
    setSearchHasFocus(true)
    window.setTimeout(() => {
      if (activeSearchBoxIndex >= 0) {
        searchTokenInputRefs.current[activeSearchBoxIndex]?.focus()
      } else {
        searchInputRef.current?.focus()
      }
    }, 0)
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (!searchHasFocus || tokenSuggestions.length === 0) {
      if (event.key === ' ' && index === -1 && searchDraft.trim()) {
        event.preventDefault()
        commitDraftAsTerm()
      }
      if (event.key === 'Backspace' && index === -1 && !searchDraft && searchTerms.length > 0) {
        event.preventDefault()
        setActiveSearchBoxIndex(searchTerms.length - 1)
        window.setTimeout(() => {
          searchTokenInputRefs.current[searchTerms.length - 1]?.focus()
        }, 0)
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveSuggestionIndex((current) =>
        current >= tokenSuggestions.length - 1 ? 0 : current + 1,
      )
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSuggestionIndex((current) =>
        current <= 0 ? tokenSuggestions.length - 1 : current - 1,
      )
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchSuggestions()
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const suggestion = tokenSuggestions[activeSuggestionIndex]
      if (suggestion) {
        event.preventDefault()
        applyTokenSuggestion(suggestion.token)
        return
      }
      if (event.key === 'Enter' && index === -1 && searchDraft.trim()) {
        event.preventDefault()
        commitDraftAsTerm()
      }
    }
  }

  async function handleImportFromWizard(payload: {
    rows: CollectionImportRow[]
    rowsImported: number
    copiesImported: number
    rowsSkipped: number
  }) {
    await onImportCollectionRows(payload.rows)
  }

  function handleVirtualScroll(event: UIEvent<HTMLDivElement>) {
    setListScrollTop(event.currentTarget.scrollTop)
  }

  function toggleFilterValue(
    setter: (value: Set<string> | ((previous: Set<string>) => Set<string>)) => void,
    value: string,
  ) {
    setter((previous) => {
      const next = new Set(previous)
      if (next.has(value)) {
        next.delete(value)
      } else {
        next.add(value)
      }
      return next
    })
  }

  function clearAllFilters() {
    setSetFilters(new Set())
    setTypeFilters(new Set())
    setColorFilters(new Set())
    setTagFilters(new Set())
    setConditionFilters(new Set())
    setLanguageFilters(new Set())
    setQuickSetFilter('')
    setQuickTypeFilter('')
    setQuickColorFilter('')
    setFinishFilter('all')
    setSearchTerms([])
    setSearchDraft('')
    setActiveSearchBoxIndex(-1)
  }

  function defaultSortDirectionFor(column: SortColumn): SortDirection {
    if (
      column === 'card' ||
      column === 'set' ||
      column === 'number' ||
      column === 'type' ||
      column === 'color' ||
      column === 'tags' ||
      column === 'location' ||
      column === 'condition' ||
      column === 'language'
    ) {
      return 'asc'
    }
    return 'desc'
  }

  function toggleSortColumn(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortColumn(column)
    setSortDirection(defaultSortDirectionFor(column))
  }

  function sortIndicator(column: SortColumn): string {
    if (sortColumn !== column) {
      return ''
    }
    return sortDirection === 'asc' ? ' ^' : ' v'
  }

  function toggleTextColumn(id: TextColumnId) {
    setTextColumnState((previous) => ({ ...previous, [id]: !previous[id] }))
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

  async function handleVersionAdjust(
    row: VersionRow,
    foil: boolean,
    delta: 1 | -1,
    fallbackName: string,
  ) {
    if (delta > 0) {
      await onAddPrinting({
        scryfallId: row.scryfallId,
        name: fallbackName,
        setCode: row.setCode.toLowerCase(),
        collectorNumber: row.collectorNumber,
        imageUrl: resolveCardImageUrl(row.imageUrl, row.scryfallId) ?? undefined,
        foil,
      })
      return
    }

    if (foil && row.ownedFoilQuantity > 0) {
      await onDecrement(row.scryfallId, true)
    }
    if (!foil && row.ownedQuantity > 0) {
      await onDecrement(row.scryfallId, false)
    }
  }

  async function handleOpenVersions(card: OwnedCard) {
    setModalMode('versions')
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

  function closeModal() {
    setModalMode(null)
    setVersionAnchor(null)
    setVersionRows([])
    setVersionError('')
    setAddMenuError('')
    setIsSearchingAddMenu(false)
  }

  async function handleSearchAddMenu() {
    if (!addMenuQuery.trim()) {
      setAddMenuResults([])
      setAddMenuError('Enter a card name or Scryfall query.')
      return
    }
    setAddMenuError('')
    setIsSearchingAddMenu(true)
    try {
      const rows = await searchCardsForAddMenu(addMenuQuery)
      setAddMenuResults(rows)
      if (!rows.length) {
        setAddMenuError('No cards matched that query.')
      }
    } catch (error) {
      setAddMenuResults([])
      setAddMenuError(
        error instanceof Error ? error.message : 'Unable to search cards.',
      )
    } finally {
      setIsSearchingAddMenu(false)
    }
  }

  function handleOpenAddMenu() {
    setModalMode('add')
    setAddMenuQuery('name:"Sol Ring"')
    setAddMenuResults([])
    setAddMenuError('')
  }

  async function handleAddMenuAdjust(row: AddMenuCard, foil: boolean) {
    await onAddPrinting({
      scryfallId: row.scryfallId,
      name: row.name,
      setCode: row.setCode.toLowerCase(),
      collectorNumber: row.collectorNumber,
      imageUrl: resolveCardImageUrl(row.imageUrl, row.scryfallId) ?? undefined,
      typeLine: row.typeLine ?? null,
      colorIdentity: row.colorIdentity.length ? row.colorIdentity : undefined,
      manaValue: row.manaValue,
      rarity: row.rarity,
      foil,
      currentPrice: row.marketPrice,
    })
  }

  const editingCard = useMemo(
    () => cards.find((card) => card.scryfallId === editingCardId) ?? null,
    [cards, editingCardId],
  )

  function toggleSelectCard(cardId: string, checked: boolean) {
    setSelectedCardIds((previous) => {
      const next = new Set(previous)
      if (checked) {
        next.add(cardId)
      } else {
        next.delete(cardId)
      }
      return next
    })
  }

  function selectVisibleRows() {
    setSelectedCardIds(new Set(sortedFilteredCards.map((card) => card.scryfallId)))
  }

  function clearSelectedRows() {
    setSelectedCardIds(new Set())
  }

  async function handleRemoveSelectedRows() {
    const selected = [...selectedCardIds]
    if (!selected.length) {
      return
    }
    const undoHint =
      selected.length <= 400
        ? 'This can be undone with Undo.'
        : 'Undo is disabled for very large bulk deletes.'
    const confirmed = window.confirm(
      `Remove ${selected.length} selected rows from this collection? ${undoHint}`,
    )
    if (!confirmed) {
      return
    }

    setMetadataError('')
    try {
      await onRemoveSelected(selected)
      setSelectedCardIds(new Set())
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : 'Failed to remove selected rows.')
    }
  }

  async function applyBulkMetadata() {
    const selected = [...selectedCardIds]
    if (!selected.length) {
      return
    }

    const payload: Omit<UpdateOwnedCardMetadataInput, 'profileId' | 'scryfallId'> = {}
    if (bulkCondition.trim()) {
      payload.conditionCode = bulkCondition.trim().toUpperCase()
    }
    if (bulkLanguage.trim()) {
      payload.language = bulkLanguage.trim().toLowerCase()
    }
    if (bulkLocation.trim()) {
      payload.locationName = bulkLocation.trim()
    }

    if (!Object.keys(payload).length) {
      setMetadataError('Choose at least one bulk metadata field first.')
      return
    }

    setMetadataError('')
    try {
      await onBulkUpdateMetadata(selected, payload)
      setSelectedCardIds(new Set())
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : 'Bulk metadata update failed.')
    }
  }

  function openMetadataEditor(card: OwnedCard) {
    setEditingCardId(card.scryfallId)
    setEditCondition(card.conditionCode || 'NM')
    setEditLanguage(card.language || 'en')
    setEditLocation(card.locationName ?? '')
    setEditNotes(card.notes ?? '')
    setEditPurchasePrice(
      typeof card.purchasePrice === 'number' && Number.isFinite(card.purchasePrice)
        ? String(card.purchasePrice)
        : '',
    )
    setEditDateAdded(card.dateAdded ?? '')
    setMetadataError('')
  }

  function closeMetadataEditor() {
    setEditingCardId(null)
  }

  async function saveMetadataEditor() {
    if (!editingCard) {
      return
    }

    const payload: Omit<UpdateOwnedCardMetadataInput, 'profileId' | 'scryfallId'> = {
      conditionCode: editCondition.trim().toUpperCase(),
      language: editLanguage.trim().toLowerCase(),
      locationName: editLocation.trim(),
      notes: editNotes.trim(),
      dateAdded: editDateAdded.trim(),
    }

    if (editPurchasePrice.trim()) {
      const parsed = Number(editPurchasePrice.trim())
      if (!Number.isFinite(parsed) || parsed < 0) {
        setMetadataError('Purchase price must be a valid positive number.')
        return
      }
      payload.purchasePrice = parsed
    } else {
      payload.purchasePrice = null
    }

    setMetadataError('')
    try {
      await onUpdateMetadata(editingCard.scryfallId, payload)
      closeMetadataEditor()
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : 'Failed to save metadata.')
    }
  }

  const modalStep = modalMode === 'add' ? 1 : modalMode === 'versions' ? 2 : 0
  const modalProgressPct = modalStep > 0 ? (modalStep / 2) * 100 : 0

  return (
    <section className="panel collection-panel">
      <div className="panel-head">
        <div>
          <h2>{profileName} Collection</h2>
          <p className="muted">Collection-first view with quantity controls, tags, and market movement.</p>
        </div>
        <div className="collection-action-block">
          <div className="collection-actions">
            <button className="button paw-pill" onClick={handleOpenAddMenu} type="button">
              <img src="/ui-icons/plus.svg" className="ui-icon" alt="" aria-hidden="true" />
              Add Card
            </button>
            <button className="button paw-pill" onClick={onOpenMarket} type="button">
              Open Market
            </button>
            <button
              className="button subtle paw-pill"
              onClick={() => setIsImportWizardOpen(true)}
              type="button"
              disabled={isSyncing}
            >
              Import Collection File
            </button>
            <button className="button subtle paw-pill" type="button" disabled title="Export is being finalized">
              Export (soon)
            </button>
          </div>
          <div className="collection-actions collection-actions-secondary">
            <button
              className="button subtle"
              onClick={() => void onUndoLastAction()}
              type="button"
              disabled={!canUndo || isSyncing}
              title={undoLabel || 'Undo last action'}
            >
              Undo
            </button>
          </div>
        </div>
      </div>

      <div className="collection-toolbar">
        <div className="toolbar-section">
          <div className="view-toggle">
            <button className={`mode-pill paw-pill ${viewMode === 'text' ? 'active' : ''}`} onClick={() => setViewMode('text')} type="button">
              Text View
            </button>
            <button className={`mode-pill paw-pill ${viewMode === 'image' ? 'active' : ''}`} onClick={() => setViewMode('image')} type="button">
              Image View
            </button>
            <label className="mode-pill compact-toggle">
              <input
                type="checkbox"
                checked={compactMode}
                onChange={(event) => setCompactMode(event.target.checked)}
                disabled={viewMode === 'image'}
              />
              Compact Rows
            </label>
            <button className="mode-pill paw-pill" type="button" onClick={() => setShowAdvancedFilters((current) => !current)}>
              <img src="/ui-icons/filter.svg" className="ui-icon" alt="" aria-hidden="true" />
              {showAdvancedFilters ? 'Hide Filters' : 'Filters'}
            </button>
            <button className="mode-pill paw-pill" type="button" onClick={clearAllFilters}>
              Clear Filters
            </button>
          </div>
          <div className="density-toggle" role="group" aria-label="Row density">
            <button type="button" className={`density-pill ${rowDensity === 'comfortable' ? 'active' : ''}`} onClick={() => setRowDensity('comfortable')}>
              Comfortable
            </button>
            <button type="button" className={`density-pill ${rowDensity === 'balanced' ? 'active' : ''}`} onClick={() => setRowDensity('balanced')}>
              Balanced
            </button>
            <button type="button" className={`density-pill ${rowDensity === 'dense' ? 'active' : ''}`} onClick={() => setRowDensity('dense')}>
              Dense
            </button>
          </div>
        </div>
        <div className="toolbar-section toolbar-search-section">
          <div className="search-with-icon token-search-shell">
            <img src="/ui-icons/search.svg" className="ui-icon" alt="" aria-hidden="true" />
            <div
              className="tokenized-search-editor"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  event.preventDefault()
                  setActiveSearchBoxIndex(-1)
                  searchInputRef.current?.focus()
                }
              }}
            >
              {searchTermBoxes.map((box, index) => (
                <span key={`${box.token}-${index}`} className={`search-term-box chip-kind-${box.kind}`}>
                  <input
                    ref={(element) => {
                      searchTokenInputRefs.current[index] = element
                    }}
                    className="search-term-box-input"
                    type="text"
                    value={searchTerms[index] ?? ''}
                    style={{
                      width: `${Math.max(
                        4,
                        Math.min(40, (searchTerms[index] ?? '').trim().length + 1),
                      )}ch`,
                    }}
                    onChange={(event) => updateSearchTermAt(index, event.target.value)}
                    onFocus={() => {
                      handleSearchFocus()
                      setActiveSearchBoxIndex(index)
                    }}
                    onBlur={() => {
                      commitSearchTermNormalization()
                      handleSearchBlur()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Backspace' && !(searchTerms[index] ?? '').trim()) {
                        event.preventDefault()
                        removeSearchTermAt(index)
                        return
                      }
                      handleSearchKeyDown(event, index)
                    }}
                  />
                  <button
                    type="button"
                    className="search-term-box-remove"
                    title={`Remove ${box.token}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => removeSearchTermAt(index)}
                  >
                    x
                  </button>
                </span>
              ))}
              <input
                ref={searchInputRef}
                className={`collection-search search-draft-input ${searchDraft.trim() ? `chip-kind-${inferTokenKind(searchDraft)}` : ''}`}
                type="text"
                placeholder='Search cards (supports set:, t:, tag:, c:, mv>=, is:foil)'
                value={searchDraft}
                style={{
                  width: `${Math.max(8, Math.min(40, searchDraft.trim().length + 2))}ch`,
                }}
                onChange={(event) => handleSearchDraftChange(event.target.value)}
                onFocus={() => {
                  handleSearchFocus()
                  setActiveSearchBoxIndex(-1)
                }}
                onBlur={() => {
                  commitDraftAsTerm()
                  handleSearchBlur()
                }}
                onKeyDown={(event) => handleSearchKeyDown(event, -1)}
              />
            </div>
            {searchHasFocus ? (
              <div className="token-suggestion-dropdown">
                {isSuggestionLoading ? <p className="token-suggestion-empty">Loading suggestions...</p> : null}
                {!isSuggestionLoading && tokenSuggestions.length === 0 ? (
                  <p className="token-suggestion-empty">
                    {contextualTokenSuggestions.isContextMode
                      ? 'No options match this filter. Keep typing or remove this filter token.'
                      : 'No tokens match. Try set:, tag:, c:, or mv>=.'}
                  </p>
                ) : null}
                {!isSuggestionLoading && tokenSuggestions.length > 0 ? (
                  tokenSuggestions.map((token, index) => (
                    <button
                      key={`${token.kind}-${token.token}`}
                      type="button"
                      className={`token-suggestion-item token-kind-${inferTokenKind(token.token)} ${index === activeSuggestionIndex ? 'active' : ''}`}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        applyTokenSuggestion(token.token)
                      }}
                    >
                      <span className="token-suggestion-token">{token.token}</span>
                      <span className="token-suggestion-label">{token.label}</span>
                    </button>
                  ))
                ) : null}
              </div>
            ) : null}
          </div>
          <p className="muted small search-help-line">
            {'Tip: use set:mh3 tag:not_for_sale c:ur mv>=3 for fast narrowing.'}
          </p>
          {parsedSearchPlan.typeTerms.length > 0 && missingTypeMetadataCount > 0 ? (
            <p className="muted small search-help-line">
              {isHydratingTypeMetadata
                ? `Hydrating missing type metadata from Scryfall (${missingTypeMetadataCount} cards missing type data)...`
                : `Type metadata missing for ${missingTypeMetadataCount} cards. Type filter precision may be limited.`}
            </p>
          ) : null}
        </div>
      </div>

      <div className="collection-subtoolbar">
        <div className="quick-filter-row">
          <label className="quick-filter-control">
            <span className="muted small">Quick Set</span>
            <select
              className="tag-select"
              value={quickSetFilter}
              onChange={(event) => {
                const next = event.target.value
                startTransition(() => setQuickSetFilter(next))
              }}
            >
              <option value="">All Sets</option>
              {setOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="quick-filter-control">
            <span className="muted small">Quick Type</span>
            <select
              className="tag-select"
              value={quickTypeFilter}
              onChange={(event) => {
                const next = event.target.value
                startTransition(() => setQuickTypeFilter(next))
              }}
            >
              <option value="">All Types</option>
              {typeOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="quick-filter-control">
            <span className="muted small">Quick Color</span>
            <select
              className="tag-select"
              value={quickColorFilter}
              onChange={(event) => {
                const next = event.target.value
                startTransition(() => setQuickColorFilter(next))
              }}
            >
              <option value="">All Colors</option>
              {colorOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="sort-source-row">
          <label className="quick-filter-control">
            <span className="muted small">Sort</span>
            <select
              className="tag-select"
              value={sortColumn}
              onChange={(event) => {
                const nextColumn = event.target.value as SortColumn
                startTransition(() => {
                  setSortColumn(nextColumn)
                  setSortDirection(defaultSortDirectionFor(nextColumn))
                })
              }}
            >
              <option value="total">Total Qty</option>
              <option value="card">Card Name</option>
              <option value="price">Price</option>
              <option value="set">Set</option>
              <option value="number">Collector Number</option>
              <option value="type">Type</option>
              <option value="color">Color Identity</option>
              <option value="location">Location</option>
              <option value="condition">Condition</option>
              <option value="language">Language</option>
              <option value="dateAdded">Date Added</option>
              <option value="purchasePrice">Purchase Price</option>
              <option value="trend">Trend Delta</option>
              <option value="nonfoil">Nonfoil Qty</option>
              <option value="foil">Foil Qty</option>
              <option value="updated">Recently Updated</option>
            </select>
          </label>
          <label className="quick-filter-control">
            <span className="muted small">Direction</span>
            <select
              className="tag-select"
              value={sortDirection}
              onChange={(event) => {
                const next = event.target.value as SortDirection
                startTransition(() => setSortDirection(next))
              }}
            >
              <option value="desc">High to Low</option>
              <option value="asc">Low to High</option>
            </select>
          </label>
          <div className="price-source-stack">
            <label className="quick-filter-control">
              <span className="muted small">Price By</span>
              <select
                className="tag-select"
                value={priceByMode}
                onChange={(event) => {
                  const next = event.target.value as PriceByMode
                  startTransition(() => setPriceByMode(next))
                }}
              >
                <option value="unit">Unit Price</option>
                <option value="position">Total Position</option>
              </select>
            </label>
            <label className="quick-filter-control">
              <span className="muted small">Price Source</span>
              <select
                className="tag-select"
                value={priceSource}
                onChange={(event) => {
                  const next = event.target.value as PriceSourceId
                  startTransition(() => setPriceSource(next))
                }}
              >
                {PRICE_SOURCE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {showAdvancedFilters ? (
        <div className="advanced-filter-grid">
          <label>
            <span className="muted small">Finish</span>
            <select
              className="tag-select"
              value={finishFilter}
              onChange={(event) => setFinishFilter(event.target.value as FinishFilter)}
            >
              <option value="all">All</option>
              <option value="any-foil">Has Foil</option>
              <option value="nonfoil-only">Nonfoil Only</option>
            </select>
          </label>
          <details className="filter-dropdown">
            <summary>Set ({setFilters.size})</summary>
            <div className="filter-dropdown-body">
              {setOptions.map((value) => (
                <label key={value} className="filter-option">
                  <input type="checkbox" checked={setFilters.has(value)} onChange={() => toggleFilterValue(setSetFilters, value)} />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </details>
          <details className="filter-dropdown">
            <summary>Type ({typeFilters.size})</summary>
            <div className="filter-dropdown-body">
              {typeOptions.map((value) => (
                <label key={value} className="filter-option">
                  <input type="checkbox" checked={typeFilters.has(value)} onChange={() => toggleFilterValue(setTypeFilters, value)} />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </details>
          <details className="filter-dropdown">
            <summary>Color ({colorFilters.size})</summary>
            <div className="filter-dropdown-body">
              {colorOptions.map((value) => (
                <label key={value} className="filter-option">
                  <input type="checkbox" checked={colorFilters.has(value)} onChange={() => toggleFilterValue(setColorFilters, value)} />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </details>
          <details className="filter-dropdown">
            <summary>Tags ({tagFilters.size})</summary>
            <div className="filter-dropdown-body">
              {tagOptions.map((value) => (
                <label key={value} className="filter-option">
                  <input type="checkbox" checked={tagFilters.has(value)} onChange={() => toggleFilterValue(setTagFilters, value)} />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </details>
          <details className="filter-dropdown">
            <summary>Condition ({conditionFilters.size})</summary>
            <div className="filter-dropdown-body">
              {conditionOptions.map((value) => (
                <label key={value} className="filter-option">
                  <input type="checkbox" checked={conditionFilters.has(value)} onChange={() => toggleFilterValue(setConditionFilters, value)} />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </details>
          <details className="filter-dropdown">
            <summary>Language ({languageFilters.size})</summary>
            <div className="filter-dropdown-body">
              {languageOptions.map((value) => (
                <label key={value} className="filter-option">
                  <input type="checkbox" checked={languageFilters.has(value)} onChange={() => toggleFilterValue(setLanguageFilters, value)} />
                  <span>{value.toUpperCase()}</span>
                </label>
              ))}
            </div>
          </details>
        </div>
      ) : null}

      <div className="bulk-tag-toolbar">
        <span className="muted small">Selected {selectedCardIds.size}</span>
        <button className="button tiny subtle" type="button" onClick={selectVisibleRows}>
          Select Visible
        </button>
        <button className="button tiny subtle" type="button" onClick={clearSelectedRows}>
          Clear
        </button>
        <select
          className="tag-select"
          value={bulkCondition}
          onChange={(event) => setBulkCondition(event.target.value)}
        >
          <option value="">Condition</option>
          {CONDITION_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          className="tag-select"
          value={bulkLanguage}
          onChange={(event) => setBulkLanguage(event.target.value)}
        >
          <option value="">Language</option>
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          className="tag-input"
          value={bulkLocation}
          onChange={(event) => setBulkLocation(event.target.value)}
          placeholder="Location"
        />
        <button className="button tiny" type="button" onClick={() => void applyBulkMetadata()}>
          Apply Metadata
        </button>
      </div>

      {metadataError ? <p className="error-line">{metadataError}</p> : null}
      <ImportWizardModal
        isOpen={isImportWizardOpen}
        isBusy={isSyncing}
        onClose={() => setIsImportWizardOpen(false)}
        onImport={handleImportFromWizard}
      />

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
          <div className="list-control-row">
            <p className="muted small">Showing {sortedFilteredCards.length} of {cards.length} printings.</p>
            <div className="list-control-row-actions">
              {viewMode !== 'image' ? (
                <details className="filter-dropdown display-dropdown display-popout">
                  <summary>Display</summary>
                  <div className="filter-dropdown-body">
                    {TEXT_COLUMNS.map((column) => (
                      <label key={column.id} className="filter-option">
                        <input
                          type="checkbox"
                          checked={textColumnState[column.id]}
                          onChange={() => toggleTextColumn(column.id)}
                        />
                        <span>{column.label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              ) : null}
              <button
                className="button tiny danger"
                type="button"
                onClick={() => void handleRemoveSelectedRows()}
                disabled={selectedCardIds.size === 0 || isSyncing}
              >
                Remove Selected Rows
              </button>
            </div>
          </div>
          {viewMode === 'image' ? (
            <>
              <div className={`collection-image-grid density-${rowDensity}`} style={imageGridStyle}>
                {visibleImageCards.map((card) => {
                  const total = card.quantity + card.foilQuantity
                  const versions = versionCountsByName.get(normalize(card.name)) ?? 1
                  const imageSrc = resolveCardImageUrl(card.imageUrl, card.scryfallId)
                  const foilMode = !!foilModeByCard[card.scryfallId]
                  const activeTag = activeTagByCard[card.scryfallId]
                  const isSelected = selectedCardIds.has(card.scryfallId)

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
                          <CardArtImage key={imageSrc ?? 'no-image'} src={imageSrc} alt={card.name} />
                          <div className="overlay-badges">
                            <span className="badge badge-owned">Qty {total}</span>
                            {card.foilQuantity > 0 ? <span className="badge badge-foil">Foil {card.foilQuantity}</span> : null}
                            {versions > 1 ? <span className="badge badge-version">{versions} Vers</span> : null}
                          </div>
                        </div>
                      </button>

                      <div className="market-card-body">
                        <label className="select-row">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(event) => toggleSelectCard(card.scryfallId, event.target.checked)}
                          />
                          <span className="muted small">Select</span>
                        </label>
                        <button className="linkish-title" type="button" onClick={() => void handleOpenVersions(card)}>{card.name}</button>
                        <p className="muted small">{card.setCode.toUpperCase()} #{card.collectorNumber} · versions owned {versions}</p>
                        <p className="muted small">
                          {inferPrimaryType(card.typeLine)} · {colorIdentityLabel(card.colorIdentity)}
                        </p>
                        <p className="muted small">
                          {card.conditionCode}/{card.language.toUpperCase()}
                          {card.locationName ? ` · ${card.locationName}` : ''}
                        </p>

                        <div className="price-line">
                          <span className="price-current">{formatUsd(displayPriceForCard(card))}</span>
                          <span className={`trend trend-${trendForSource(card).priceDirection} trend-pill`}>
                            {trendGlyph(trendForSource(card).priceDirection)} {deltaText(trendForSource(card).priceDelta)}
                          </span>
                        </div>

                        <div className="tag-line">
                          {visibleUserTags(card.tags).slice(0, 5).map((tag) => (
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
                          <button className="button tiny subtle" type="button" onClick={() => void handleOpenVersions(card)}>
                            Versions
                          </button>
                          <button className="button tiny subtle" type="button" onClick={() => openMetadataEditor(card)}>
                            Edit
                          </button>
                          <button
                            className={`foil-check ${foilMode ? 'active' : ''}`}
                            type="button"
                            onClick={() => toggleFoilMode(card.scryfallId)}
                            title="Toggle foil mode for + and -"
                          >
                            ? Foil Mode
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>

              {imageLimit < sortedFilteredCards.length ? (
                <div className="centered-row">
                  <button className="button subtle" type="button" onClick={() => setImageLimit((current) => current + IMAGE_PAGE_SIZE)}>
                    Load More
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className={`virtual-list-shell density-${rowDensity}`}>
              <div
                className={`collection-head-row ${compactMode ? 'compact' : ''} density-${rowDensity}`}
                style={{ gridTemplateColumns: listGridTemplate }}
              >
                <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('card')}>
                  Card{sortIndicator('card')}
                </button>
                {!compactMode ? (
                  <>
                    {textColumnState.set ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('set')}>
                        Set{sortIndicator('set')}
                      </button>
                    ) : null}
                    {textColumnState.number ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('number')}>
                        #{sortIndicator('number')}
                      </button>
                    ) : null}
                    {textColumnState.type ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('type')}>
                        Type{sortIndicator('type')}
                      </button>
                    ) : null}
                    {textColumnState.color ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('color')}>
                        Color{sortIndicator('color')}
                      </button>
                    ) : null}
                    {textColumnState.tags ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('tags')}>
                        Tags{sortIndicator('tags')}
                      </button>
                    ) : null}
                    {textColumnState.location ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('location')}>
                        Location{sortIndicator('location')}
                      </button>
                    ) : null}
                    {textColumnState.condition ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('condition')}>
                        Condition{sortIndicator('condition')}
                      </button>
                    ) : null}
                    {textColumnState.language ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('language')}>
                        Language{sortIndicator('language')}
                      </button>
                    ) : null}
                    {textColumnState.dateAdded ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('dateAdded')}>
                        Date Added{sortIndicator('dateAdded')}
                      </button>
                    ) : null}
                    {textColumnState.purchasePrice ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('purchasePrice')}>
                        Purchase{sortIndicator('purchasePrice')}
                      </button>
                    ) : null}
                    {textColumnState.price ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('price')}>
                        Price{sortIndicator('price')}
                      </button>
                    ) : null}
                    {textColumnState.trend ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('trend')}>
                        Trend{sortIndicator('trend')}
                      </button>
                    ) : null}
                    {textColumnState.updated ? (
                      <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('updated')}>
                        Updated{sortIndicator('updated')}
                      </button>
                    ) : null}
                  </>
                ) : null}
                {compactMode ? (
                  <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('versions')}>
                    Versions{sortIndicator('versions')}
                  </button>
                ) : null}
                <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('nonfoil')}>
                  Nonfoil{sortIndicator('nonfoil')}
                </button>
                <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('foil')}>
                  Foil{sortIndicator('foil')}
                </button>
                <button type="button" className="head-sort-button" onClick={() => toggleSortColumn('total')}>
                  Total{sortIndicator('total')}
                </button>
                <span>Actions</span>
              </div>
              <div ref={listRef} className="virtual-list" onScroll={handleVirtualScroll} style={{ height: `${VIRTUAL_HEIGHT}px` }}>
                <div style={{ height: `${topPad}px` }} />
                {visibleRows.map((card) => {
                  const total = card.quantity + card.foilQuantity
                  const versions = versionCountsByName.get(normalize(card.name)) ?? 1
                  const isSelected = selectedCardIds.has(card.scryfallId)
                  const imageSrc = resolveCardImageUrl(card.imageUrl, card.scryfallId)

                  return (
                    <div
                      key={card.scryfallId}
                      className={`collection-row ${compactMode ? 'compact' : ''} density-${rowDensity}`}
                      style={{ gridTemplateColumns: listGridTemplate }}
                    >
                      <div className="card-cell-wrap">
                        <label className="select-row">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(event) => toggleSelectCard(card.scryfallId, event.target.checked)}
                          />
                        </label>
                        <div className="mini-art">
                          <CardArtImage key={imageSrc ?? 'no-image'} src={imageSrc} alt={card.name} />
                        </div>
                        <button className="linkish-title" type="button" onClick={() => void handleOpenVersions(card)}>{card.name}</button>
                      </div>
                      {!compactMode ? (
                        <>
                          {textColumnState.set ? <span>{card.setCode.toUpperCase()}</span> : null}
                          {textColumnState.number ? <span>{card.collectorNumber}</span> : null}
                          {textColumnState.type ? <span>{inferPrimaryType(card.typeLine)}</span> : null}
                          {textColumnState.color ? <span>{colorIdentityLabel(card.colorIdentity)}</span> : null}
                          {textColumnState.tags ? (
                            <div className="tag-line inline">
                              {visibleUserTags(card.tags).slice(0, 3).map((tag) => (
                                <span key={`${card.scryfallId}-${tag}`} className="tag-chip">{tag.toUpperCase()}</span>
                              ))}
                            </div>
                          ) : null}
                          {textColumnState.location ? <span>{card.locationName?.trim() ? card.locationName : '--'}</span> : null}
                          {textColumnState.condition ? <span>{card.conditionCode || '--'}</span> : null}
                          {textColumnState.language ? <span>{(card.language || '--').toUpperCase()}</span> : null}
                          {textColumnState.dateAdded ? <span>{formatDate(card.dateAdded ?? null)}</span> : null}
                          {textColumnState.purchasePrice ? <span>{formatUsd(card.purchasePrice ?? null)}</span> : null}
                          {textColumnState.price ? <span className="price-pill">{formatUsd(displayPriceForCard(card))}</span> : null}
                          {textColumnState.trend ? (
                            <span className={`trend trend-${trendForSource(card).priceDirection} trend-pill`}>
                              {trendGlyph(trendForSource(card).priceDirection)} {deltaText(trendForSource(card).priceDelta)}
                            </span>
                          ) : null}
                          {textColumnState.updated ? <span>{formatDate(card.updatedAt)}</span> : null}
                        </>
                      ) : null}
                      {compactMode ? <span className="muted">{versions}</span> : null}
                      <span>{card.quantity}</span><span>{card.foilQuantity}</span><span>{total}</span>
                      <div className="row-actions action-cluster">
                        <div className="qty-action-group">
                          <button className="button tiny action-mini" onClick={() => void onIncrement(card.scryfallId, false)} type="button">+N</button>
                          <button className="button tiny subtle action-mini" onClick={() => void onIncrement(card.scryfallId, true)} type="button">+F</button>
                          <button className="button tiny subtle action-mini" onClick={() => void onDecrement(card.scryfallId, false)} type="button">-N</button>
                          <button className="button tiny subtle action-mini" onClick={() => void onDecrement(card.scryfallId, true)} type="button">-F</button>
                        </div>
                        <button className="button tiny subtle action-mini" onClick={() => openMetadataEditor(card)} type="button">Edit</button>
                        <button className="button tiny danger action-mini" onClick={() => void onRemove(card.scryfallId)} type="button">Remove</button>
                      </div>
                    </div>
                  )
                })}
                <div style={{ height: `${bottomPad}px` }} />
              </div>
              <div className="table-status-strip">
                <span>{sortedFilteredCards.length} printings visible</span>
                <span>Sort: {SORT_COLUMN_LABELS[sortColumn]} ({sortDirection})</span>
                <span>Density: {rowDensity}</span>
                <span>Price By: {priceByMode === 'position' ? 'Total Position' : 'Unit Price'}</span>
                <span>Source: {PRICE_SOURCE_OPTIONS.find((entry) => entry.id === priceSource)?.label ?? 'unknown'}</span>
              </div>
            </div>
          )}
        </>
      )}

      {editingCard ? (
        <section className="version-panel">
          <div className="version-head">
            <div>
              <h3>Edit Metadata: {editingCard.name}</h3>
              <p className="muted small">Update condition, language, location, notes, and purchase details.</p>
            </div>
            <button className="button subtle tiny" type="button" onClick={closeMetadataEditor}>
              Close
            </button>
          </div>

          <div className="bulk-tag-toolbar">
            <select className="tag-select" value={editCondition} onChange={(event) => setEditCondition(event.target.value)}>
              {CONDITION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select className="tag-select" value={editLanguage} onChange={(event) => setEditLanguage(event.target.value)}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <input className="tag-input" value={editLocation} onChange={(event) => setEditLocation(event.target.value)} placeholder="Location" />
            <input className="tag-input" value={editPurchasePrice} onChange={(event) => setEditPurchasePrice(event.target.value)} placeholder="Purchase Price" />
            <input className="tag-input" value={editDateAdded} onChange={(event) => setEditDateAdded(event.target.value)} placeholder="Date Added (YYYY-MM-DD)" />
          </div>
          <textarea
            className="collection-search"
            value={editNotes}
            onChange={(event) => setEditNotes(event.target.value)}
            placeholder="Notes"
            rows={3}
          />
          <div className="row-actions">
            <button className="button tiny" type="button" onClick={() => void saveMetadataEditor()}>
              Save Metadata
            </button>
            <button className="button tiny subtle" type="button" onClick={closeMetadataEditor}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {modalMode ? createPortal(
        <div className="submenu-overlay" onClick={closeModal}>
          <section className="submenu-modal" onClick={(event) => event.stopPropagation()}>
            <div className="submenu-head">
              <div>
                <h3>{modalMode === 'versions' ? `${versionAnchor?.name ?? 'Card'} Versions` : 'Add Cards To Collection'}</h3>
                <p className="muted small">
                  {modalMode === 'versions'
                    ? 'Owned printings are highlighted first. Adjust quantities directly from this panel.'
                    : 'Search by card name or Scryfall syntax, then add nonfoil or foil instantly.'}
                </p>
              </div>
              <button className="icon-ghost-button" type="button" onClick={closeModal} aria-label="Close submenu">
                <img src="/ui-icons/x.svg" className="ui-icon" alt="" aria-hidden="true" />
              </button>
            </div>

            <div className="submenu-steps">
              <button
                className={`step-pill ${modalMode === 'add' ? 'active' : ''}`}
                type="button"
                onClick={() => setModalMode('add')}
              >
                1. Add Card
              </button>
              <button
                className={`step-pill ${modalMode === 'versions' ? 'active' : ''}`}
                type="button"
                onClick={() => versionAnchor && setModalMode('versions')}
                disabled={!versionAnchor}
              >
                2. Versions
              </button>
            </div>
            <div className="submenu-progress-rail" aria-hidden="true">
              <span className="submenu-progress-fill" style={{ width: `${modalProgressPct}%` }} />
            </div>
            <p className="muted small submenu-step-caption">
              Step {modalStep || 1} of 2
              {modalMode === 'add' ? ': search and add a printing' : ': review versions and adjust quantities'}
            </p>

            {modalMode === 'add' ? (
              <div className="submenu-content">
                <div className="submenu-layout">
                  <div className="submenu-main">
                    <form
                      className="submenu-search-row"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void handleSearchAddMenu()
                      }}
                    >
                      <div className="search-with-icon">
                        <img src="/ui-icons/search.svg" className="ui-icon" alt="" aria-hidden="true" />
                        <input
                          className="collection-search"
                          value={addMenuQuery}
                          onChange={(event) => setAddMenuQuery(event.target.value)}
                          placeholder='Search cards to add (e.g. name:"Sol Ring" or set:lea)'
                        />
                      </div>
                      <button className="button paw-pill" type="submit" disabled={isSearchingAddMenu}>
                        {isSearchingAddMenu ? 'Searching...' : 'Search'}
                      </button>
                    </form>

                    {addMenuError ? <p className="error-line">{addMenuError}</p> : null}
                    {addMenuResults.length > 0 ? (
                      <div className="version-grid">
                        {addMenuResults.map((row) => {
                          const owned = ownedByScryfallId.get(row.scryfallId)
                          const ownedTotal = (owned?.quantity ?? 0) + (owned?.foilQuantity ?? 0)
                          return (
                            <article key={`add-${row.scryfallId}`} className={`version-card ${ownedTotal > 0 ? 'owned' : 'unowned'}`}>
                              <div className="version-image-wrap">
                                <CardArtImage
                                  key={resolveCardImageUrl(row.imageUrl, row.scryfallId) ?? 'no-image'}
                                  src={resolveCardImageUrl(row.imageUrl, row.scryfallId)}
                                  alt={`${row.name} ${row.setCode}`}
                                />
                              </div>
                              <div className="version-body">
                                <p>{row.name}</p>
                                <p className="muted small">{row.setCode} #{row.collectorNumber} · {formatDate(row.releasedAt)}</p>
                                <p className="muted small">{inferPrimaryType(row.typeLine)} · {colorIdentityLabel(row.colorIdentity)}</p>
                                <p className="small">Owned: {owned?.quantity ?? 0} nonfoil / {owned?.foilQuantity ?? 0} foil</p>
                                <div className="row-actions action-cluster">
                                  <button className="button tiny action-mini" type="button" onClick={() => void handleAddMenuAdjust(row, false)}>+N</button>
                                  <button className="button tiny subtle action-mini" type="button" onClick={() => void handleAddMenuAdjust(row, true)}>+F</button>
                                  <button className="button tiny subtle action-mini" type="button" onClick={() => {
                                    const nextAnchor: OwnedCard = owned ?? {
                                      scryfallId: row.scryfallId,
                                      name: row.name,
                                      setCode: row.setCode.toLowerCase(),
                                      collectorNumber: row.collectorNumber,
                                      imageUrl: row.imageUrl ?? undefined,
                                      typeLine: row.typeLine ?? null,
                                      colorIdentity: row.colorIdentity,
                                      manaValue: row.manaValue,
                                      rarity: row.rarity,
                                      quantity: 0,
                                      foilQuantity: 0,
                                      updatedAt: new Date().toISOString(),
                                      tags: [],
                                      currentPrice: row.marketPrice,
                                      previousPrice: null,
                                      priceDelta: null,
                                      priceDirection: 'none',
                                      lastPriceAt: null,
                                      conditionCode: 'NM',
                                      language: 'en',
                                      locationName: null,
                                      notes: null,
                                      purchasePrice: null,
                                      dateAdded: null,
                                    }
                                    void handleOpenVersions(nextAnchor)
                                  }}>Versions</button>
                                </div>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                  <aside className="submenu-side">
                    <h4>Add Flow Guide</h4>
                    <p className="muted small">Use card name or syntax, then add nonfoil or foil directly from results.</p>
                    <ul className="submenu-hints">
                      <li>Use quotes for exact names: <code>name:"Sol Ring"</code></li>
                      <li>Use set filters: <code>set:mh3</code></li>
                      <li>Click Versions to inspect all printings.</li>
                    </ul>
                    <p className="muted small">Matches: {addMenuResults.length}</p>
                  </aside>
                </div>
              </div>
            ) : null}

            {modalMode === 'versions' && versionAnchor ? (
              <div className="submenu-content">
                {isLoadingVersions ? <p className="muted">Loading versions from Scryfall...</p> : null}
                {versionError ? <p className="error-line">{versionError}</p> : null}
                {!isLoadingVersions && !versionError ? (
                  <div className="version-grid">
                    {versionRows.map((row) => {
                      const total = row.ownedQuantity + row.ownedFoilQuantity
                      const owned = total > 0
                      return (
                        <article key={row.scryfallId} className={`version-card ${owned ? 'owned' : 'unowned'}`}>
                          <div className="version-image-wrap">
                            <CardArtImage
                              key={resolveCardImageUrl(row.imageUrl, row.scryfallId) ?? 'no-image'}
                              src={resolveCardImageUrl(row.imageUrl, row.scryfallId)}
                              alt={`${versionAnchor.name} ${row.setCode}`}
                            />
                          </div>
                          <div className="version-body">
                            <p>{row.setCode} #{row.collectorNumber}</p>
                            <p className="muted small">Released {formatDate(row.releasedAt)}</p>
                            <p className="small">Owned: {row.ownedQuantity} nonfoil / {row.ownedFoilQuantity} foil</p>
                            <div className="row-actions action-cluster">
                              <button className="button tiny action-mini" type="button" onClick={() => void handleVersionAdjust(row, false, 1, versionAnchor.name)}>+N</button>
                              <button className="button tiny subtle action-mini" type="button" onClick={() => void handleVersionAdjust(row, true, 1, versionAnchor.name)}>+F</button>
                              <button className="button tiny subtle action-mini" type="button" disabled={row.ownedQuantity <= 0} onClick={() => void handleVersionAdjust(row, false, -1, versionAnchor.name)}>-N</button>
                              <button className="button tiny subtle action-mini" type="button" disabled={row.ownedFoilQuantity <= 0} onClick={() => void handleVersionAdjust(row, true, -1, versionAnchor.name)}>-F</button>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>,
        document.body,
      ) : null}
    </section>
  )
}




