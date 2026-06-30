import { Server as HttpServer } from 'http'
import { Lifecycle } from '@well-known-components/interfaces'
import { getUnderlyingServer } from '@dcl/http-server'
import { setupRouter } from './controllers/routes'
import { SOCKET_REMOTE_ADDRESS_HEADER } from './controllers/utils'
import { AppComponents, GlobalContext, TestComponents } from './types'

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components } = program
  const globalContext: GlobalContext = {
    components
  }

  // wire the HTTP router
  const router = await setupRouter(globalContext)
  // register routes middleware
  components.server.use(router.middleware())
  // register not implemented/method not allowed responses middleware
  components.server.use(router.allowedMethods())
  // set the context to be passed to the handlers
  components.server.setContext(globalContext)

  // start ports: http-server (begins listening), socket.io (attaches to the http-server), db, etc.
  await program.startComponents()

  // The native `Request` the http-server builds for handlers does not expose the underlying
  // socket, so stamp the connection's remote address onto a header before the http-server reads
  // the incoming message. `getClientIp` consults it as the lowest-priority fallback, preserving
  // the previous express behavior of falling back to `req.socket.remoteAddress`. `prependListener`
  // ensures this runs before the http-server's own `request` handler.
  const httpServer = await getUnderlyingServer<HttpServer>(components.server)
  httpServer.prependListener('request', (req, _res) => {
    // Always overwrite any client-supplied value so the fallback cannot be spoofed.
    if (req.socket.remoteAddress) {
      req.headers[SOCKET_REMOTE_ADDRESS_HEADER] = req.socket.remoteAddress
    } else {
      delete req.headers[SOCKET_REMOTE_ADDRESS_HEADER]
    }
  })
}
