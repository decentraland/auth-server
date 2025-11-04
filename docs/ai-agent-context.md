# AI Agent Context

**Service Purpose:** Facilitates secure communication between the Decentraland desktop client and browser-based authentication dApp. Enables the desktop client to execute wallet operations (transactions, signatures) using the user's browser wallet through a request-response relay pattern.

**Key Capabilities:**

- Creates and manages request objects that encapsulate wallet method calls (eth_sendTransaction, personal_sign, dcl_personal_sign)
- Generates unique request IDs with expiration timestamps and visual verification codes
- Relays wallet method execution results from browser dApp back to desktop client
- Manages request lifecycle: creation, expiration, consumption, and cleanup on socket disconnect
- Supports both WebSocket (Socket.IO) and HTTP polling communication patterns
- Handles authentication flow with ephemeral wallet generation for identity creation

**Communication Pattern:**
- Real-time bidirectional via Socket.IO WebSockets (default)
- HTTP polling alternative (POST /requests, GET /requests/:id)
- Request-response relay pattern between desktop client ↔ auth server ↔ browser dApp

**Technology Stack:**

- Runtime: Node.js
- Language: TypeScript 5.x
- HTTP Framework: Express with @well-known-components/http-server
- WebSocket: Socket.IO
- Component Architecture: @well-known-components (logger, metrics, http-server, env-config-provider)

**External Dependencies:**

- Databases: PostgreSQL (request storage and lifecycle management)
- Crypto: @dcl/crypto, ethers (signature validation, ephemeral wallet operations)
- Authentication: Ethereum wallet integration (browser-based)

**Key Request Lifecycle:**

1. Desktop client creates request with wallet method → receives requestId, expiration, code
2. Request stored in database with expiration timestamp
3. Browser dApp polls/connects to retrieve pending requests
4. User executes request in browser wallet
5. Result relayed back through auth server to desktop client
6. Request marked as consumed or expired/cleaned up

**Project Structure:**

- `src/ports/`: Database adapters, external service interfaces
- `src/adapters/`: Database implementations, Socket.IO handlers
- `src/controllers/`: HTTP routes and handlers for request management
- `src/migrations/`: PostgreSQL schema migrations
```
