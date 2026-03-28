import { Base64, P256 } from 'ox'
import { chromium } from 'playwright-core'
import { Account as TempoAccount } from 'viem/tempo'

const serviceUrl = 'http://localhost:6969/cli-auth'

const privateKey = P256.randomPrivateKey()
const account = TempoAccount.fromP256(privateKey)
const codeVerifier = Base64.fromBytes(crypto.getRandomValues(new Uint8Array(32)), {
  pad: false,
  url: true,
})
const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
const codeChallenge = Base64.fromBytes(new Uint8Array(hash), { pad: false, url: true })

console.log('1. Creating device code...')
const createRes = await fetch(`${serviceUrl}/device-code`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code_challenge: codeChallenge,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    key_type: 'p256',
    limits: [{ limit: '0x3e8', token: '0x20c0000000000000000000000000000000000001' }],
    pub_key: account.publicKey,
  }),
})
if (!createRes.ok) throw new Error(`Device code creation failed: ${createRes.status}`)
const { code } = (await createRes.json()) as { code: string }
console.log(`   code: ${code}`)

console.log('2. Launching browser with virtual WebAuthn authenticator...')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()

const cdp = await context.newCDPSession(page)
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
  },
})
console.log('   virtual authenticator ready')

console.log(`3. Navigating to ${serviceUrl}?code=${code}`)
await page.goto(`${serviceUrl}?code=${code}`)
await page.waitForSelector('#status')

const initialStatus = await page.textContent('#status')
console.log(`   status: ${initialStatus}`)

await page.waitForFunction(
  () => {
    const el = document.getElementById('status')
    return el && !el.textContent?.includes('Loading')
  },
  { timeout: 10_000 },
)

const loadedStatus = await page.textContent('#status')
console.log(`   after load: ${loadedStatus}`)

console.log('4. Creating passkey...')
await page.click('#register')
await page.waitForFunction(
  () => {
    const el = document.getElementById('account')
    return el && el.textContent?.includes('Signed in as')
  },
  { timeout: 15_000 },
)

const accountText = await page.textContent('#account')
console.log(`   ${accountText}`)

console.log('5. Approving request...')
await page.click('#approve')
await page.waitForFunction(
  () => {
    const el = document.getElementById('status')
    return el && el.textContent?.includes('Approved')
  },
  { timeout: 15_000 },
)

const finalStatus = await page.textContent('#status')
console.log(`   ${finalStatus}`)

await browser.close()

console.log('6. Polling for authorization...')
const pollRes = await fetch(`${serviceUrl}/poll/${code}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code_verifier: codeVerifier }),
})
const pollData = (await pollRes.json()) as { status: string; account_address?: string }
console.log(`   poll status: ${pollData.status}`)
if (pollData.account_address) console.log(`   account: ${pollData.account_address}`)

console.log(
  pollData.status === 'authorized' ? '\n✓ Full flow works end-to-end' : '\n✗ Flow did not complete',
)
