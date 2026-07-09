// Plans, mocked payment & invite redemption (D11).
import type { Hono } from 'hono'
import { z } from 'zod'
import { requireUser } from '../auth.js'
import { HttpError } from '../http.js'
import * as db from '../db.js'
import { parseBody } from './shared.js'

/** Token packs the mocked checkout sells (real Stripe/crypto is Phase 8). */
const CREDIT_PACKS = [100_000, 500_000, 1_000_000] as const

const planCheckoutSchema = z.object({
  tokens: z
    .number()
    .int()
    .refine((n) => (CREDIT_PACKS as readonly number[]).includes(n), {
      message: 'pick one of the offered token packs',
    }),
})
const planRedeemSchema = z.object({ code: z.string().trim().min(3).max(64) })

export function registerPlanRoutes(api: Hono): void {
  // Mocked "payment": grant a token-credit pack and flip to the paid 'host' plan.
  api.post('/plan/checkout', async (c) => {
    const user = await requireUser(c)
    const { tokens } = await parseBody(c, planCheckoutSchema)
    await db.grantCredit(user.id, tokens)
    return c.json({ ok: true, plan: 'host', granted: tokens })
  })

  // Redeem an admin-minted invite code for its token credit (also → 'host' plan).
  api.post('/plan/redeem', async (c) => {
    const user = await requireUser(c)
    const { code } = await parseBody(c, planRedeemSchema)
    const granted = await db.redeemInviteCode(code.trim(), user.id)
    if (granted === null) throw new HttpError(400, 'that invite code is invalid, expired, or already used')
    return c.json({ ok: true, plan: 'host', granted })
  })
}
