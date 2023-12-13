# Auth Server

[![Coverage Status](https://coveralls.io/repos/github/decentraland/auth-server/badge.svg?branch=main)](https://coveralls.io/github/decentraland/auth-server?branch=main)

Server in charge of communication between the decentraland desktop client and the auth dapp on the browser.

Allows the client to generate signatures and send transactions using wallets installed on the browser using web sockets.

## Usage

This section will explain the ways in which the service can be used.

Use the web socket library of your choice to connect to this server. This one currently uses [Socket.IO](https://socket.io/) which can also be used in a JS client to connect.

All of the following require the client to have an open connection with the server to work. This means that the client could open the connection once at start and keep it alive till the application is closed or open it when starting a request and closing it when it ends.

### Signatures

The client can use this service to generate signatures from a wallet in the browser with a couple of socket messages.

1. From the <b>Client</b>, send a message to the server to initialize a signature request.

```js
socket.emit('message', {
  type: 'request',
  payload: {
    type: 'signature'
    data: 'data to be signed on the browser'
  }
})
```

2. The <b>Server</b> will respond to the <b>Client</b> with a message containing a `requestId`

```js
{
  type: 'request-response',
  payload: {
    requestId: 'some request id (a random uuid)'
  }
}
```

3. The <b>Auth dApp</b> can be opened on the <b>Browser</b> on the following url: https://decentraland.org/auth/requests/:requestId

4. The <b>Browser</b> sends a message to the <b>Server</b> to recover the request sent by the <b>Client</b>.

```js
socket.emit('message', {
  type: 'recover',
  payload: {
    requestId: 'some request id (a random uuid) - obtained from the URL'
  }
})
```

5. The <b>Server</b> responds with a message to the <b>Browser</b> containing the request from the <b>Client</b>. With its content, the <b>Auth dApp</b> knows that the request is for a signature.

```js
{
  type: 'recover-response',
  payload: {
    requestId: 'some request id (a random uuid)',
    type: 'signature',
    data: 'data to be signed on the browser'
  }
}
```

6. Using the <b>User's Wallet</b>, sign the data from the request message and submit it to the <b>Server</b>.

```js
socket.emit('message', {
  type: 'submit-signature',
  payload: {
    requestId: 'some request id (a random uuid)'
    signer: '0x... the address of the wallet that signed the message',
    signature: '0x.. the newly generated signature'
  }
})
```

7. The <b>server</b> sends the message back to the <b>Client</b>, finalizing the operation.

```js
{
  type: 'submit-signature-response',
  payload: {
    requestId: 'some request id (a random uuid)'
    signer: '0x... the address of the wallet that signed the message',
    signature: '0x.. the newly generated signature'
  }
}
```

### Authentication Flow

The Client can use the Signature request to generate and Auth Identity and store it locally.

For this example I'll be using `ethers v6` and `@dcl/crypto`

1. Generate an ephemeral account:

```js
const ephemeralAccount = ethers.Wallet.createRandom()
```

2. Generate the Date in which the identity should expire.

```js
const expiration = new Date(Date.now() + 24 * 60 * 60 * 1000) // 1 day in the future as an example.
```

3. Generate the ephemeral message that has to be signed.

```js
const ephemeralMessage = Authenticator.getEphemeralMessage(ephemeralAccount.address, expiration)
```

4. Follow the steps decribed on the [Signatures](#signatures), initializing the flow with the following message:

```js
socket.emit('message', {
  type: 'request',
  payload: {
    type: 'signature'
    data: ephemeralMessage
  }
})
```

5. With the `signer` and `signature` received at the end of the flow, create an Auth Identity.

```js
{
  expiration, // Generated on step 2.
  ephemeralIdentity: {
    address: ephemeralAccount.address, // Generated on step 1.
    privateKey: ephemeralAccount.privateKey, // Generated on step 1.
    publicKey: ephemeralAccount.publicKey, // Generated on step 1.
  },
  authChain: [
    {
      type: AuthLinkType.SIGNER,
      payload: signer, // Obtained from the server.
      signature: ""
    },
    {
      type: signature.length === 132 ? AuthLinkType.ECDSA_PERSONAL_EPHEMERAL : AuthLinkType.ECDSA_EIP_1654_EPHEMERAL, // Obtained from the server.
      payload: ephemeralMessage, // Generated on step 3.
      signature: signature, // Obtained from the server.
    },
  ],
}
```

6. With the Auth Identity ready and stored on the client, the user can be considered as logged in, so there is no need to execute the flow again unless disconnecting first.

.
