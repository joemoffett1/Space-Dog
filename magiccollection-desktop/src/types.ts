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
  quantity: number
  foilQuantity: number
  updatedAt: string
  tags: string[]
  currentPrice: number | null
  previousPrice: number | null
  priceDelta: number | null
  priceDirection: PriceDirection
  lastPriceAt: string | null
}

export type OwnedCardMap = Record<string, OwnedCard>

export interface AddCardInput {
  profileId: string
  scryfallId: string
  name: string
  setCode: string
  collectorNumber: string
  imageUrl?: string
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
  quantity: number
  foilQuantity: number
  tags?: string[]
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
