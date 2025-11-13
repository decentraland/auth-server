/**
 * Test script to create a request with dcl_personal_sign_with_token method
 *
 * Usage:
 *   npm run test:token-flow
 * Or:
 *   npx tsx test-token-flow.ts
 */

import { ethers } from 'ethers'
import { Authenticator } from '@dcl/crypto'

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://localhost:8080'
const UI_URL = process.env.UI_URL || 'http://localhost:5173'

async function createTokenRequest() {
  console.log('🚀 Creating test request for token-based authentication flow...\n')

  // 1. Generate an ephemeral wallet
  console.log('1️⃣  Generating ephemeral wallet...')
  const ephemeralWallet = ethers.Wallet.createRandom()
  console.log(`   ✅ Ephemeral address: ${ephemeralWallet.address}`)
  console.log(`   🔑 Private key: ${ephemeralWallet.privateKey}\n`)

  // 2. Set expiration (1 day from now)
  const expiration = new Date(Date.now() + 24 * 60 * 60 * 1000)
  console.log(`2️⃣  Setting expiration: ${expiration.toISOString()}\n`)

  // 3. Generate ephemeral message
  console.log('3️⃣  Generating ephemeral message...')
  const ephemeralMessage = Authenticator.getEphemeralMessage(ephemeralWallet.address, expiration)
  console.log(`   ✅ Message:\n   ${ephemeralMessage.substring(0, 100)}...\n`)

  // 4. Create request on auth server
  console.log(`4️⃣  Creating request on auth server: ${AUTH_SERVER_URL}`)
  const response = await fetch(`${AUTH_SERVER_URL}/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      method: 'dcl_personal_sign_with_token',
      params: [ephemeralMessage]
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to create request: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  const { requestId, expiration: requestExpiration } = data

  console.log('   ✅ Request created successfully!\n')
  console.log('━'.repeat(60))
  console.log('📋 REQUEST DETAILS')
  console.log('━'.repeat(60))
  console.log(`Request ID:    ${requestId}`)
  console.log(`Expires:       ${requestExpiration}`)
  console.log('━'.repeat(60))
  console.log()

  // 5. Generate UI URL
  const uiUrl = `${UI_URL}/auth/requests/${requestId}`
  console.log('🌐 TEST URL')
  console.log('━'.repeat(60))
  console.log(uiUrl)
  console.log('━'.repeat(60))
  console.log()

  // 6. Show useful commands
  console.log('🔍 USEFUL COMMANDS')
  console.log('━'.repeat(60))
  console.log('Check request status:')
  console.log(`  curl ${AUTH_SERVER_URL}/v2/requests/${requestId}`)
  console.log('━'.repeat(60))
  console.log()

  // 7. Show test flow
  console.log('💡 TEST FLOW')
  console.log('━'.repeat(60))
  console.log('1. ✅ Make sure auth-server is running on', AUTH_SERVER_URL)
  console.log('2. ✅ Make sure UI is running on', UI_URL)
  console.log('3. 🌐 Open the URL above in your browser')
  console.log('4. 🔗 Connect a wallet (MetaMask, WalletConnect, etc.)')
  console.log('5. ✍️  Sign the message when prompted')
  console.log('6. 🎉 You should see "Sign In Successful" page')
  console.log('7. 🔗 Click "Return to Explorer" button')
  console.log('8. 🔍 Check that deep link opens: decentraland://?sign_in&token=...')
  console.log('━'.repeat(60))
  console.log()

  return {
    requestId,
    ephemeralAddress: ephemeralWallet.address,
    ephemeralPrivateKey: ephemeralWallet.privateKey,
    ephemeralMessage,
    uiUrl,
    expiration
  }
}

// Run the script
createTokenRequest()
  .then(() => {
    console.log('✅ Test setup complete!\n')
    process.exit(0)
  })
  .catch(error => {
    console.error('\n❌ ERROR:', error.message)
    console.error('\nMake sure:')
    console.error('  - Auth server is running')
    console.error('  - AUTH_SERVER_URL is correct')
    console.error('\nTry:')
    console.error('  cd auth-server && npm start')
    process.exit(1)
  })
