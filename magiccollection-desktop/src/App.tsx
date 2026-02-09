import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { AppNav } from './components/AppNav'
import { LocalAuthGate } from './components/LocalAuthGate'
import { ProfileGate } from './components/ProfileGate'
import { CollectionPage } from './pages/CollectionPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import {
  addCardToCollection,
  asCardMap,
  bulkUpdateTags,
  createProfile,
  getCollection,
  importCollectionRows,
  listProfiles,
  recordMarketSnapshots,
  removeCardFromCollection,
  setOwnedCardState,
  updateOwnedCardMetadata,
  updateCardQuantity,
} from './lib/backend'
import { parseArchidektCsv } from './lib/importers/archidekt'
import { recordPerfMetric } from './lib/perfMetrics'
import {
  cancelCatalogSyncRun,
  getCatalogPriceRecords,
  getCatalogSyncStatus,
  seedDemoOutdatedCatalogOnce,
  syncCatalogFromMockPatches,
} from './lib/catalogSync'
import {
  clearActiveProfileId,
  loadActiveProfileId,
  saveActiveProfileId,
} from './lib/session'
import {
  listProtectedProfileIds,
  setProfilePasscode,
} from './lib/profileAuth'
import {
  getLocalAuthStatus,
  loginLocalAuthAccount,
  logoutLocalAuthAccount,
  markLocalAuthSynced,
  registerLocalAuthAccount,
  type LocalAuthStatus,
} from './lib/localAuth'
import type {
  AddCardInput,
  AppTab,
  CreateProfileRequest,
  OwnedCard,
  UpdateOwnedCardMetadataInput,
  OwnedCardMap,
  Profile,
} from './types'

const MarketPage = lazy(() => import('./pages/MarketPage'))

type MarketAddInput = Omit<AddCardInput, 'profileId'>
type CardUndoEntry = {
  cardId: string
  before: OwnedCard | null
}
type UndoEntry = {
  id: string
  label: string
  createdAt: string
  cards: CardUndoEntry[]
}
const MAX_UNDO_ENTRIES = 30

const SCRYFALL_COLLECTION_BATCH = 75

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [localAuthStatus, setLocalAuthStatus] = useState<LocalAuthStatus>(() =>
    getLocalAuthStatus(),
  )
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() =>
    loadActiveProfileId(),
  )
  const [activeTab, setActiveTab] = useState<AppTab>('collection')
  const [ownedCards, setOwnedCards] = useState<OwnedCardMap>({})
  const [protectedProfileIds, setProtectedProfileIds] = useState<Set<string>>(new Set())
  const [isInitializing, setIsInitializing] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [dataBuildVersion, setDataBuildVersion] = useState<string>('unknown')
  const [localBuildVersion, setLocalBuildVersion] = useState<string | null>(null)
  const [refreshLockedUntil, setRefreshLockedUntil] = useState<string>('')
  const [refreshEnabled, setRefreshEnabled] = useState(false)
  const [refreshReason, setRefreshReason] = useState('Loading data build status...')
  const [clockTick, setClockTick] = useState<number>(Date.now())
  const [syncProgressPct, setSyncProgressPct] = useState<number | null>(null)
  const [syncProgressText, setSyncProgressText] = useState<string>('')
  const [tabSwitchStartedAt, setTabSwitchStartedAt] = useState<number | null>(null)
  const [isAuthBusy, setIsAuthBusy] = useState(false)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const refreshAbortRef = useRef<AbortController | null>(null)

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  )

  const sortedCards = useMemo(
    () =>
      Object.values(ownedCards).sort((a, b) => {
        const qtyDelta =
          b.quantity + b.foilQuantity - (a.quantity + a.foilQuantity)
        if (qtyDelta !== 0) {
          return qtyDelta
        }
        return a.name.localeCompare(b.name)
      }),
    [ownedCards],
  )

  function mergeDerivedTags(baseTags: string[], quantity: number, foilQuantity: number) {
    const merged = new Set(baseTags.map((tag) => tag.trim()).filter(Boolean))
    if (foilQuantity > 0) {
      merged.add('foil')
    }
    if (quantity + foilQuantity >= 4) {
      merged.add('playset')
    }
    if (quantity + foilQuantity > 0) {
      merged.add('owned')
    }
    return [...merged]
  }

  function applyLocalQuantityDelta(cardId: string, foil: boolean, delta: number) {
    setOwnedCards((previous) => {
      const existing = previous[cardId]
      if (!existing) {
        return previous
      }

      const next = { ...existing }
      if (foil) {
        next.foilQuantity = Math.max(0, next.foilQuantity + delta)
      } else {
        next.quantity = Math.max(0, next.quantity + delta)
      }

      const total = next.quantity + next.foilQuantity
      if (total <= 0) {
        const copy = { ...previous }
        delete copy[cardId]
        return copy
      }

      next.updatedAt = new Date().toISOString()
      next.tags = mergeDerivedTags(next.tags, next.quantity, next.foilQuantity)
      return { ...previous, [cardId]: next }
    })
  }

  function applyLocalRemove(cardId: string) {
    setOwnedCards((previous) => {
      if (!(cardId in previous)) {
        return previous
      }
      const copy = { ...previous }
      delete copy[cardId]
      return copy
    })
  }

  function captureUndoCards(cardIds: string[]): CardUndoEntry[] {
    const uniqueIds = [...new Set(cardIds)]
    return uniqueIds.map((cardId) => ({
      cardId,
      before: ownedCards[cardId] ? { ...ownedCards[cardId], tags: [...ownedCards[cardId].tags] } : null,
    }))
  }

  function pushUndoEntry(label: string, cards: CardUndoEntry[]) {
    if (!cards.length) {
      return
    }
    const entry: UndoEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      label,
      createdAt: new Date().toISOString(),
      cards,
    }
    setUndoStack((previous) => [entry, ...previous].slice(0, MAX_UNDO_ENTRIES))
  }

  async function restoreCollectionFromBackend(profileId: string) {
    const cards = await getCollection(profileId)
    setOwnedCards(asCardMap(cards))
  }

  function refreshProtectedProfiles(nextProfiles: Profile[]) {
    setProtectedProfileIds(
      listProtectedProfileIds(nextProfiles.map((profile) => profile.id)),
    )
  }

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        setLocalAuthStatus(getLocalAuthStatus())
        const fetchedProfiles = await listProfiles()
        if (cancelled) {
          return
        }

        setProfiles(fetchedProfiles)
        refreshProtectedProfiles(fetchedProfiles)

        if (activeProfileId) {
          const exists = fetchedProfiles.some(
            (profile) => profile.id === activeProfileId,
          )
          if (!exists) {
            setActiveProfileId(null)
            clearActiveProfileId()
            setOwnedCards({})
          } else {
            const cards = await getCollection(activeProfileId)
            if (cancelled) {
              return
            }
            setOwnedCards(asCardMap(cards))
          }
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to initialize app data.',
          )
        }
      } finally {
        if (!cancelled) {
          setIsInitializing(false)
        }
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (tabSwitchStartedAt === null) {
      return
    }
    const elapsed = performance.now() - tabSwitchStartedAt
    recordPerfMetric(`tab:${activeTab}`, elapsed)
    setTabSwitchStartedAt(null)
  }, [activeTab, tabSwitchStartedAt])

  useEffect(() => {
    if (!activeProfileId) {
      clearActiveProfileId()
      return
    }
    saveActiveProfileId(activeProfileId)
  }, [activeProfileId])

  useEffect(() => {
    let cancelled = false

    async function refreshStatus() {
      try {
        const status = await getCatalogSyncStatus()
        if (cancelled) {
          return
        }
        setDataBuildVersion(status.latestVersion)
        setLocalBuildVersion(status.localVersion)
        setRefreshLockedUntil(status.refreshLockedUntilUtc)
        setRefreshEnabled(status.canRefreshNow)
        setRefreshReason(status.reason)
      } catch {
        if (cancelled) {
          return
        }
        setRefreshEnabled(false)
        setRefreshReason('Unable to read sync manifest.')
      }
    }

    async function bootstrapStatus() {
      await seedDemoOutdatedCatalogOnce()
      await refreshStatus()
    }

    void bootstrapStatus()
    const timer = window.setInterval(() => {
      setClockTick(Date.now())
      void refreshStatus()
    }, 60_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  async function handleCreateProfile(input: CreateProfileRequest): Promise<boolean> {
    const normalized = input.name.trim()
    if (!normalized) {
      return false
    }

    const duplicate = profiles.some(
      (profile) => profile.name.trim().toLowerCase() === normalized.toLowerCase(),
    )
    if (duplicate) {
      setErrorMessage(
        'Collection already exists. Use Open Collection to sign in.',
      )
      return false
    }

    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    setIsSyncing(true)
    try {
      const profile = await createProfile(normalized)
      const passcode = input.passcode?.trim()
      if (passcode) {
        setProfilePasscode(profile.id, passcode)
      }
      const fetchedProfiles = await listProfiles()
      const cards = await getCollection(profile.id)
      setProfiles(fetchedProfiles)
      refreshProtectedProfiles(fetchedProfiles)
      setActiveProfileId(profile.id)
      setOwnedCards(asCardMap(cards))
      setUndoStack([])
      setActiveTab('collection')
      return true
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to create profile.',
      )
      return false
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleOpenProfile(profileId: string): Promise<boolean> {
    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    setIsSyncing(true)
    try {
      const cards = await getCollection(profileId)
      setActiveProfileId(profileId)
      setOwnedCards(asCardMap(cards))
      setUndoStack([])
      setActiveTab('collection')
      return true
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to open profile.',
      )
      return false
    } finally {
      setIsSyncing(false)
    }
  }

  function handleSignOut() {
    setActiveProfileId(null)
    setOwnedCards({})
    setUndoStack([])
    setActiveTab('collection')
  }

  async function handleLocalAuthRegister(input: {
    username: string
    password: string
    email?: string
  }): Promise<boolean> {
    setErrorMessage('')
    setIsAuthBusy(true)
    try {
      await registerLocalAuthAccount(input)
      setLocalAuthStatus(getLocalAuthStatus())
      return true
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to create local account.',
      )
      return false
    } finally {
      setIsAuthBusy(false)
    }
  }

  async function handleLocalAuthLogin(input: {
    username: string
    password: string
  }): Promise<boolean> {
    setErrorMessage('')
    setIsAuthBusy(true)
    try {
      const ok = await loginLocalAuthAccount(input)
      if (ok) {
        setLocalAuthStatus(getLocalAuthStatus())
      }
      return ok
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to sign in locally.',
      )
      return false
    } finally {
      setIsAuthBusy(false)
    }
  }

  function handleLocalAuthSignOut() {
    logoutLocalAuthAccount()
    setLocalAuthStatus(getLocalAuthStatus())
    handleSignOut()
  }

  function handleMarkLocalAuthSynced() {
    markLocalAuthSynced()
    setLocalAuthStatus(getLocalAuthStatus())
  }

  function handleSelectTab(nextTab: AppTab) {
    setTabSwitchStartedAt(performance.now())
    setActiveTab(nextTab)
  }

  async function handleAddCard(input: MarketAddInput) {
    if (!activeProfile) {
      return
    }

    const undoCards = captureUndoCards([input.scryfallId])
    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    setIsSyncing(true)
    try {
      const cards = await addCardToCollection({
        ...input,
        profileId: activeProfile.id,
      })
      setOwnedCards(asCardMap(cards))
      pushUndoEntry(`Add ${input.name}`, undoCards)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to add card to collection.',
      )
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleIncrementCardQuantity(cardId: string, foil: boolean): Promise<void> {
    if (!activeProfile) {
      return
    }

    const undoCards = captureUndoCards([cardId])
    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    applyLocalQuantityDelta(cardId, foil, 1)
    setIsSyncing(true)
    try {
      const cards = await updateCardQuantity({
        profileId: activeProfile.id,
        scryfallId: cardId,
        foil,
        delta: 1,
      })
      setOwnedCards(asCardMap(cards))
      pushUndoEntry(foil ? 'Add foil copy' : 'Add nonfoil copy', undoCards)
    } catch (error) {
      await restoreCollectionFromBackend(activeProfile.id)
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to increment card quantity.',
      )
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleDecrementCardQuantity(cardId: string, foil: boolean): Promise<void> {
    if (!activeProfile) {
      return
    }

    const undoCards = captureUndoCards([cardId])
    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    applyLocalQuantityDelta(cardId, foil, -1)
    setIsSyncing(true)
    try {
      const cards = await updateCardQuantity({
        profileId: activeProfile.id,
        scryfallId: cardId,
        foil,
        delta: -1,
      })
      setOwnedCards(asCardMap(cards))
      pushUndoEntry(foil ? 'Remove foil copy' : 'Remove nonfoil copy', undoCards)
    } catch (error) {
      await restoreCollectionFromBackend(activeProfile.id)
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to decrement card quantity.',
      )
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleRemoveCard(cardId: string): Promise<void> {
    if (!activeProfile) {
      return
    }

    const undoCards = captureUndoCards([cardId])
    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    applyLocalRemove(cardId)
    setIsSyncing(true)
    try {
      const cards = await removeCardFromCollection({
        profileId: activeProfile.id,
        scryfallId: cardId,
      })
      setOwnedCards(asCardMap(cards))
      pushUndoEntry('Remove card', undoCards)
    } catch (error) {
      await restoreCollectionFromBackend(activeProfile.id)
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to remove card from collection.',
      )
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleTagCard(cardId: string, tag: string): Promise<void> {
    if (!activeProfile || !tag.trim()) {
      return
    }

    const undoCards = captureUndoCards([cardId])
    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    setIsSyncing(true)
    try {
      const cards = await bulkUpdateTags({
        profileId: activeProfile.id,
        scryfallIds: [cardId],
        tags: [tag],
        includeAutoRules: false,
      })
      setOwnedCards(asCardMap(cards))
      pushUndoEntry(`Tag card (${tag})`, undoCards)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to tag card.',
      )
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleUpdateCardMetadata(
    cardId: string,
    metadata: Omit<UpdateOwnedCardMetadataInput, 'profileId' | 'scryfallId'>,
  ): Promise<void> {
    if (!activeProfile) {
      return
    }

    const undoCards = captureUndoCards([cardId])
    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    setIsSyncing(true)
    try {
      const cards = await updateOwnedCardMetadata({
        profileId: activeProfile.id,
        scryfallId: cardId,
        ...metadata,
      })
      setOwnedCards(asCardMap(cards))
      pushUndoEntry('Edit card metadata', undoCards)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to update card metadata.',
      )
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleBulkUpdateCardMetadata(
    cardIds: string[],
    metadata: Omit<UpdateOwnedCardMetadataInput, 'profileId' | 'scryfallId'>,
  ): Promise<void> {
    if (!activeProfile || !cardIds.length) {
      return
    }

    const undoCards = captureUndoCards(cardIds)
    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    setIsSyncing(true)
    try {
      let latestCards = await getCollection(activeProfile.id)
      for (const cardId of cardIds) {
        latestCards = await updateOwnedCardMetadata({
          profileId: activeProfile.id,
          scryfallId: cardId,
          ...metadata,
        })
      }
      setOwnedCards(asCardMap(latestCards))
      pushUndoEntry(`Bulk metadata update (${cardIds.length})`, undoCards)
    } catch (error) {
      await restoreCollectionFromBackend(activeProfile.id)
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to bulk update metadata.',
      )
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleUndoLastAction(): Promise<void> {
    if (!activeProfile || !undoStack.length) {
      return
    }

    const [entry, ...remaining] = undoStack
    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    setIsSyncing(true)
    try {
      let latestCards = await getCollection(activeProfile.id)
      for (const row of entry.cards) {
        if (!row.before) {
          latestCards = await removeCardFromCollection({
            profileId: activeProfile.id,
            scryfallId: row.cardId,
          })
          continue
        }
        latestCards = await setOwnedCardState({
          profileId: activeProfile.id,
          card: row.before,
        })
      }
      setOwnedCards(asCardMap(latestCards))
      setUndoStack(remaining)
    } catch (error) {
      await restoreCollectionFromBackend(activeProfile.id)
      setErrorMessage(error instanceof Error ? error.message : 'Unable to undo last action.')
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleRefreshCollectionPrices(): Promise<string> {
    if (!activeProfile) {
      return 'No active profile.'
    }

    const cards = Object.values(ownedCards)
    if (!cards.length) {
      return 'No cards to refresh.'
    }

    setErrorMessage('')
    setSyncProgressPct(0)
    setSyncProgressText('Starting')
    setIsSyncing(true)
    const refreshController = new AbortController()
    refreshAbortRef.current = refreshController

    function ensureNotCanceled() {
      if (refreshController.signal.aborted) {
        throw new Error('Sync canceled by user.')
      }
    }
    try {
      ensureNotCanceled()
      setSyncProgressPct(8)
      setSyncProgressText('Syncing patch version')
      const catalogSync = await syncCatalogFromMockPatches()
      ensureNotCanceled()
      setSyncProgressPct(20)
      setSyncProgressText('Matching local price cache')
      const catalogPriceMap = await getCatalogPriceRecords(
        cards.map((card) => card.scryfallId),
      )
      const directSnapshots = cards
        .map((card) => {
          const local = catalogPriceMap[card.scryfallId]
          if (!local || !Number.isFinite(local.marketPrice)) {
            return null
          }
          return {
            scryfallId: card.scryfallId,
            name: card.name,
            setCode: card.setCode,
            collectorNumber: card.collectorNumber,
            imageUrl: card.imageUrl,
            marketPrice: local.marketPrice,
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

      if (directSnapshots.length) {
        await recordMarketSnapshots(directSnapshots)
      }
      ensureNotCanceled()
      setSyncProgressPct(30)
      setSyncProgressText('Applying cached snapshots')

      const matchedIds = new Set(directSnapshots.map((item) => item.scryfallId))
      const missingCards = cards.filter((card) => !matchedIds.has(card.scryfallId))

      for (let i = 0; i < missingCards.length; i += SCRYFALL_COLLECTION_BATCH) {
        const batch = missingCards.slice(i, i + SCRYFALL_COLLECTION_BATCH)
        if (!batch.length) {
          continue
        }
        const response = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: refreshController.signal,
          body: JSON.stringify({
            identifiers: batch.map((card) => ({ id: card.scryfallId })),
          }),
        })

        if (!response.ok) {
          throw new Error(`Scryfall collection sync failed (${response.status}).`)
        }

        const payload = (await response.json()) as {
          data?: Array<{
            id: string
            name?: string
            set?: string
            collector_number?: string
            image_uris?: { normal?: string }
            card_faces?: Array<{ image_uris?: { normal?: string } }>
            prices?: { usd?: string | null; usd_foil?: string | null }
          }>
        }

        const snapshots = (payload.data ?? [])
          .map((entry) => {
            const marketPrice = entry.prices?.usd ?? entry.prices?.usd_foil ?? null
            const numeric = marketPrice === null ? null : Number(marketPrice)
            if (numeric === null || !Number.isFinite(numeric)) {
              return null
            }
            return {
              scryfallId: entry.id,
              name: entry.name ?? '',
              setCode: (entry.set ?? '').toLowerCase(),
              collectorNumber: entry.collector_number ?? '',
              imageUrl: entry.image_uris?.normal ?? entry.card_faces?.[0]?.image_uris?.normal,
              marketPrice: numeric,
            }
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

        if (snapshots.length) {
          await recordMarketSnapshots(snapshots)
        }
        ensureNotCanceled()

        const batchIndex = Math.floor(i / SCRYFALL_COLLECTION_BATCH) + 1
        const batchTotal = Math.max(1, Math.ceil(missingCards.length / SCRYFALL_COLLECTION_BATCH))
        const batchProgress = batchIndex / batchTotal
        const pct = Math.min(96, Math.round(30 + batchProgress * 65))
        setSyncProgressPct(pct)
        setSyncProgressText(`Fetching Scryfall batch ${batchIndex}/${batchTotal}`)

        await new Promise((resolve) => setTimeout(resolve, 80))
      }

      setSyncProgressPct(98)
      setSyncProgressText('Finalizing collection trends')
      ensureNotCanceled()
      await restoreCollectionFromBackend(activeProfile.id)
      try {
        const status = await getCatalogSyncStatus()
        setDataBuildVersion(status.latestVersion)
        setLocalBuildVersion(status.localVersion)
        setRefreshLockedUntil(status.refreshLockedUntilUtc)
        setRefreshEnabled(status.canRefreshNow)
        setRefreshReason(status.reason)
      } catch {
        // ignore status refresh failure
      }
      setSyncProgressPct(100)
      setSyncProgressText('Complete')
      return `Catalog sync ${catalogSync.fromVersion ?? 'none'} -> ${
        catalogSync.toVersion
      }, patches ${catalogSync.appliedPatches}, matched ${directSnapshots.length}, fallback ${
        missingCards.length
      }.`
    } catch (error) {
      if (refreshController.signal.aborted) {
        return 'Sync canceled.'
      }
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to refresh prices from Scryfall.',
      )
      return error instanceof Error ? error.message : 'Price refresh failed.'
    } finally {
      refreshAbortRef.current = null
      window.setTimeout(() => {
        setSyncProgressPct(null)
        setSyncProgressText('')
      }, 800)
      setIsSyncing(false)
    }
  }

  function handleCancelSync() {
    const canceledCatalog = cancelCatalogSyncRun()
    if (refreshAbortRef.current && !refreshAbortRef.current.signal.aborted) {
      refreshAbortRef.current.abort()
    }
    if (canceledCatalog || refreshAbortRef.current) {
      setSyncProgressText('Canceling')
    }
  }

  async function handleImportArchidektCsv(file: File): Promise<{
    rowsImported: number
    copiesImported: number
    rowsSkipped: number
  }> {
    if (!activeProfile) {
      throw new Error('No active collection profile selected.')
    }

    const csvText = await file.text()
    const parsed = parseArchidektCsv(csvText)
    if (!parsed.rows.length) {
      throw new Error('No importable rows found in the selected CSV.')
    }

    setErrorMessage('')
    setSyncProgressPct(null)
    setSyncProgressText('')
    setIsSyncing(true)
    try {
      const cards = await importCollectionRows({
        profileId: activeProfile.id,
        rows: parsed.rows,
      })
      setOwnedCards(asCardMap(cards))
      return {
        rowsImported: parsed.rowsImported,
        copiesImported: parsed.copiesImported,
        rowsSkipped: parsed.rowsSkipped,
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to import Archidekt CSV.'
      setErrorMessage(message)
      throw new Error(message)
    } finally {
      setIsSyncing(false)
    }
  }

  if (isInitializing) {
    return (
      <main className="gate-wrap">
        <section className="gate-card">
          <h1>Booting MagicCollection</h1>
          <p className="muted">Loading profiles and collection state.</p>
        </section>
      </main>
    )
  }

  if (!localAuthStatus.signedIn) {
    return (
      <LocalAuthGate
        status={localAuthStatus}
        onRegister={handleLocalAuthRegister}
        onLogin={handleLocalAuthLogin}
        errorMessage={errorMessage}
        isBusy={isAuthBusy}
      />
    )
  }

  if (!activeProfile) {
    return (
      <ProfileGate
        profiles={profiles}
        protectedProfileIds={protectedProfileIds}
        onCreateProfile={handleCreateProfile}
        onOpenProfile={handleOpenProfile}
        errorMessage={errorMessage}
        isSyncing={isSyncing}
      />
    )
  }

  const isDataBuildSynced =
    !!localBuildVersion && localBuildVersion === dataBuildVersion

  function formatRemaining(unlockIso: string): string {
    if (!unlockIso) {
      return 'unknown'
    }
    const unlock = new Date(unlockIso).getTime()
    const now = clockTick
    const diff = unlock - now
    if (diff <= 0) {
      return 'available now'
    }
    const totalMinutes = Math.ceil(diff / 60_000)
    const days = Math.floor(totalMinutes / (24 * 60))
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
    const minutes = totalMinutes % 60

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  function formatLocalUnlock(unlockIso: string): string {
    if (!unlockIso) {
      return 'unknown'
    }
    const unlock = new Date(unlockIso)
    if (Number.isNaN(unlock.getTime())) {
      return 'unknown'
    }
    return unlock.toLocaleString()
  }

  const refreshTitle = refreshEnabled
    ? 'Refresh available now.'
    : refreshReason.includes('window')
      ? `Next refresh in ${formatRemaining(refreshLockedUntil)} (local ${formatLocalUnlock(refreshLockedUntil)}).`
      : refreshReason
  const latestUndo = undoStack[0] ?? null

  return (
    <div className="app-shell">
      <div className="atmo-ring atmo-ring-a" />
      <div className="atmo-ring atmo-ring-b" />
      <header className="app-header">
        <div>
          <p className="app-kicker">MagicCollection Desktop</p>
          <h1>{activeProfile.name}</h1>
        </div>
        <div className="profile-meta">
          <span
            className={`data-sync-pill ${
              isSyncing ? 'syncing' : isDataBuildSynced ? 'synced' : 'unsynced'
            }`}
            title={
              isSyncing
                ? 'Sync in progress.'
                : isDataBuildSynced
                ? `Local build ${localBuildVersion} matches latest.`
                : `Local build ${localBuildVersion ?? 'none'} is behind latest ${dataBuildVersion}.`
            }
          >
            {isSyncing && syncProgressPct !== null ? (
              <span className="sync-progress-pill">
                <span
                  className="sync-progress-fill"
                  style={{ width: `${Math.max(0, Math.min(100, syncProgressPct))}%` }}
                />
                <span className="sync-progress-text">
                  {syncProgressText ? `${syncProgressText} ` : ''}{Math.max(0, Math.min(100, syncProgressPct))}%
                </span>
              </span>
            ) : isSyncing ? (
              'Syncing...'
            ) : isDataBuildSynced ? (
              'Synced'
            ) : (
              'Not Synced'
            )}
          </span>
          <button
            className="refresh-icon-button"
            type="button"
            onClick={() =>
              isSyncing ? handleCancelSync() : void handleRefreshCollectionPrices()
            }
            disabled={!isSyncing && !refreshEnabled}
            title={isSyncing ? 'Cancel sync' : refreshTitle}
            aria-label={isSyncing ? 'Cancel sync' : 'Refresh catalog data build'}
          >
            {isSyncing ? 'X' : 'R'}
          </button>
          <button className="button subtle" onClick={handleSignOut}>
            Change Collection
          </button>
          <button className="button subtle" onClick={handleLocalAuthSignOut}>
            Sign Out Account
          </button>
        </div>
      </header>

      {errorMessage ? <p className="error-line">{errorMessage}</p> : null}

      <AppNav activeTab={activeTab} onSelectTab={handleSelectTab} />

      <main className="app-main">
        {activeTab === 'collection' && (
          <CollectionPage
            cards={sortedCards}
            profileName={activeProfile.name}
            onIncrement={handleIncrementCardQuantity}
            onDecrement={handleDecrementCardQuantity}
            onRemove={handleRemoveCard}
            onTagCard={handleTagCard}
            onUpdateMetadata={handleUpdateCardMetadata}
            onBulkUpdateMetadata={handleBulkUpdateCardMetadata}
            onOpenMarket={() => setActiveTab('market')}
            onImportArchidektCsv={handleImportArchidektCsv}
            onUndoLastAction={handleUndoLastAction}
            canUndo={undoStack.length > 0}
            undoLabel={latestUndo ? `${latestUndo.label} (${new Date(latestUndo.createdAt).toLocaleTimeString()})` : ''}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'market' && (
          <Suspense
            fallback={
              <section className="panel loading-panel">
                <h2>Loading Market</h2>
                <p>Market is lazy-loaded and only initialized when this tab is opened.</p>
              </section>
            }
          >
            <MarketPage
              profileId={activeProfile.id}
              ownedCards={ownedCards}
              onAddCard={handleAddCard}
            />
          </Suspense>
        )}

        {activeTab === 'reports' && <ReportsPage cards={sortedCards} />}
        {activeTab === 'settings' && (
          <SettingsPage
            activeProfile={activeProfile}
            onReturnToCollection={() => setActiveTab('collection')}
            localAuthStatus={localAuthStatus}
            onMarkLocalAuthSynced={handleMarkLocalAuthSynced}
          />
        )}
      </main>
    </div>
  )
}

export default App

