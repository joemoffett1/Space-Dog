import type { CollectionImportResult, CollectionImportRow } from '../../types'

export interface ParseArchidektCsvResult extends CollectionImportResult {
  rows: CollectionImportRow[]
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase()
}

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i]
    const next = csvText[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === ',') {
      row.push(cell)
      cell = ''
      continue
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        i += 1
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function parseTags(raw: string): string[] {
  if (!raw.trim()) {
    return []
  }
  const parts = raw
    .split(/[;|]/g)
    .map((part) => part.trim())
    .filter(Boolean)
  return [...new Set(parts)]
}

function looksLikeScryfallId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  )
}

function parseQuantity(raw: string): number {
  const numeric = Number(raw.trim())
  if (!Number.isFinite(numeric)) {
    return 0
  }
  return Math.max(0, Math.floor(numeric))
}

function parseManaValue(raw: string): number | null {
  const text = raw.trim()
  if (!text) {
    return null
  }
  const numeric = Number(text)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null
  }
  return numeric
}

function parseColorIdentity(raw: string): string[] {
  const normalized = raw.toUpperCase()
  const symbols = ['W', 'U', 'B', 'R', 'G']
  return symbols.filter((symbol) =>
    normalized.includes(symbol) || normalized.includes(`{${symbol}}`),
  )
}

function isFoilFinish(raw: string): boolean {
  const normalized = raw.trim().toLowerCase()
  return normalized.includes('foil') || normalized.includes('etched')
}

export function parseArchidektCsv(csvText: string): ParseArchidektCsvResult {
  const rows = parseCsvRows(csvText)
  if (rows.length < 2) {
    return { rows: [], rowsImported: 0, copiesImported: 0, rowsSkipped: 0 }
  }

  const header = rows[0]
  const headerMap = new Map<string, number>()
  header.forEach((col, index) => headerMap.set(normalizeHeader(col), index))

  const idxQuantity = headerMap.get('quantity')
  const idxName = headerMap.get('name')
  const idxFinish = headerMap.get('finish')
  const idxEditionCode = headerMap.get('edition code')
  const idxScryfallId = headerMap.get('scryfall id')
  const idxCollectorNumber = headerMap.get('collector number')
  const idxTags = headerMap.get('tags')
  const idxCardTypes = headerMap.get('card types')
  const idxManaValue = headerMap.get('mana value')
  const idxColors = headerMap.get('colors')
  const idxColorIdentities = headerMap.get('color identities')
  const idxRarity = headerMap.get('rarity')

  if (
    idxQuantity === undefined ||
    idxName === undefined ||
    idxEditionCode === undefined ||
    idxScryfallId === undefined ||
    idxCollectorNumber === undefined
  ) {
    throw new Error(
      'CSV format not recognized. Expected Archidekt export with Quantity, Name, Edition Code, Scryfall ID, and Collector Number.',
    )
  }

  const aggregate = new Map<string, CollectionImportRow>()
  let rowsImported = 0
  let copiesImported = 0
  let rowsSkipped = 0

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (!row || row.every((cell) => !cell.trim())) {
      continue
    }

    const quantity = parseQuantity(row[idxQuantity] ?? '')
    const name = (row[idxName] ?? '').trim()
    const setCode = (row[idxEditionCode] ?? '').trim().toLowerCase()
    const scryfallId = (row[idxScryfallId] ?? '').trim()
    const collectorNumber = (row[idxCollectorNumber] ?? '').trim()
    const finish = idxFinish !== undefined ? row[idxFinish] ?? '' : ''
    const tags = idxTags !== undefined ? parseTags(row[idxTags] ?? '') : []
    const typeLine = idxCardTypes !== undefined ? (row[idxCardTypes] ?? '').trim() : ''
    const manaValue = idxManaValue !== undefined ? parseManaValue(row[idxManaValue] ?? '') : null
    const colorIdentity = parseColorIdentity(
      idxColorIdentities !== undefined
        ? row[idxColorIdentities] ?? ''
        : idxColors !== undefined
          ? row[idxColors] ?? ''
          : '',
    )
    const rarity = idxRarity !== undefined ? (row[idxRarity] ?? '').trim().toLowerCase() : ''

    if (!quantity || !name || !setCode || !collectorNumber || !looksLikeScryfallId(scryfallId)) {
      rowsSkipped += 1
      continue
    }

    const foil = isFoilFinish(finish)
    const key = scryfallId
    const existing = aggregate.get(key)

    if (!existing) {
      aggregate.set(key, {
        scryfallId,
        name,
        setCode,
        collectorNumber,
        typeLine: typeLine || null,
        colorIdentity: colorIdentity.length ? colorIdentity : undefined,
        manaValue,
        rarity: rarity || null,
        quantity: foil ? 0 : quantity,
        foilQuantity: foil ? quantity : 0,
        tags,
      })
    } else {
      existing.quantity += foil ? 0 : quantity
      existing.foilQuantity += foil ? quantity : 0
      existing.tags = [...new Set([...(existing.tags ?? []), ...tags])]
      if (!existing.typeLine && typeLine) {
        existing.typeLine = typeLine
      }
      if ((!existing.colorIdentity || !existing.colorIdentity.length) && colorIdentity.length) {
        existing.colorIdentity = colorIdentity
      }
      if ((existing.manaValue ?? null) === null && manaValue !== null) {
        existing.manaValue = manaValue
      }
      if (!existing.rarity && rarity) {
        existing.rarity = rarity
      }
    }

    rowsImported += 1
    copiesImported += quantity
  }

  return {
    rows: [...aggregate.values()],
    rowsImported,
    copiesImported,
    rowsSkipped,
  }
}
