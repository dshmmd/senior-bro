import { test, expect } from '@playwright/test'

test('landing → profile → calibration → interview → report', async ({ page }) => {
  // landing
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Interview like it's/ })).toBeVisible()
  await page.getByRole('button', { name: 'Launch Senior Bro →' }).click()

  // profile (provider preconfigured as mock by global setup)
  await expect(page.getByRole('heading', { name: 'Who are we interviewing for?' })).toBeVisible()
  await page.getByPlaceholder('e.g. Senior Backend Engineer').fill('Backend Engineer')
  await page.getByPlaceholder('e.g. Go, PostgreSQL, Kubernetes, system design').fill('Go, PostgreSQL')
  await page.getByRole('button', { name: 'Continue to level check →' }).click()

  // calibration: 5 questions
  await expect(page.getByRole('heading', { name: 'Quick level check' })).toBeVisible()
  for (let i = 1; i <= 5; i++) {
    await expect(page.getByText(`Question ${i} of 5`)).toBeVisible()
    await page
      .getByPlaceholder('Your answer… (or leave blank to skip)')
      .fill(`Answer ${i}: it depends on the constraints.`)
    await page.getByRole('button', { name: i === 5 ? 'Submit for grading' : 'Next question →' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Level check complete' })).toBeVisible()
  await page.getByRole('button', { name: 'Go to dashboard →' }).click()

  // dashboard → text interview
  await expect(page.getByRole('heading', { name: 'Ready when you are' })).toBeVisible()
  await page.getByText('⌨️ Text interview').click()

  // interview: opener streams in, then 3 answers until wrap
  await expect(page.getByText(/tell me briefly about your current role/)).toBeVisible({ timeout: 15_000 })
  const composer = page.getByPlaceholder(/Type your answer/)
  const turns: { answer: string; expectNext: RegExp }[] = [
    {
      answer: 'I build Go services behind PostgreSQL.',
      expectNext: /disagreed with a teammate/,
    },
    {
      answer: 'I disagreed about an index change; we benchmarked and shipped the better one.',
      expectNext: /URL shortener/,
    },
    {
      answer: 'Hash the URL, store the mapping, cache hot links, shard by key prefix.',
      expectNext: /Great session/,
    },
  ]
  const sendBtn = page.getByRole('button', { name: 'Send', exact: true })
  for (const turn of turns) {
    await composer.fill(turn.answer)
    // the Send button stays disabled until the previous streamed reply finishes
    await expect(sendBtn).toBeEnabled({ timeout: 15_000 })
    await sendBtn.click()
    await expect(page.getByText(turn.expectNext)).toBeVisible({ timeout: 15_000 })
  }
  await expect(page.getByText('The interviewer has wrapped up')).toBeVisible({ timeout: 15_000 })

  // evaluation report
  await page.getByRole('button', { name: 'Get my report' }).click()
  await expect(page.getByRole('heading', { name: 'Your interview report' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('72')).toBeVisible()
  await expect(page.getByText('System design depth', { exact: true })).toBeVisible()
})
