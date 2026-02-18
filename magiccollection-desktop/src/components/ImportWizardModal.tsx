import { useMemo, useState } from 'react'
import type { CollectionImportRow } from '../types'
import {
  IMPORT_FIELD_DEFINITIONS,
  type DelimitedImportMapping,
  type DelimiterMode,
  type ImportFieldKey,
  buildDefaultMapping,
  parseDelimitedContent,
  transformDelimitedRowsToImport,
} from '../lib/importers/delimited'

interface ImportWizardModalProps {
  isOpen: boolean
  isBusy?: boolean
  onClose: () => void
  onImport: (payload: {
    rows: CollectionImportRow[]
    rowsImported: number
    copiesImported: number
    rowsSkipped: number
  }) => Promise<void>
}

const DELIMITER_OPTIONS: Array<{ value: DelimiterMode; label: string }> = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'comma', label: 'Comma (,)' },
  { value: 'tab', label: 'Tab' },
  { value: 'semicolon', label: 'Semicolon (;)' },
  { value: 'pipe', label: 'Pipe (|)' },
  { value: 'custom', label: 'Custom' },
]

const SCRYFALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function emptyMapping(): DelimitedImportMapping {
  return {
    quantity: null,
    name: null,
    setCode: null,
    scryfallId: null,
    collectorNumber: null,
    foil: null,
    tags: null,
    location: null,
    condition: null,
    language: null,
    purchasePrice: null,
    dateAdded: null,
    typeLine: null,
    manaValue: null,
    colorIdentity: null,
    rarity: null,
    notes: null,
    imageUrl: null,
  }
}

export function ImportWizardModal({
  isOpen,
  isBusy = false,
  onClose,
  onImport,
}: ImportWizardModalProps) {
  const [rawText, setRawText] = useState('')
  const [fileName, setFileName] = useState('')
  const [delimiterMode, setDelimiterMode] = useState<DelimiterMode>('auto')
  const [customDelimiter, setCustomDelimiter] = useState(',')
  const [tagDelimiter, setTagDelimiter] = useState(';')
  const [useTagAsLocation, setUseTagAsLocation] = useState(true)
  const [mapping, setMapping] = useState<DelimitedImportMapping>(emptyMapping)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [progressMessage, setProgressMessage] = useState('')
  const [isPreparingImport, setIsPreparingImport] = useState(false)
  const [lastImportReport, setLastImportReport] = useState<{
    rowsImported: number
    copiesImported: number
    rowsSkipped: number
    skippedDetails: Array<{ rowNumber: number; reason: string; preview: string }>
  } | null>(null)
  const [showReport, setShowReport] = useState(false)

  const parsed = useMemo(
    () => parseDelimitedContent(rawText, delimiterMode, customDelimiter),
    [rawText, delimiterMode, customDelimiter],
  )
  const selectableFields = useMemo(
    () => IMPORT_FIELD_DEFINITIONS.filter((field) => field.key !== 'imageUrl'),
    [],
  )
  const fieldLabelsByKey = useMemo(
    () =>
      new Map(
        IMPORT_FIELD_DEFINITIONS.map((field) => [field.key, field.label] as const),
      ),
    [],
  )
  const selectedFieldByHeaderIndex = useMemo(() => {
    const map = new Map<number, ImportFieldKey>()
    for (const [key, index] of Object.entries(mapping)) {
      if (index !== null) {
        map.set(index, key as ImportFieldKey)
      }
    }
    return map
  }, [mapping])

  function resetMappingFromText(
    text: string,
    mode: DelimiterMode,
    custom: string,
  ) {
    const parsedPreview = parseDelimitedContent(text, mode, custom)
    if (!parsedPreview.headers.length) {
      setMapping(emptyMapping())
      return
    }
    setMapping(buildDefaultMapping(parsedPreview.headers))
  }

  function resetState() {
    setRawText('')
    setFileName('')
    setDelimiterMode('auto')
    setCustomDelimiter(',')
    setTagDelimiter(';')
    setUseTagAsLocation(true)
    setMapping(emptyMapping())
    setError('')
    setSuccessMessage('')
    setLastImportReport(null)
    setShowReport(false)
    setProgressMessage('')
    setIsPreparingImport(false)
  }

  function clearLoadedFile() {
    setRawText('')
    setFileName('')
    setMapping(emptyMapping())
    setError('')
    setSuccessMessage('')
    setLastImportReport(null)
    setShowReport(false)
    setProgressMessage('')
  }

  function handleClose() {
    if (isBusy || isPreparingImport) {
      return
    }
    resetState()
    onClose()
  }

  async function handleFileSelected(file: File) {
    const text = await file.text()
    setRawText(text)
    setFileName(file.name)
    resetMappingFromText(text, delimiterMode, customDelimiter)
    setError('')
  }

  function updateMappingByHeaderIndex(headerIndex: number, value: string) {
    setMapping((previous) => {
      const next = { ...previous }
      for (const key of Object.keys(next) as Array<keyof DelimitedImportMapping>) {
        if (next[key] === headerIndex) {
          next[key] = null
        }
      }
      if (!value) {
        return next
      }
      const fieldKey = value as keyof DelimitedImportMapping
      next[fieldKey] = headerIndex
      return next
    })
  }

  async function handleImport() {
    setIsPreparingImport(true)
    setProgressMessage('Validating mapping')
    if (!rawText) {
      setError('Choose a file before importing.')
      setIsPreparingImport(false)
      return
    }

    if (mapping.quantity === null || mapping.name === null) {
      setError('Map required fields: Quantity and Card Name.')
      setIsPreparingImport(false)
      return
    }
    const hasScryfallPath = mapping.scryfallId !== null
    const hasSetCollectorPath = mapping.setCode !== null && mapping.collectorNumber !== null
    if (!hasScryfallPath && !hasSetCollectorPath) {
      setError('Map either Scryfall ID, or both Set Code and Collector Number.')
      setIsPreparingImport(false)
      return
    }

    try {
      let transformed = transformDelimitedRowsToImport(parsed, mapping, {
        tagDelimiter,
        useTagAsLocationWhenLocationMissing: useTagAsLocation,
      })

      // Enrich import identity both directions:
      // 1) set+collector -> scryfall id
      // 2) scryfall id -> set+collector
      type ScryfallCard = {
        id: string
        name?: string
        set?: string
        collector_number?: string
        image_uris?: { normal?: string }
        type_line?: string
        color_identity?: string[]
        cmc?: number
        rarity?: string
      }

      const byId = new Map<string, ScryfallCard>()
      const bySetCollector = new Map<string, ScryfallCard>()
      const identifiers: Array<{ id?: string; set?: string; collector_number?: string }> = []
      const identifierSeen = new Set<string>()
      let additionalSkipped = 0
      const additionalSkippedDetails: Array<{ rowNumber: number; reason: string; preview: string }> = []

      for (const row of transformed.rows) {
        const id = (row.scryfallId ?? '').trim().toLowerCase()
        const set = (row.setCode ?? '').trim().toLowerCase()
        const collector = (row.collectorNumber ?? '').trim()
        const missingId = !SCRYFALL_ID_PATTERN.test(id)
        const missingSetCollector = !set || set === 'unk' || !collector || collector === '0'

        if (missingId && !missingSetCollector) {
          const key = `sc:${set}|${collector}`
          if (!identifierSeen.has(key)) {
            identifierSeen.add(key)
            identifiers.push({ set, collector_number: collector })
          }
        } else if (!missingId && missingSetCollector) {
          const key = `id:${id}`
          if (!identifierSeen.has(key)) {
            identifierSeen.add(key)
            identifiers.push({ id })
          }
        }
      }

      const totalBatches = Math.max(1, Math.ceil(identifiers.length / 75))
      for (let i = 0; i < identifiers.length; i += 75) {
        const batchNumber = Math.floor(i / 75) + 1
        setProgressMessage(`Resolving card metadata ${batchNumber}/${totalBatches}`)
        const slice = identifiers.slice(i, i + 75)
        const response = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: slice }),
        })
        if (!response.ok) {
          throw new Error(`Unable to enrich import rows from Scryfall (${response.status}).`)
        }
        const payload = (await response.json()) as { data?: ScryfallCard[] }
        for (const item of payload.data ?? []) {
          const id = (item.id ?? '').toLowerCase()
          const setCollector = `${(item.set ?? '').toLowerCase()}|${item.collector_number ?? ''}`
          if (id) {
            byId.set(id, item)
          }
          if (setCollector.includes('|')) {
            bySetCollector.set(setCollector, item)
          }
        }
      }

      const enrichedRows: CollectionImportRow[] = []
      for (const row of transformed.rows) {
        const id = (row.scryfallId ?? '').trim().toLowerCase()
        const set = (row.setCode ?? '').trim().toLowerCase()
        const collector = (row.collectorNumber ?? '').trim()
        const missingId = !SCRYFALL_ID_PATTERN.test(id)
        const missingSetCollector = !set || set === 'unk' || !collector || collector === '0'

        let resolved: ScryfallCard | undefined
        if (missingId && !missingSetCollector) {
          resolved = bySetCollector.get(`${set}|${collector}`)
        } else if (!missingId && missingSetCollector) {
          resolved = byId.get(id)
        }

        if (missingId && !missingSetCollector && !resolved?.id) {
          additionalSkipped += 1
          const fallbackKey = `${row.setCode.toLowerCase()}|${row.collectorNumber}|${row.name.toLowerCase()}`
          const rowNumbers = transformed.sourceRowNumbersByKey[fallbackKey] ?? []
          if (rowNumbers.length) {
            for (const rowNumber of rowNumbers) {
              additionalSkippedDetails.push({
                rowNumber,
                reason: 'Unable to resolve Scryfall ID from set+collector',
                preview: `${row.name} | ${row.setCode} | ${row.collectorNumber}`,
              })
            }
          } else {
            additionalSkippedDetails.push({
              rowNumber: -1,
              reason: 'Unable to resolve Scryfall ID from set+collector',
              preview: `${row.name} | ${row.setCode} | ${row.collectorNumber}`,
            })
          }
          continue
        }

        if (missingId && !missingSetCollector && !resolved?.id) {
          additionalSkipped += 1
          const fallbackKey = `${row.setCode.toLowerCase()}|${row.collectorNumber}|${row.name.toLowerCase()}`
          const rowNumbers = transformed.sourceRowNumbersByKey[fallbackKey] ?? []
          if (rowNumbers.length) {
            for (const rowNumber of rowNumbers) {
              additionalSkippedDetails.push({
                rowNumber,
                reason: 'Unable to resolve Scryfall ID from set+collector',
                preview: `${row.name} | ${row.setCode} | ${row.collectorNumber}`,
              })
            }
          } else {
            additionalSkippedDetails.push({
              rowNumber: -1,
              reason: 'Unable to resolve Scryfall ID from set+collector',
              preview: `${row.name} | ${row.setCode} | ${row.collectorNumber}`,
            })
          }
          continue
        }

        enrichedRows.push({
          ...row,
          scryfallId: !missingId ? id : (resolved?.id ?? row.scryfallId).toLowerCase(),
          name: row.name || resolved?.name || row.name,
          setCode: missingSetCollector ? (resolved?.set ?? row.setCode) : row.setCode,
          collectorNumber:
            missingSetCollector ? (resolved?.collector_number ?? row.collectorNumber) : row.collectorNumber,
          imageUrl: row.imageUrl || resolved?.image_uris?.normal || null,
          typeLine: row.typeLine || resolved?.type_line || null,
          colorIdentity:
            row.colorIdentity && row.colorIdentity.length ? row.colorIdentity : resolved?.color_identity ?? [],
          manaValue: row.manaValue ?? (typeof resolved?.cmc === 'number' ? resolved.cmc : null),
          rarity: row.rarity ?? resolved?.rarity ?? null,
        })
      }

      transformed = {
        ...transformed,
        rows: enrichedRows,
        rowsSkipped: transformed.rowsSkipped + additionalSkipped,
        skippedDetails: [...transformed.skippedDetails, ...additionalSkippedDetails],
      }

      if (!transformed.rows.length) {
        setError('No importable rows found after mapping. Adjust columns/delimiter and try again.')
        return
      }

      setError('')
      setProgressMessage(`Importing ${transformed.rows.length} mapped rows`)
      await onImport({
        rows: transformed.rows,
        rowsImported: transformed.rowsImported,
        copiesImported: transformed.copiesImported,
        rowsSkipped: transformed.rowsSkipped,
      })
      setSuccessMessage(
        `Imported ${transformed.rowsImported} rows (${transformed.copiesImported} copies). Skipped ${transformed.rowsSkipped}.`,
      )
      setLastImportReport({
        rowsImported: transformed.rowsImported,
        copiesImported: transformed.copiesImported,
        rowsSkipped: transformed.rowsSkipped,
        skippedDetails: transformed.skippedDetails,
      })
      setShowReport(false)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import failed unexpectedly.')
    } finally {
      setProgressMessage('')
      setIsPreparingImport(false)
    }
  }

  if (!isOpen) {
    return null
  }

  const previewRows = parsed.rows.slice(0, 5)

  return (
    <div className="submenu-overlay" onClick={handleClose}>
      <section className="submenu-modal import-wizard-modal" onClick={(event) => event.stopPropagation()}>
        <div className="submenu-head">
          <div>
            <h3>Import Collection File</h3>
            <p className="muted small">Choose delimiter, map columns, preview rows, and import supported data.</p>
            {progressMessage ? (
              <div className="import-progress-pill" role="status" aria-live="polite">
                <span className="import-spinner" aria-hidden="true" />
                <img src="/ui-icons/paw.svg" className="ui-icon import-progress-icon" alt="" aria-hidden="true" />
                <span>{progressMessage}</span>
              </div>
            ) : null}
          </div>
          <button className="icon-ghost-button" type="button" onClick={handleClose} aria-label="Close import wizard">
            <img src="/ui-icons/x.svg" className="ui-icon" alt="" aria-hidden="true" />
          </button>
        </div>

        <div className="import-wizard-content">
        <div className="import-wizard-grid">
          <div className="import-wizard-card">
            <label className="muted small">File</label>
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                void handleFileSelected(file)
                event.target.value = ''
              }}
              disabled={isBusy || isPreparingImport}
            />
            <div className="row-actions">
              <p className="muted small">{fileName ? `Loaded: ${fileName}` : 'No file selected yet.'}</p>
              {fileName ? (
                <button
                  className="button subtle tiny"
                  type="button"
                  onClick={clearLoadedFile}
                  disabled={isBusy || isPreparingImport}
                >
                  Remove File
                </button>
              ) : null}
            </div>
          </div>

          <div className="import-wizard-card">
            <label className="muted small">Delimiter</label>
            <select
              className="tag-select"
              value={delimiterMode}
              onChange={(event) => {
                const nextMode = event.target.value as DelimiterMode
                setDelimiterMode(nextMode)
                resetMappingFromText(rawText, nextMode, customDelimiter)
              }}
              disabled={isBusy || isPreparingImport}
            >
              {DELIMITER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {delimiterMode === 'custom' ? (
              <input
                className="tag-input"
                value={customDelimiter}
                onChange={(event) => {
                  const next = event.target.value.slice(0, 1)
                  setCustomDelimiter(next)
                  resetMappingFromText(rawText, delimiterMode, next)
                }}
                placeholder="Custom delimiter"
                disabled={isBusy || isPreparingImport}
              />
            ) : null}
            <label className="muted small">Tag split delimiter</label>
            <input
              className="tag-input"
              value={tagDelimiter}
              onChange={(event) => setTagDelimiter(event.target.value.slice(0, 1))}
              placeholder=";"
              disabled={isBusy || isPreparingImport}
            />
            <label className="compact-toggle import-toggle">
              <input
                type="checkbox"
                checked={useTagAsLocation}
                onChange={(event) => setUseTagAsLocation(event.target.checked)}
                disabled={isBusy || isPreparingImport}
              />
              Use first tag as location when location column is empty
            </label>
          </div>
        </div>

        <div className="import-wizard-card">
          <h4>Column Mapping</h4>
          {parsed.headers.length === 0 ? (
            <p className="muted small">Select a file to load headers.</p>
          ) : (
            <div className="import-mapping-grid">
              {parsed.headers.map((header, index) => (
                <label key={`${header}-${index}`} className="import-mapping-item">
                  <span className="muted small">{header || `(column ${index + 1})`}</span>
                  <select
                    className="tag-select"
                    value={selectedFieldByHeaderIndex.get(index) ?? ''}
                    onChange={(event) => updateMappingByHeaderIndex(index, event.target.value)}
                    disabled={isBusy || isPreparingImport}
                  >
                    <option value="">Ignore</option>
                    {selectableFields.map((field) => (
                      <option key={`${field.key}-${index}`} value={field.key}>
                        {field.label}
                        {field.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          {parsed.headers.length > 0 ? (
            <p className="muted small">
              Required mapped:
              {' '}
              {(['quantity', 'name'] as ImportFieldKey[])
                .map((key) => `${fieldLabelsByKey.get(key) ?? key}: ${mapping[key] === null ? 'no' : 'yes'}`)
                .join(' · ')}
              {' · Identity path: '}
              {mapping.scryfallId !== null
                ? 'Scryfall ID'
                : mapping.setCode !== null && mapping.collectorNumber !== null
                  ? 'Set Code + Collector Number'
                  : 'missing'}
            </p>
          ) : null}
        </div>

        <div className="import-wizard-card">
          <h4>Preview</h4>
          <p className="muted small">
            Rows detected: {parsed.rows.length}. Showing up to first {previewRows.length}.
          </p>
          {previewRows.length ? (
            <div className="import-preview-table-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    {parsed.headers.map((header, index) => (
                      <th key={`preview-head-${index}`}>{header || `Column ${index + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, rowIndex) => (
                    <tr key={`preview-row-${rowIndex}`}>
                      {parsed.headers.map((_, cellIndex) => (
                        <td key={`preview-cell-${rowIndex}-${cellIndex}`}>{row[cellIndex] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">No preview rows available.</p>
          )}
        </div>

        {error ? <p className="error-line">{error}</p> : null}
        {successMessage ? <p className="muted">{successMessage}</p> : null}
        {showReport && lastImportReport ? (
          <div className="import-wizard-card">
            <h4>Skipped Row Report</h4>
            {lastImportReport.skippedDetails.length === 0 ? (
              <p className="muted small">No skipped rows.</p>
            ) : (
              <div className="import-preview-table-wrap">
                <table className="import-preview-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Reason</th>
                      <th>Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastImportReport.skippedDetails.slice(0, 500).map((item, index) => (
                      <tr key={`skip-${index}`}>
                        <td>{item.rowNumber > 0 ? item.rowNumber : 'N/A'}</td>
                        <td>{item.reason}</td>
                        <td>{item.preview}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
        </div>

        <div className="row-actions import-wizard-actions">
          {lastImportReport ? (
            <div className="row-actions import-report-summary">
              <button className="button subtle tiny" type="button" onClick={() => setShowReport((current) => !current)}>
                {showReport ? 'Hide Report' : 'View Report'}
              </button>
              <span className="muted small">
                Imported {lastImportReport.rowsImported}, skipped {lastImportReport.rowsSkipped}
              </span>
            </div>
          ) : (
            <span />
          )}
          <button
            className="button subtle paw-pill"
            type="button"
            onClick={handleClose}
            disabled={isBusy || isPreparingImport}
          >
            Cancel
          </button>
          <button
            className="button paw-pill"
            type="button"
            onClick={() => void handleImport()}
            disabled={isBusy || isPreparingImport || !rawText}
          >
            {isBusy || isPreparingImport ? 'Importing...' : 'Import Mapped Rows'}
          </button>
        </div>
      </section>
    </div>
  )
}
