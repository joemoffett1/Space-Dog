import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const THIS_FILE = fileURLToPath(import.meta.url)
const THIS_DIR = path.dirname(THIS_FILE)
const ROOT_DIR = path.resolve(THIS_DIR, '..', '..', '..')
const ROOT_SCREENSHOT_DIR = path.resolve(THIS_DIR, '..', '..', '..', 'docs', 'screenshots')
const COLLECTION_IMPORT_CANDIDATES = [
  path.join(ROOT_DIR, 'archidekt-collection-export-2026-02-09.csv'),
  path.join(ROOT_DIR, 'archidekt-collection-export-2026-01-30.csv'),
]

function resolveCollectionImportFile(): string {
  for (const candidate of COLLECTION_IMPORT_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(`No collection export file found. Checked: ${COLLECTION_IMPORT_CANDIDATES.join(', ')}`)
}

function buildSampleImportFile(sourcePath: string, maxDataRows: number): string {
  const raw = fs.readFileSync(sourcePath, 'utf8')
  const normalized = raw.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length <= 1) {
    return sourcePath
  }
  const header = lines[0]
  const rows = lines.slice(1).filter((line) => line.trim().length > 0).slice(0, maxDataRows)
  const content = [header, ...rows].join('\n')
  const target = path.join(os.tmpdir(), `magiccollection-readme-import-${Date.now()}.csv`)
  fs.writeFileSync(target, content, 'utf8')
  return target
}

test('capture README screenshots', async ({ page }) => {
  test.setTimeout(300_000)
  fs.mkdirSync(ROOT_SCREENSHOT_DIR, { recursive: true })
  const collectionImportSource = resolveCollectionImportFile()
  const collectionImportFile = buildSampleImportFile(collectionImportSource, 3500)

  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Local Sign In' })).toBeVisible()
    await page.screenshot({
      path: path.join(ROOT_SCREENSHOT_DIR, 'feature-login.png'),
      fullPage: true,
    })

    await page.getByRole('button', { name: 'Create Account' }).click()
    await expect(page.getByRole('heading', { name: 'Create Local Account' })).toBeVisible()
    await page.getByLabel('Username').fill('readme_demo_user')
    await page.getByLabel('Email (optional)').fill('readme-demo@example.com')
    await page.getByPlaceholder('Minimum 6 characters').fill('readme123')
    await page.getByPlaceholder('Re-enter password').fill('readme123')
    await page.getByRole('button', { name: 'Create Local Account' }).click()

    await expect(page.getByRole('heading', { name: 'Collection Access' })).toBeVisible()
    await page.screenshot({
      path: path.join(ROOT_SCREENSHOT_DIR, 'feature-collection-access.png'),
      fullPage: true,
    })

    await page.getByRole('button', { name: 'Create New' }).click()
    await page.getByLabel('Collection name').fill('README Demo Collection')
    await page.getByRole('button', { name: 'Create Collection' }).click()

    await expect(
      page.getByRole('heading', { name: 'README Demo Collection', exact: true }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Import Collection File' }).click()
    await expect(page.getByRole('heading', { name: 'Import Collection File' })).toBeVisible()
    await page.locator('.import-wizard-modal input[type="file"]').setInputFiles(collectionImportFile)
    await expect(page.locator('.import-wizard-modal')).toContainText('Loaded:')
    await page.screenshot({
      path: path.join(ROOT_SCREENSHOT_DIR, 'feature-import-wizard.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Import Mapped Rows' }).click()
    await expect(page.locator('.import-wizard-modal')).toContainText('Imported', {
      timeout: 180_000,
    })
    await page.getByRole('button', { name: 'Close import wizard' }).click()
    await expect(page.getByRole('heading', { name: 'Import Collection File' })).not.toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText(/Showing \d+ of \d+ printings\./)).toBeVisible({ timeout: 120_000 })
    await page.waitForTimeout(1000)
    await page.screenshot({
      path: path.join(ROOT_SCREENSHOT_DIR, 'feature-collection-overview.png'),
      fullPage: true,
    })

    await page.getByRole('button', { name: /Add Card/i }).click()
    await expect(page.getByRole('heading', { name: 'Add Cards To Collection' })).toBeVisible()
    await page
      .getByPlaceholder('Search cards to add (e.g. name:"Sol Ring" or set:lea)')
      .fill('Sol Ring')
    await page.getByRole('button', { name: /^Search$/ }).click()
    await expect(page.locator('.submenu-modal .version-card').first()).toBeVisible()
    try {
      await expect(page.locator('.submenu-modal .version-card >> text=Owned:').first()).toBeVisible({
        timeout: 8000,
      })
    } catch {
      // Keep screenshot capture resilient if search data is still streaming.
    }
    await page.screenshot({
      path: path.join(ROOT_SCREENSHOT_DIR, 'feature-add-card-modal.png'),
      fullPage: true,
    })

    await page
      .locator('.submenu-modal .version-card')
      .first()
      .getByRole('button', { name: '+N' })
      .click()
    await page.getByRole('button', { name: 'Close submenu' }).click()

    await page.getByRole('button', { name: 'Image View' }).click()
    await page.waitForTimeout(800)
    await page.screenshot({
      path: path.join(ROOT_SCREENSHOT_DIR, 'feature-image-view.png'),
      fullPage: true,
    })

    await page.getByRole('button', { name: 'Import Collection File' }).click()
    await expect(page.getByRole('heading', { name: 'Import Collection File' })).toBeVisible()
    await page.screenshot({
      path: path.join(ROOT_SCREENSHOT_DIR, 'feature-import-wizard.png'),
      fullPage: true,
    })
  } finally {
    if (
      collectionImportFile !== collectionImportSource &&
      fs.existsSync(collectionImportFile)
    ) {
      fs.rmSync(collectionImportFile, { force: true })
    }
  }
})
