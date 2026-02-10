import { expect, test } from '@playwright/test'

test.describe('auth and collection access flow', () => {
  test('shows login-first gate with create-account mode available', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Local Sign In' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible()

    await page.getByRole('button', { name: 'Create Account' }).click()
    await expect(page.getByRole('heading', { name: 'Create Local Account' })).toBeVisible()
  })

  test('can create a local account and create/open a collection profile', async ({ page }) => {
    const runId = Date.now().toString().slice(-6)
    const username = `e2e_user_${runId}`
    const collectionName = `E2E Collection ${runId}`

    await page.goto('/')
    await page.getByRole('button', { name: 'Create Account' }).click()
    await page.getByLabel('Username').fill(username)
    await page.getByPlaceholder('Minimum 6 characters').fill('pass1234')
    await page.getByLabel('Confirm Password').fill('pass1234')
    await page.getByRole('button', { name: 'Create Local Account' }).click()

    await expect(page.getByRole('heading', { name: 'Collection Access' })).toBeVisible()
    await page.getByRole('button', { name: 'Create New' }).click()
    await page.getByLabel('Collection name').fill(collectionName)
    await page.getByRole('button', { name: 'Create Collection' }).click()

    await expect(page.getByText('Collection Control Center')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change Collection' })).toBeVisible()
  })
})
