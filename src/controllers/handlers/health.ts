import { LiveResponseMessage } from '../../ports/server/types'

// GET /health/ready — readiness probe. Mirrors the previous `res.sendStatus(200)`.
export async function readyHandler() {
  return { status: 200, body: 'OK' }
}

// GET /health/startup — startup probe. Mirrors the previous `res.sendStatus(200)`.
export async function startupHandler() {
  return { status: 200, body: 'OK' }
}

// GET /health/live — liveness probe. Returns the current timestamp.
export async function liveHandler() {
  return { status: 200, body: { timestamp: Date.now() } satisfies LiveResponseMessage }
}
