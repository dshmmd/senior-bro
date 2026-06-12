import fs from 'node:fs'
import path from 'node:path'

export default function globalSetup(): void {
  const dir = path.resolve(import.meta.dirname, '../.e2e-home/.senior-bro')
  fs.rmSync(path.dirname(dir), { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ provider: 'mock', apiKey: 'mock-key', model: 'mock-1' }),
  )
}
