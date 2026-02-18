import type { CollectionImportRow } from '../../types'

export type DelimiterMode = 'auto' | 'comma' | 'tab' | 'semicolon' | 'pipe' | 'custom'

export type ImportFieldKey =
  | 'quantity'
  | 'name'
  | 'setCode'
  | 'scryfallId'
  | 'collectorNumber'
  | 'foil'
  | 'tags'
  | 'location'
  | 'condition'
  | 'language'
  | 'purchasePrice'
  | 'dateAdded'
  | 'typeLine'
  | 'manaValue'
  | 'colorIdentity'
  | 'rarity'
  | 'notes'
  | 'imageUrl'

export interface ImportFieldDefinition {
  key: ImportFieldKey
  label: string
  required?: boolean
}

export const IMPORT_FIELD_DEFINITIONS: ImportFieldDefinition[] = [
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'name', label: 'Card Name', required: true },
  { key: 'setCode', label: 'Set Code', required: true },
  { key: 'scryfallId', label: 'Scryfall ID', required: true },
  { key: 'collectorNumber', label: 'Collector Number', required: true },
  { key: 'foil', label: 'Foil/Finish' },
  { key: 'tags', label: 'Tags' },
  { key: 'location', label: 'Location' },
  { key: 'condition', label: 'Condition' },
  { key: 'language', label: 'Language' },
  { key: 'purchasePrice', label: 'Purchase Price' },
  { key: 'dateAdded', label: 'Date Added' },
  { key: 'typeLine', label: 'Card Types / Type Line' },
  { key: 'manaValue', label: 'Mana Value' },
  { key: 'colorIdentity', label: 'Color Identity / Colors' },
  { key: 'rarity', label: 'Rarity' },
  { key: 'notes', label: 'Notes' },
  { key: 'imageUrl', label: 'Image URL' },
]

export interface DelimitedImportMapping {
  quantity: number | null
  name: number | null
  setCode: number | null
  scryfallId: number | null
  collectorNumber: number | null
  foil: number | null
  tags: number | null
  location: number | null
  condition: number | null
  language: number | null
  purchasePrice: number | null
  dateAdded: number | null
  typeLine: number | null
  manaValue: number | null
  colorIdentity: number | null
  rarity: number | null
  notes: number | null
  imageUrl: number | null
}

export interface DelimitedImportOptions {
  tagDelimiter: string
  useTagAsLocationWhenLocationMissing: boolean
}

export interface DelimitedImportParseResult {
  headers: string[]
  rows: string[][]
}

export interface DelimitedTransformResult {
  rows: CollectionImportRow[]
  rowsImported: number
  copiesImported: number
  rowsSkipped: number
  skippedDetails: Array<{
    rowNumber: number
    reason: string
    preview: string
  }>
  sourceRowNumbersByKey: Record<string, number[]>
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase()
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
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

export function resolveDelimiter(mode: DelimiterMode, customDelimiter: string): string {
  if (mode === 'comma') return ','
  if (mode === 'tab') return '\t'
  if (mode === 'semicolon') return ';'
  if (mode === 'pipe') return '|'
  if (mode === 'custom') return customDelimiter || ','
  return ','
}

export function detectDelimiter(text: string): Exclude<DelimiterMode, 'auto' | 'custom'> {
  const sample = text
    .split(/\r?\n/)
    .slice(0, 6)
    .join('\n')
  const candidates: Array<{ mode: Exclude<DelimiterMode, 'auto' | 'custom'>; delimiter: string }> = [
    { mode: 'comma', delimiter: ',' },
    { mode: 'tab', delimiter: '\t' },
    { mode: 'semicolon', delimiter: ';' },
    { mode: 'pipe', delimiter: '|' },
  ]

  let best: Exclude<DelimiterMode, 'auto' | 'custom'> = 'comma'
  let bestScore = -1
  for (const candidate of candidates) {
    const score = sample.split(candidate.delimiter).length - 1
    if (score > bestScore) {
      best = candidate.mode
      bestScore = score
    }
  }
  return best
}

export function parseDelimitedContent(
  text: string,
  mode: DelimiterMode,
  customDelimiter: string,
): DelimitedImportParseResult {
  const normalized = text.replace(/^\uFEFF/, '')
  const activeMode = mode === 'auto' ? detectDelimiter(normalized) : mode
  const delimiter = resolveDelimiter(activeMode, customDelimiter)
  const allRows = parseDelimitedRows(normalized, delimiter)
  if (allRows.length === 0) {
    return { headers: [], rows: [] }
  }
  const headers = allRows[0].map((value) => value.trim())
  const rows = allRows.slice(1).filter((row) => row.some((cell) => cell.trim().length > 0))
  return { headers, rows }
}

export function buildDefaultMapping(headers: string[]): DelimitedImportMapping {
  const byHeader = new Map<string, number>()
  headers.forEach((header, index) => {
    byHeader.set(normalizeHeader(header), index)
  })

  function first(...names: string[]): number | null {
    for (const name of names) {
      const match = byHeader.get(name)
      if (match !== undefined) {
        return match
      }
    }
    return null
  }

  return {
    quantity: first('quantity', 'qty', 'count'),
    name: first('name', 'card name'),
    setCode: first('edition code', 'set code', 'set', 'edition'),
    scryfallId: first('scryfall id', 'scryfallid'),
    collectorNumber: first('collector number', 'collector_number', 'number'),
    foil: first('foil', 'finish', 'treatment'),
    tags: first('tags', 'tag', 'labels'),
    location: first('location', 'binder', 'source'),
    condition: first('condition'),
    language: first('language', 'lang'),
    purchasePrice: first('purchase price', 'purchase_price', 'cost basis', 'cost'),
    dateAdded: first('date added', 'date_added', 'acquired', 'acquired at'),
    typeLine: first('card types', 'type line', 'type'),
    manaValue: first('mana value', 'cmc'),
    colorIdentity: first('color identities', 'color identity', 'colors'),
    rarity: first('rarity'),
    notes: first('notes', 'comment', 'comments'),
    imageUrl: first('image url', 'image', 'image_uri'),
  }
}

function parseQuantity(raw: string): number {
  const numeric = Number(raw.trim())
  if (!Number.isFinite(numeric)) {
    return 0
  }
  return Math.max(0, Math.floor(numeric))
}

function parseFoil(raw: string): boolean {
  const normalized = raw.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return (
    normalized === 'foil' ||
    normalized === 'etched' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === '1' ||
    normalized.includes('foil')
  )
}

function parseTags(raw: string, tagDelimiter: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) {
    return []
  }
  const delimiter = tagDelimiter.trim() || ';'
  const parts = trimmed
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
  return [...new Set(parts)]
}

function parseColorIdentity(raw: string): string[] {
  const normalized = raw.toUpperCase()
  const symbols = ['W', 'U', 'B', 'R', 'G']
  return symbols.filter(
    (symbol) => normalized.includes(symbol) || normalized.includes(`{${symbol}}`),
  )
}

function parseNumberOrNull(raw: string): number | null {
  const text = raw.trim()
  if (!text) {
    return null
  }
  const numeric = Number(text)
  if (!Number.isFinite(numeric)) {
    return null
  }
  return numeric
}

function pick(row: string[], index: number | null): string {
  if (index === null || index < 0 || index >= row.length) {
    return ''
  }
  return row[index] ?? ''
}

function looksLikeScryfallId(value: string): boolean {
  return UUID_PATTERN.test(value.trim())
}

export function transformDelimitedRowsToImport(
  parseResult: DelimitedImportParseResult,
  mapping: DelimitedImportMapping,
  options: DelimitedImportOptions,
): DelimitedTransformResult {
  const aggregate = new Map<string, CollectionImportRow>()
  const sourceRowNumbersByKey = new Map<string, number[]>()
  let rowsImported = 0
  let copiesImported = 0
  let rowsSkipped = 0
  const skippedDetails: Array<{ rowNumber: number; reason: string; preview: string }> = []

  for (let index = 0; index < parseResult.rows.length; index += 1) {
    const row = parseResult.rows[index]
    const rowNumber = index + 2
    const quantity = parseQuantity(pick(row, mapping.quantity))
    const name = pick(row, mapping.name).trim()
    const rawSetCode = pick(row, mapping.setCode).trim().toLowerCase()
    const rawScryfallId = pick(row, mapping.scryfallId).trim().toLowerCase()
    const rawCollectorNumber = pick(row, mapping.collectorNumber).trim()
    const hasValidScryfallId = looksLikeScryfallId(rawScryfallId)
    const hasSetCollector = !!rawSetCode && !!rawCollectorNumber
    const setCode = rawSetCode || 'unk'
    const collectorNumber = rawCollectorNumber || '0'
    const scryfallId = hasValidScryfallId ? rawScryfallId : ''
    const foil = parseFoil(pick(row, mapping.foil))
    const tags = parseTags(pick(row, mapping.tags), options.tagDelimiter)
    const explicitLocation = pick(row, mapping.location).trim()
    const fallbackLocation =
      options.useTagAsLocationWhenLocationMissing && !explicitLocation && tags.length > 0
        ? tags[0]
        : ''
    const locationName = explicitLocation || fallbackLocation
    const conditionCode = pick(row, mapping.condition).trim().toUpperCase()
    const language = pick(row, mapping.language).trim().toLowerCase()
    const purchasePrice = parseNumberOrNull(pick(row, mapping.purchasePrice))
    const dateAdded = pick(row, mapping.dateAdded).trim()
    const typeLine = pick(row, mapping.typeLine).trim()
    const manaValue = parseNumberOrNull(pick(row, mapping.manaValue))
    const colorIdentity = parseColorIdentity(pick(row, mapping.colorIdentity))
    const rarity = pick(row, mapping.rarity).trim().toLowerCase()
    const notes = pick(row, mapping.notes).trim()
    const imageUrl = pick(row, mapping.imageUrl).trim()

    if (!quantity || !name || (!hasValidScryfallId && !hasSetCollector)) {
      rowsSkipped += 1
      skippedDetails.push({
        rowNumber,
        reason:
          !quantity
            ? 'Quantity missing or invalid'
            : !name
              ? 'Card Name missing'
              : 'Missing identity (need Scryfall ID or Set Code + Collector Number)',
        preview: row.slice(0, 6).join(' | ').slice(0, 220),
      })
      continue
    }

    const aggregateKey = hasValidScryfallId
      ? scryfallId
      : `${setCode}|${collectorNumber}|${name.toLowerCase()}`
    if (!sourceRowNumbersByKey.has(aggregateKey)) {
      sourceRowNumbersByKey.set(aggregateKey, [])
    }
    sourceRowNumbersByKey.get(aggregateKey)?.push(rowNumber)
    const existing = aggregate.get(aggregateKey)
    if (!existing) {
      aggregate.set(aggregateKey, {
        scryfallId,
        name,
        setCode,
        collectorNumber,
        imageUrl: imageUrl || null,
        typeLine: typeLine || null,
        colorIdentity: colorIdentity.length ? colorIdentity : [],
        manaValue: manaValue ?? null,
        rarity: rarity || null,
        quantity: foil ? 0 : quantity,
        foilQuantity: foil ? quantity : 0,
        tags,
        locationName: locationName || null,
        conditionCode: conditionCode || 'NM',
        language: language || 'en',
        notes: notes || null,
        purchasePrice,
        dateAdded: dateAdded || null,
      })
    } else {
      existing.quantity += foil ? 0 : quantity
      existing.foilQuantity += foil ? quantity : 0
      existing.tags = [...new Set([...(existing.tags ?? []), ...tags])]
      if (!existing.locationName && locationName) {
        existing.locationName = locationName
      }
      if ((!existing.typeLine || !existing.typeLine.trim()) && typeLine) {
        existing.typeLine = typeLine
      }
      if ((!existing.colorIdentity || existing.colorIdentity.length === 0) && colorIdentity.length) {
        existing.colorIdentity = colorIdentity
      }
      if ((existing.manaValue ?? null) === null && manaValue !== null) {
        existing.manaValue = manaValue
      }
      if (!existing.rarity && rarity) {
        existing.rarity = rarity
      }
      if ((existing.purchasePrice ?? null) === null && purchasePrice !== null) {
        existing.purchasePrice = purchasePrice
      }
      if (!existing.dateAdded && dateAdded) {
        existing.dateAdded = dateAdded
      }
      if (!existing.notes && notes) {
        existing.notes = notes
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
    skippedDetails,
    sourceRowNumbersByKey: Object.fromEntries(sourceRowNumbersByKey.entries()),
  }
}
