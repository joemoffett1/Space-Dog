import type { OwnedCard } from '../types'

export interface CkQuote {
  scryfallId: string
  name: string
  quantity: number
  cashPrice: number
  creditPrice: number
  qtyCap: number
  sourceUrl: string
}

export interface CkQuoteResult {
  enabled: boolean
  provider: 'mock' | 'api' | 'disabled'
  quotes: CkQuote[]
  warning?: string
}

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function readLocalFlag(key: string): string {
  if (!hasWindow()) {
    return ''
  }
  return window.localStorage.getItem(key) ?? ''
}

function asUsd(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100)
}

function resolveConfig() {
  const env = import.meta.env
  const enabled =
    (env.VITE_ENABLE_CK as string | undefined) === '1' ||
    readLocalFlag('magiccollection.ck.enabled') === '1'
  const endpoint =
    (env.VITE_CK_PROXY_URL as string | undefined) ||
    readLocalFlag('magiccollection.ck.endpoint')

  return {
    enabled,
    endpoint: endpoint?.trim() || '',
  }
}

async function fetchApiQuotes(endpoint: string, cards: OwnedCard[]): Promise<CkQuote[]> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: cards.map((card) => ({
        scryfallId: card.scryfallId,
        name: card.name,
        quantity: card.quantity + card.foilQuantity,
      })),
    }),
  })

  if (!response.ok) {
    throw new Error(`CK proxy request failed (${response.status}).`)
  }

  const payload = (await response.json()) as {
    quotes?: Array<{
      scryfallId: string
      name: string
      cashPrice: number
      creditPrice: number
      qtyCap: number
      sourceUrl?: string
    }>
  }

  return (payload.quotes ?? []).map((quote) => ({
    scryfallId: quote.scryfallId,
    name: quote.name,
    quantity: cards.find((card) => card.scryfallId === quote.scryfallId)?.quantity ?? 0,
    cashPrice: asUsd(quote.cashPrice),
    creditPrice: asUsd(quote.creditPrice),
    qtyCap: Math.max(0, Math.floor(quote.qtyCap || 0)),
    sourceUrl: quote.sourceUrl || 'https://www.cardkingdom.com/',
  }))
}

function buildMockQuotes(cards: OwnedCard[]): CkQuote[] {
  return cards
    .map((card) => {
      const quantity = card.quantity + card.foilQuantity
      const market = card.currentPrice ?? 0
      if (quantity <= 0 || market <= 0) {
        return null
      }
      const foilWeight = card.foilQuantity > 0 ? 1.08 : 1
      const cash = asUsd(market * 0.56 * foilWeight)
      const credit = asUsd(cash * 1.3)
      return {
        scryfallId: card.scryfallId,
        name: card.name,
        quantity,
        cashPrice: cash,
        creditPrice: credit,
        qtyCap: Math.max(4, Math.min(50, quantity + 6)),
        sourceUrl: `https://www.cardkingdom.com/catalog/search?search=header&filter[name]=${encodeURIComponent(card.name)}`,
      } as CkQuote
    })
    .filter((quote): quote is CkQuote => quote !== null)
}

export async function loadCkBuylistQuotes(cards: OwnedCard[]): Promise<CkQuoteResult> {
  const config = resolveConfig()
  if (!config.enabled) {
    return {
      enabled: false,
      provider: 'disabled',
      quotes: [],
      warning: 'CK integration disabled. Set VITE_ENABLE_CK=1 or localStorage flag to enable.',
    }
  }

  if (!cards.length) {
    return {
      enabled: true,
      provider: config.endpoint ? 'api' : 'mock',
      quotes: [],
    }
  }

  if (!config.endpoint) {
    return {
      enabled: true,
      provider: 'mock',
      quotes: buildMockQuotes(cards),
      warning: 'Using mock CK pricing model. Configure VITE_CK_PROXY_URL for live API-backed quotes.',
    }
  }

  return {
    enabled: true,
    provider: 'api',
    quotes: await fetchApiQuotes(config.endpoint, cards),
  }
}

export function buildCkSellIntentUrl(quotes: CkQuote[]): string {
  const items = quotes
    .filter((quote) => quote.quantity > 0)
    .slice(0, 100)
    .map((quote) => `${encodeURIComponent(quote.scryfallId)}:${quote.quantity}`)
    .join(',')

  return `https://www.cardkingdom.com/?utm_source=magiccollection&sell_intent=${items}`
}
