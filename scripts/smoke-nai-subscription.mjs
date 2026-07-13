import { existsSync, readFileSync } from 'node:fs'

function readToken() {
  const envToken = process.env.NAI_TOKEN?.trim()
  if (envToken) return envToken
  if (!existsSync('.env')) return ''

  const env = readFileSync('.env', 'utf8')
  const match = env.match(/^\s*NAI_TOKEN\s*=\s*(.+?)\s*$/m)
  return match?.[1]?.replace(/^["']|["']$/g, '').trim() ?? ''
}

const token = readToken()

if (!token) {
  console.log('SKIP smoke:nai-subscription - NAI_TOKEN is not set.')
  process.exit(0)
}

const endpoint = 'https://image.novelai.net/user/subscription'
const response = await fetch(endpoint, {
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
})

if (!response.ok) {
  throw new Error(`subscription smoke failed with HTTP ${response.status}`)
}

const data = await response.json()
console.log(JSON.stringify({
  ok: true,
  endpoint,
  tier: data.tier,
  hasTrainingStepsLeft: Boolean(data.trainingStepsLeft),
}, null, 2))
