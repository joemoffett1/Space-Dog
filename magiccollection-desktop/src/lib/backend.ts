import { invoke } from '@tauri-apps/api/core'
import { loadCollection, loadProfiles, saveCollection, saveProfiles } from './storage'
import type {
  AddCardInput,
  BulkTagRequest,
  CollectionImportRow,
  FilterToken,
  MarketSnapshotInput,
  MarketTrend,
  OwnedCard,
  OwnedCardMap,
  PriceDirection,
  Profile,
  UpdateOwnedCardMetadataInput,
} from '../types'

const MARKET_SNAPSHOT_KEY = 'magiccollection.market-snapshots.v1'

export interface HydrateProfileCardMetadataResult {
  attempted: number
  hydrated: number
  remaining: number
}

interface PriceHistoryEntry {
  price: number
  capturedAt: string
}

type PriceHistoryMap = Record<string, PriceHistoryEntry[]>

function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return fallback
    }
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value))
}

function nowIso(): string {
  return new Date().toISOString()
}

function toDirection(delta: number | null): PriceDirection {
  if (delta === null) {
    return 'none'
  }
  if (delta > 0.009) {
    return 'up'
  }
  if (delta < -0.009) {
    return 'down'
  }
  return 'flat'
}

function loadPriceHistories(): PriceHistoryMap {
  return readJson<PriceHistoryMap>(MARKET_SNAPSHOT_KEY, {})
}

function savePriceHistories(histories: PriceHistoryMap): void {
  writeJson(MARKET_SNAPSHOT_KEY, histories)
}

function recordSnapshotLocal(scryfallId: string, marketPrice: number): void {
  const histories = loadPriceHistories()
  const history = histories[scryfallId] ?? []
  const last = history[0]
  if (last && Math.abs(last.price - marketPrice) < 0.0001) {
    return
  }

  const next = [{ price: marketPrice, capturedAt: nowIso() }, ...history].slice(0, 100)
  histories[scryfallId] = next
  savePriceHistories(histories)
}

function trendForIdLocal(scryfallId: string): MarketTrend {
  const history = loadPriceHistories()[scryfallId] ?? []
  const current = history[0]?.price ?? null
  const previous = history[1]?.price ?? null
  const delta = current !== null && previous !== null ? current - previous : null
  return {
    scryfallId,
    currentPrice: current,
    previousPrice: previous,
    priceDelta: delta,
    priceDirection: toDirection(delta),
    lastPriceAt: history[0]?.capturedAt ?? null,
  }
}

function deriveTags(quantity: number, foilQuantity: number, tags: string[] = []): string[] {
  const merged = new Set(tags.map((tag) => tag.trim()).filter(Boolean))
  if (foilQuantity > 0) {
    merged.add('foil')
  }
  if (quantity + foilQuantity >= 4) {
    merged.add('playset')
  }
  if (quantity + foilQuantity >= 1) {
    merged.add('owned')
  }
  return [...merged]
}

function normalizeCollectionCard(
  input: Partial<OwnedCard> & Pick<OwnedCard, 'scryfallId' | 'name' | 'setCode' | 'collectorNumber'>,
): OwnedCard {
  const quantity = Math.max(0, Number(input.quantity ?? 0))
  const foilQuantity = Math.max(0, Number(input.foilQuantity ?? 0))
  const trend = trendForIdLocal(input.scryfallId)
  return {
    scryfallId: input.scryfallId,
    name: input.name,
    setCode: input.setCode,
    collectorNumber: input.collectorNumber,
    imageUrl: input.imageUrl,
    typeLine: input.typeLine ?? null,
    colorIdentity: Array.isArray(input.colorIdentity) ? [...input.colorIdentity] : [],
    manaValue:
      typeof input.manaValue === 'number' && Number.isFinite(input.manaValue)
        ? input.manaValue
        : null,
    rarity: input.rarity ?? null,
    quantity,
    foilQuantity,
    updatedAt: input.updatedAt ?? nowIso(),
    tags: deriveTags(quantity, foilQuantity, input.tags ?? []),
    currentPrice: input.currentPrice ?? trend.currentPrice,
    previousPrice: input.previousPrice ?? trend.previousPrice,
    priceDelta: input.priceDelta ?? trend.priceDelta,
    priceDirection: input.priceDirection ?? trend.priceDirection,
    lastPriceAt: input.lastPriceAt ?? trend.lastPriceAt,
    conditionCode: input.conditionCode?.trim() || 'NM',
    language: input.language?.trim() || 'en',
    locationName: input.locationName ?? null,
    notes: input.notes ?? null,
    purchasePrice:
      typeof input.purchasePrice === 'number' && Number.isFinite(input.purchasePrice)
        ? input.purchasePrice
        : null,
    dateAdded: input.dateAdded ?? null,
  }
}

function toCardMap(cards: OwnedCard[]): OwnedCardMap {
  return cards.reduce<OwnedCardMap>((acc, card) => {
    acc[card.scryfallId] = card
    return acc
  }, {})
}

function generateProfileId(name: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${name.trim().toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`
}

async function fallbackListProfiles(): Promise<Profile[]> {
  return loadProfiles()
}

async function fallbackCreateProfile(name: string): Promise<Profile> {
  const normalized = name.trim()
  if (!normalized) {
    throw new Error('Profile name is required.')
  }

  const profiles = loadProfiles()
  const existing = profiles.find(
    (profile) => profile.name.trim().toLowerCase() === normalized.toLowerCase(),
  )
  if (existing) {
    return existing
  }

  const profile: Profile = {
    id: generateProfileId(normalized),
    name: normalized,
    createdAt: nowIso(),
  }
  saveProfiles([...profiles, profile])
  return profile
}

async function fallbackGetCollection(profileId: string): Promise<OwnedCard[]> {
  const map = loadCollection(profileId)
  return Object.values(map)
    .map((card) => normalizeCollectionCard(card))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fallbackAddCardToCollection(input: AddCardInput): Promise<OwnedCard[]> {
  const current = loadCollection(input.profileId)
  const existing = current[input.scryfallId]
  const next: OwnedCard = normalizeCollectionCard({
    scryfallId: input.scryfallId,
    name: existing?.name ?? input.name,
    setCode: existing?.setCode ?? input.setCode,
    collectorNumber: existing?.collectorNumber ?? input.collectorNumber,
    imageUrl: existing?.imageUrl ?? input.imageUrl,
    typeLine: existing?.typeLine ?? input.typeLine ?? null,
    colorIdentity:
      existing?.colorIdentity && existing.colorIdentity.length
        ? existing.colorIdentity
        : input.colorIdentity ?? [],
    manaValue: existing?.manaValue ?? input.manaValue ?? null,
    rarity: existing?.rarity ?? input.rarity ?? null,
    quantity: existing?.quantity ?? 0,
    foilQuantity: existing?.foilQuantity ?? 0,
    updatedAt: nowIso(),
    tags: deriveTags(
      existing?.quantity ?? 0,
      existing?.foilQuantity ?? 0,
      input.tags ?? existing?.tags ?? [],
    ),
  })

  if (input.foil) {
    next.foilQuantity += 1
  } else {
    next.quantity += 1
  }
  next.tags = deriveTags(next.quantity, next.foilQuantity, next.tags)

  if (typeof input.currentPrice === 'number' && Number.isFinite(input.currentPrice)) {
    recordSnapshotLocal(input.scryfallId, input.currentPrice)
  }

  current[input.scryfallId] = normalizeCollectionCard(next)
  saveCollection(input.profileId, current)
  return fallbackGetCollection(input.profileId)
}

async function fallbackUpdateCardQuantity(input: {
  profileId: string
  scryfallId: string
  foil: boolean
  delta: number
}): Promise<OwnedCard[]> {
  const current = loadCollection(input.profileId)
  const existing = current[input.scryfallId]
  if (!existing) {
    return fallbackGetCollection(input.profileId)
  }

  const next = normalizeCollectionCard(existing)
  if (input.foil) {
    next.foilQuantity = Math.max(0, next.foilQuantity + input.delta)
  } else {
    next.quantity = Math.max(0, next.quantity + input.delta)
  }
  next.updatedAt = nowIso()
  next.tags = deriveTags(next.quantity, next.foilQuantity, next.tags)

  if (next.quantity + next.foilQuantity <= 0) {
    delete current[input.scryfallId]
  } else {
    current[input.scryfallId] = normalizeCollectionCard(next)
  }

  saveCollection(input.profileId, current)
  return fallbackGetCollection(input.profileId)
}

async function fallbackRemoveCardFromCollection(input: {
  profileId: string
  scryfallId: string
}): Promise<OwnedCard[]> {
  const current = loadCollection(input.profileId)
  delete current[input.scryfallId]
  saveCollection(input.profileId, current)
  return fallbackGetCollection(input.profileId)
}

async function fallbackImportCollectionRows(input: {
  profileId: string
  rows: CollectionImportRow[]
}): Promise<OwnedCard[]> {
  const current = loadCollection(input.profileId)

  for (const row of input.rows) {
    const existing = current[row.scryfallId]
    const next = normalizeCollectionCard({
      scryfallId: row.scryfallId,
      name: existing?.name ?? row.name,
      setCode: existing?.setCode ?? row.setCode,
      collectorNumber: existing?.collectorNumber ?? row.collectorNumber,
      imageUrl: existing?.imageUrl,
      typeLine: existing?.typeLine ?? row.typeLine ?? null,
      colorIdentity:
        existing?.colorIdentity && existing.colorIdentity.length
          ? existing.colorIdentity
          : row.colorIdentity ?? [],
      manaValue: existing?.manaValue ?? row.manaValue ?? null,
      rarity: existing?.rarity ?? row.rarity ?? null,
      quantity: Math.max(0, (existing?.quantity ?? 0) + row.quantity),
      foilQuantity: Math.max(0, (existing?.foilQuantity ?? 0) + row.foilQuantity),
      tags: [...new Set([...(existing?.tags ?? []), ...(row.tags ?? [])])],
      updatedAt: nowIso(),
    })
    current[row.scryfallId] = next
  }

  saveCollection(input.profileId, current)
  return fallbackGetCollection(input.profileId)
}

async function fallbackRecordMarketSnapshots(
  snapshots: MarketSnapshotInput[],
): Promise<void> {
  snapshots.forEach((snapshot) => {
    if (typeof snapshot.marketPrice === 'number' && Number.isFinite(snapshot.marketPrice)) {
      recordSnapshotLocal(snapshot.scryfallId, snapshot.marketPrice)
    }
  })
}

async function fallbackGetMarketPriceTrends(
  scryfallIds: string[],
): Promise<MarketTrend[]> {
  return scryfallIds.map((id) => trendForIdLocal(id))
}

async function fallbackBulkUpdateTags(input: BulkTagRequest): Promise<OwnedCard[]> {
  const current = loadCollection(input.profileId)
  const manualTags = input.tags.map((tag) => tag.trim()).filter(Boolean)

  for (const scryfallId of input.scryfallIds) {
    const existing = current[scryfallId]
    if (!existing) {
      continue
    }

    const merged = new Set(existing.tags)
    for (const tag of manualTags) {
      merged.add(tag)
    }

    const nextTags = input.includeAutoRules
      ? deriveTags(existing.quantity, existing.foilQuantity, [...merged])
      : [...merged]

    current[scryfallId] = normalizeCollectionCard({
      ...existing,
      tags: nextTags,
      updatedAt: nowIso(),
    })
  }

  saveCollection(input.profileId, current)
  return fallbackGetCollection(input.profileId)
}

async function fallbackUpdateOwnedCardMetadata(
  input: UpdateOwnedCardMetadataInput,
): Promise<OwnedCard[]> {
  const current = loadCollection(input.profileId)
  const existing = current[input.scryfallId]
  if (!existing) {
    return fallbackGetCollection(input.profileId)
  }

  const next = normalizeCollectionCard({
    ...existing,
    conditionCode:
      typeof input.conditionCode === 'string' && input.conditionCode.trim()
        ? input.conditionCode.trim().toUpperCase()
        : existing.conditionCode,
    language:
      typeof input.language === 'string' && input.language.trim()
        ? input.language.trim().toLowerCase()
        : existing.language,
    locationName:
      typeof input.locationName === 'string'
        ? input.locationName.trim() || null
        : existing.locationName ?? null,
    notes:
      typeof input.notes === 'string'
        ? input.notes.trim() || null
        : existing.notes ?? null,
    purchasePrice:
      typeof input.purchasePrice === 'number' && Number.isFinite(input.purchasePrice)
        ? input.purchasePrice
        : input.purchasePrice === null
          ? null
          : existing.purchasePrice ?? null,
    dateAdded:
      typeof input.dateAdded === 'string'
        ? input.dateAdded.trim() || null
        : existing.dateAdded ?? null,
    updatedAt: nowIso(),
  })

  current[input.scryfallId] = next
  saveCollection(input.profileId, current)
  return fallbackGetCollection(input.profileId)
}

async function fallbackSetOwnedCardState(input: {
  profileId: string
  card: OwnedCard
}): Promise<OwnedCard[]> {
  const current = loadCollection(input.profileId)
  const next = normalizeCollectionCard({
    ...input.card,
    quantity: Math.max(0, Math.floor(input.card.quantity)),
    foilQuantity: Math.max(0, Math.floor(input.card.foilQuantity)),
    tags: [...input.card.tags],
    typeLine: input.card.typeLine ?? null,
    colorIdentity: [...(input.card.colorIdentity ?? [])],
    manaValue: input.card.manaValue ?? null,
    rarity: input.card.rarity ?? null,
    updatedAt: nowIso(),
  })

  if (next.quantity + next.foilQuantity <= 0) {
    delete current[input.card.scryfallId]
  } else {
    current[input.card.scryfallId] = next
  }

  saveCollection(input.profileId, current)
  return fallbackGetCollection(input.profileId)
}

export async function listProfiles(): Promise<Profile[]> {
  if (!hasTauriRuntime()) {
    return fallbackListProfiles()
  }
  return invoke<Profile[]>('list_profiles')
}

export async function createProfile(name: string): Promise<Profile> {
  if (!hasTauriRuntime()) {
    return fallbackCreateProfile(name)
  }
  return invoke<Profile>('create_profile', { name })
}

export async function getCollection(profileId: string): Promise<OwnedCard[]> {
  if (!hasTauriRuntime()) {
    return fallbackGetCollection(profileId)
  }
  return invoke<OwnedCard[]>('get_collection', { profileId })
}

export async function addCardToCollection(input: AddCardInput): Promise<OwnedCard[]> {
  if (!hasTauriRuntime()) {
    return fallbackAddCardToCollection(input)
  }
  return invoke<OwnedCard[]>('add_card_to_collection', { input })
}

export async function updateCardQuantity(input: {
  profileId: string
  scryfallId: string
  foil: boolean
  delta: number
}): Promise<OwnedCard[]> {
  if (!hasTauriRuntime()) {
    return fallbackUpdateCardQuantity(input)
  }
  return invoke<OwnedCard[]>('update_card_quantity', { input })
}

export async function removeCardFromCollection(input: {
  profileId: string
  scryfallId: string
}): Promise<OwnedCard[]> {
  if (!hasTauriRuntime()) {
    return fallbackRemoveCardFromCollection(input)
  }
  return invoke<OwnedCard[]>('remove_card_from_collection', { input })
}

export async function recordMarketSnapshots(
  snapshots: MarketSnapshotInput[],
): Promise<void> {
  if (!snapshots.length) {
    return
  }
  if (!hasTauriRuntime()) {
    return fallbackRecordMarketSnapshots(snapshots)
  }
  await invoke('record_market_snapshots', { snapshots })
}

export async function getMarketPriceTrends(
  scryfallIds: string[],
): Promise<MarketTrend[]> {
  if (!scryfallIds.length) {
    return []
  }
  if (!hasTauriRuntime()) {
    return fallbackGetMarketPriceTrends(scryfallIds)
  }
  return invoke<MarketTrend[]>('get_market_price_trends', {
    scryfallIds,
  })
}

export async function importCollectionRows(input: {
  profileId: string
  rows: CollectionImportRow[]
}): Promise<OwnedCard[]> {
  if (!input.rows.length) {
    return getCollection(input.profileId)
  }
  if (!hasTauriRuntime()) {
    return fallbackImportCollectionRows(input)
  }
  return invoke<OwnedCard[]>('import_collection_rows', { input })
}

export async function bulkUpdateTags(input: BulkTagRequest): Promise<OwnedCard[]> {
  if (!input.scryfallIds.length) {
    return getCollection(input.profileId)
  }
  if (!hasTauriRuntime()) {
    return fallbackBulkUpdateTags(input)
  }
  return invoke<OwnedCard[]>('bulk_update_tags', { input })
}

export async function updateOwnedCardMetadata(
  input: UpdateOwnedCardMetadataInput,
): Promise<OwnedCard[]> {
  if (!hasTauriRuntime()) {
    return fallbackUpdateOwnedCardMetadata(input)
  }
  return invoke<OwnedCard[]>('update_owned_card_metadata', { input })
}

export async function setOwnedCardState(input: {
  profileId: string
  card: OwnedCard
}): Promise<OwnedCard[]> {
  if (!hasTauriRuntime()) {
    return fallbackSetOwnedCardState(input)
  }
  return invoke<OwnedCard[]>('set_owned_card_state', { input })
}

export function asCardMap(cards: OwnedCard[]): OwnedCardMap {
  return toCardMap(cards)
}

function fallbackFilterTokens(query: string, limit = 30): FilterToken[] {
  const normalizedQuery = query.trim().toLowerCase()
  const allCollections = loadProfiles().flatMap((profile) =>
    Object.values(loadCollection(profile.id)),
  )
  const tokens = new Map<string, FilterToken>()

  const seed = [
    ['set:', 'Set code (example: set:neo)', 'scryfall'],
    ['t:', 'Type line (example: t:creature)', 'scryfall'],
    ['tag:', 'Internal tag (example: tag:owned)', 'internal'],
    ['c:', 'Color identity (example: c:uw)', 'scryfall'],
    ['id:', 'Color identity exact-ish (example: id:g)', 'scryfall'],
    ['rarity:', 'Rarity (example: rarity:rare)', 'scryfall'],
    ['mv>=', 'Mana value compare (example: mv>=3)', 'scryfall'],
    ['lang:', 'Language (example: lang:en)', 'internal'],
    ['cond:', 'Condition (example: cond:nm)', 'internal'],
    ['is:foil', 'Foil printings', 'scryfall'],
    ['is:nonfoil', 'Nonfoil printings', 'scryfall'],
  ] as const

  seed.forEach(([token, label, kind], index) => {
    tokens.set(`${kind}:${token}`, {
      token,
      label,
      kind,
      source: 'seed',
      priority: index + 1,
    })
  })

  allCollections.forEach((card) => {
    tokens.set(`set:${card.setCode.toLowerCase()}`, {
      token: `set:${card.setCode.toLowerCase()}`,
      label: `Set ${card.setCode.toUpperCase()}`,
      kind: 'set',
      source: 'derived',
      priority: 50,
    })
    card.tags.forEach((tag) => {
      const normalizedTag = tag.trim().toLowerCase()
      if (!normalizedTag) return
      tokens.set(`tag:${normalizedTag}`, {
        token: `tag:${normalizedTag}`,
        label: `Tag ${tag.trim()}`,
        kind: 'tag',
        source: 'derived',
        priority: 60,
      })
    })
  })

  return [...tokens.values()]
    .filter((token) => {
      if (!normalizedQuery) return true
      return (
        token.token.toLowerCase().includes(normalizedQuery) ||
        token.label.toLowerCase().includes(normalizedQuery)
      )
    })
    .sort((a, b) => a.priority - b.priority || a.token.localeCompare(b.token))
    .slice(0, Math.max(1, limit))
}

export async function syncFilterTokens(profileId: string): Promise<number> {
  if (!hasTauriRuntime()) {
    return fallbackFilterTokens('', 200).length
  }
  return invoke<number>('sync_filter_tokens', { profileId })
}

export async function getFilterTokens(
  query: string,
  limit = 30,
): Promise<FilterToken[]> {
  if (!hasTauriRuntime()) {
    return fallbackFilterTokens(query, limit)
  }
  return invoke<FilterToken[]>('get_filter_tokens', {
    input: { query, limit },
  })
}

export async function hydrateProfileCardMetadata(input: {
  profileId: string
  maxCards?: number
}): Promise<HydrateProfileCardMetadataResult> {
  if (!hasTauriRuntime()) {
    return { attempted: 0, hydrated: 0, remaining: 0 }
  }
  return invoke<HydrateProfileCardMetadataResult>('hydrate_profile_card_metadata', {
    input,
  })
}
