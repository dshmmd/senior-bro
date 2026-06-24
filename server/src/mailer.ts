/**
 * Magic-link delivery. We deliberately ship no SMTP dependency: the link is
 * always logged (structured), and a real deploy wires delivery via a webhook in
 * `SENIORBRO_MAGICLINK_WEBHOOK` (POST {email, link}) — e.g. a Resend/Postmark
 * relay — with no code change. Until that's set, hosted dev/staging can still
 * sign in because `revealLinks()` returns the URL to the client in non-prod.
 */
export function revealLinks(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export async function sendMagicLink(email: string, link: string): Promise<void> {
  console.log(JSON.stringify({ level: 'info', event: 'magic_link', email, link }))
  const webhook = process.env.SENIORBRO_MAGICLINK_WEBHOOK
  if (!webhook) return
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, link }),
    })
  } catch (err) {
    console.error(
      JSON.stringify({ level: 'error', event: 'magic_link_webhook_failed', message: String(err) }),
    )
  }
}
