import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, ensureDataDir } from './config.js'

/**
 * Symmetric encryption for secrets at rest (per-user provider API keys).
 * AES-256-GCM via stdlib `node:crypto` — no runtime dependency.
 *
 * The master key comes from `SENIORBRO_SECRET` (required in hosted/prod). In
 * local mode we persist a random key to `~/.senior-bro/secret.key` (0600) so a
 * single-user box works with zero configuration.
 */
const KEY_PATH = path.join(DATA_DIR, 'secret.key')

let cachedKey: Buffer | null = null

function masterKey(): Buffer {
  if (cachedKey) return cachedKey
  const fromEnv = process.env.SENIORBRO_SECRET
  if (fromEnv && fromEnv.length >= 16) {
    cachedKey = crypto.createHash('sha256').update(fromEnv).digest()
    return cachedKey
  }
  ensureDataDir()
  try {
    cachedKey = Buffer.from(fs.readFileSync(KEY_PATH, 'utf8').trim(), 'hex')
    if (cachedKey.length === 32) return cachedKey
  } catch {
    // fall through and generate
  }
  cachedKey = crypto.randomBytes(32)
  fs.writeFileSync(KEY_PATH, cachedKey.toString('hex'), { mode: 0o600 })
  return cachedKey
}

/** Encrypt UTF-8 plaintext → `base64(iv | authTag | ciphertext)`. */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

/** Reverse of {@link encryptSecret}. Returns '' for empty/invalid input. */
export function decryptSecret(blob: string): string {
  if (!blob) return ''
  try {
    const raw = Buffer.from(blob, 'base64')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const data = raw.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

/** Cryptographically-random URL-safe token (sessions, magic links). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}
