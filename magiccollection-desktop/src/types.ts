export type AppTab = 'collection' | 'market' | 'reports' | 'settings'
export type PriceDirection = 'up' | 'down' | 'flat' | 'none'

export interface CreateProfileRequest {
  name: string
  passcode?: string
}

export interface Profile {
  id: string
  name: string
  createdAt: string
}

export interface PriceTrend {
  currentPrice: number | null
  previousPrice: number | null
  priceDelta: number | null
  priceDirection: PriceDirection
  lastPriceAt: string | null
}

export interface OwnedCard {
  scryfallId: string
  name: string
  setCode: string
  collectorNumber: string
  imageUrl?: string
  typeLine?: string | null
  colorIdentity?: string[]
  manaValue?: number | null
  rarity?: string | null
  quantity: number
  foilQuantity: number
  updatedAt: string
  tags: string[]
  currentPrice: number | null
  previousPrice: number | null
  priceDelta: number | null
  priceDirection: PriceDirection
  lastPriceAt: string | null
  conditionCode: string
  language: string
  locationName?: string | null
  notes?: string | null
  purchasePrice?: number | null
  dateAdded?: string | null
}

export type OwnedCardMap = Record<string, OwnedCard>

export interface AddCardInput {
  profileId: string
  scryfallId: string
  name: string
  setCode: string
  collectorNumber: string
  imageUrl?: string
  typeLine?: string | null
  colorIdentity?: string[]
  manaValue?: number | null
  rarity?: string | null
  foil: boolean
  currentPrice?: number | null
  tags?: string[]
}

export interface MarketCard {
  scryfallId: string
  name: string
  setCode: string
  collectorNumber: string
  imageUrl?: string
  typeLine?: string | null
  colorIdentity?: string[]
  manaValue?: number | null
  rarity?: string | null
  currentPrice: number | null
  previousPrice: number | null
  priceDelta: number | null
  priceDirection: PriceDirection
  lastPriceAt: string | null
  tags: string[]
}

export interface MarketSnapshotInput {
  scryfallId: string
  name: string
  setCode: string
  collectorNumber: string
  imageUrl?: string
  marketPrice: number | null
}

export interface MarketTrend {
  scryfallId: string
  currentPrice: number | null
  previousPrice: number | null
  priceDelta: number | null
  priceDirection: PriceDirection
  lastPriceAt: string | null
}

export interface CollectionImportRow {
  scryfallId: string
  name: string
  setCode: string
  collectorNumber: string
  imageUrl?: string | null
  typeLine?: string | null
  colorIdentity?: string[]
  manaValue?: number | null
  rarity?: string | null
  quantity: number
  foilQuantity: number
  tags?: string[]
  locationName?: string | null
  conditionCode?: string
  language?: string
  notes?: string | null
  purchasePrice?: number | null
  dateAdded?: string | null
}

export interface CollectionImportResult {
  rowsImported: number
  copiesImported: number
  rowsSkipped: number
}

export interface BulkTagRequest {
  profileId: string
  scryfallIds: string[]
  tags: string[]
  includeAutoRules: boolean
}

export interface UpdateOwnedCardMetadataInput {
  profileId: string
  scryfallId: string
  conditionCode?: string
  language?: string
  locationName?: string
  notes?: string
  purchasePrice?: number | null
  dateAdded?: string
}

export interface FilterToken {
  token: string
  label: string
  kind: string
  source: string
  priority: number
}
