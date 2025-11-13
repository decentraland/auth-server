# Testing Token-Based Authentication Flow

This guide explains how to test the new deep link token authentication feature.

## Prerequisites

1. **Auth Server** running locally
2. **Auth UI** running locally
3. A wallet (MetaMask, WalletConnect, etc.)

## Quick Start

### 1. Start Auth Server

```bash
cd auth-server
npm run start:dev
# Server should be running on http://localhost:5001
```

### 2. Start Auth UI

```bash
cd auth
npm start
# UI should be running on http://localhost:5173
```

### 3. Generate Test Request

```bash
cd auth-server
npm run test:token-flow
```

This will:

- Generate an ephemeral wallet
- Create a request with `dcl_personal_sign_with_token` method
- Print a URL to open in your browser

### 4. Test in Browser

1. Open the generated URL in your browser
2. Connect your wallet
3. Observe the UI:
   - ✅ No verification code should be shown
   - ✅ Buttons should say "Cancel" and "Sign In"
4. Click "Sign In" and approve in your wallet
5. After signing:
   - ✅ Should show "Sign In Successful"
   - ✅ Should show "Return to Explorer" button
6. Click "Return to Explorer"
   - ✅ Deep link should open: `decentraland://?sign_in&token=...`

## What's Different from Standard Flow?

### Standard Flow (`dcl_personal_sign`)

- Shows verification code (e.g., "67")
- User must manually verify code matches client
- Buttons: "No, it doesn't" / "Yes, they are the same"
- Completes immediately after signing

### Token Flow (`dcl_personal_sign_with_token`)

- No verification code shown
- Streamlined confirmation message
- Buttons: "Cancel" / "Sign In"
- Shows "Return to Explorer" button with deep link
- Desktop client redeems token

## API Endpoints Used

### Create Request

```bash
POST /requests
{
  "method": "dcl_personal_sign_with_token",
  "params": ["<ephemeral_message>"]
}
```

### Check Request Status

```bash
GET /v2/requests/:requestId
```

### Send Outcome (Web UI)

```bash
POST /v2/requests/:requestId/outcome
{
  "sender": "0x...",
  "result": "signature"
}

# Response includes token & deepLink:
{
  "token": "uuid-token",
  "deepLink": "decentraland://?sign_in&token=uuid-token"
}
```

### Redeem Token (Desktop Client)

```bash
POST /requests/:requestId/token
{
  "token": "uuid-token"
}

# Response includes auth chain:
{
  "sender": "0x...",
  "result": "signature"
}
```

## Testing Desktop Client Integration

To fully test the flow with a desktop client:

1. Desktop client creates request with `dcl_personal_sign_with_token`
2. Desktop client opens browser with the URL
3. User completes sign-in in browser
4. Browser shows deep link button
5. User clicks button → Deep link opens
6. Desktop client receives deep link via OS
7. Desktop client extracts token
8. Desktop client calls `/requests/:requestId/token` to redeem
9. Server returns auth chain
10. Desktop client completes sign-in

## Environment Variables

```bash
# Override auth server URL
AUTH_SERVER_URL=http://localhost:5001 npm run test:token-flow

# Override UI URL
UI_URL=http://localhost:5173 npm run test:token-flow
```

## Troubleshooting

### Request Not Found

- Make sure auth server is running
- Check that the requestId is correct
- Requests expire after a few minutes

### Deep Link Doesn't Open

- This is expected in browser testing
- Desktop client must register `decentraland://` protocol handler
- You should see the deep link URL in the button/console

### Token Expired

- Tokens expire in 5 minutes
- Create a new request with `npm run test:token-flow`

### Wrong Method

- Make sure request was created with `dcl_personal_sign_with_token`
- Standard `dcl_personal_sign` will show verification code flow

## Monitoring

Watch request changes in real-time:

```bash
# Requires jq
watch -n 1 'curl -s http://localhost:5001/v2/requests/<requestId> | jq'
```

## Security Notes

- Tokens are single-use
- Tokens expire in 5 minutes
- Deep links only work on same machine (OS-level routing)
- Web UI never redeems tokens (only desktop client does)
