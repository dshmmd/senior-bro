import { test, expect } from '@playwright/test'

// RF-5: every view has a real URL — refresh keeps your place, browser Back works,
// and deep links land on the right page (with the gate redirecting when needed).
// Runs after happy-path.spec.ts (single worker, alphabetical), which leaves a
// calibrated profile behind in the shared test DB.
test('urls: deep link, refresh in place, browser back', async ({ page }) => {
  // Deep-link straight into the app — no landing detour.
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: /Welcome back|Ready when you are/ })).toBeVisible()

  // Navigate to progress; the URL reflects it.
  await page.getByText('🌌 Your constellation').click()
  await expect(page).toHaveURL(/\/progress$/)
  await expect(page.getByRole('heading', { name: 'Your constellation' })).toBeVisible()

  // Refresh keeps the place (the old view-state machine would have reset to the dashboard).
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your constellation' })).toBeVisible()

  // Browser Back returns to the dashboard.
  await page.goBack()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: /Welcome back|Ready when you are/ })).toBeVisible()

  // A nonsense path falls back to the front door.
  await page.goto('/no-such-page')
  await expect(page).toHaveURL(/\/$/)
})
