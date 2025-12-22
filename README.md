# Auth Server

[![Coverage Status](https://coveralls.io/repos/github/decentraland/auth-server/badge.svg?branch=main)](https://coveralls.io/github/decentraland/auth-server?branch=main)

This server facilitates communication between the Decentraland desktop client and the auth dapp on the browser. It allows the desktop client to execute wallet methods (`eth_sendTransaction`, `personal_sign`, etc.) using the wallet the user has on their browser by leveraging the auth dapp.

## Table of Contents

- [Features](#features)
- [Dependencies & Related Services](#dependencies--related-services)
- [API Documentation](#api-documentation)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Running the Service](#running-the-service)
- [Testing](#testing)

## Features

- **Authentication Request Management**: Creates, stores, and manages authentication requests with automatic expiration (default: 5 minutes).
- **WebSocket Real-Time Communication**: Provides Socket.IO-based real-time communication for instant request/response handling between clients and the auth dapp.
- **HTTP Polling Support**: Offers REST endpoints as an alternative to WebSocket for environments where WebSocket is not available.
- **Identity Management**: Supports temporary identity creation and retrieval for auto-login flows.
- **Signature Validation**: Validates Ethereum signatures using `@dcl/crypto` Authenticator to ensure requests are authorized.
- **Verification Codes**: Generates random verification codes (0-99) for visual confirmation between client and auth dapp.

## Dependencies & Related Services

This service interacts with the following services:

- **[Auth dApp](https://github.com/decentraland/auth)**: The browser-based application that executes wallet methods on behalf of the user using their connected wallet.
- **[Decentraland Desktop Client](https://github.com/decentraland/explorer-desktop-launcher)**: The desktop application that initiates authentication requests.

External dependencies:

- **@dcl/crypto**: For Ethereum signature validation
- **@dcl/schemas**: For Decentraland schema types and validation
- **Socket.IO**: For WebSocket real-time communication

## API Documentation

The API is fully documented using the [OpenAPI standard](https://swagger.io/specification/). Its schema is located at [docs/openapi.yaml](docs/openapi.yaml).

## Getting Started

### Prerequisites

Before running this service, ensure you have the following installed:

- **Node.js**: Version 22.x or higher (LTS recommended)
- **Yarn**: Version 1.22.x or higher
- **Docker**: For containerized deployment (optional, for integration testing)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/decentraland/auth-server.git
cd auth-server
```

2. Install dependencies:

```bash
yarn install
```

3. Build the project:

```bash
yarn build
```

### Configuration

The service uses environment variables for configuration.
Create a `.env` file in the root directory containing the environment variables for the service to run.
Use the `.env.default` variables as an example.

### Running the Service

#### Running in development mode

To run the service in development mode:

```bash
yarn start:dev
```

#### Running in production mode

To run the compiled service:

```bash
yarn start
```

## Testing

This service includes comprehensive test coverage with both unit and integration tests.

### Running Tests

Run all tests with coverage:

```bash
yarn test
```

Run tests in watch mode:

```bash
yarn test:watch
```

Run only unit tests:

```bash
yarn test test/unit
```

Run only integration tests:

```bash
yarn test:integration
```

### Test Structure

- **Unit Tests** (`test/unit/`): Test individual components and functions in isolation
- **Integration Tests** (`test/integration/`): Test the complete request/response cycle

For detailed testing guidelines and standards, refer to our [Testing Standards](https://github.com/decentraland/docs/tree/main/development-standards/testing-standards) documentation.

## Working with authentication and blockchain requests

To understand more about how the server works with this requests, see [docs/requests.md](docs/requests.md).

## AI Agent Context

For detailed AI Agent context, see [docs/ai-agent-context.md](docs/ai-agent-context.md).
