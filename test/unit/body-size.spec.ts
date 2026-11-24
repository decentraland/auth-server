import { Router } from '@dcl/http-server'
import { bodySizeBoundFor } from '../../src/controllers/body-size'
import { MAX_BODY_SIZE_BYTES, MAX_REQUEST_MESSAGE_SIZE_BYTES } from '../../src/ports/server/constants'

describe('when getting the body bound of a request', () => {
  describe('and it creates a signing request', () => {
    it.each(['/requests', '/requests/', '/REQUESTS', '/Requests/'])('should give %s the bound of a signing request', pathname => {
      expect(bodySizeBoundFor('POST', pathname)).toBe(MAX_REQUEST_MESSAGE_SIZE_BYTES)
    })
  })

  describe('and it does not create a signing request', () => {
    it.each([
      ['POST', '/requests//'],
      ['POST', '/requests/x'],
      ['POST', '/v2/requests/x/outcome'],
      ['GET', '/requests'],
      ['OPTIONS', '/requests'],
      ['DELETE', '/accounts']
    ])('should give %s %s the default bound', (method, pathname) => {
      expect(bodySizeBoundFor(method, pathname)).toBe(MAX_BODY_SIZE_BYTES)
    })
  })

  // The bound has to follow the router: a path the router sends to `POST /requests` gets its bound,
  // and no other path does.
  describe('and it is compared with what the router matches', () => {
    let router: Router<object>

    beforeEach(() => {
      router = new Router<object>()
      router.post('/requests', async () => ({ status: 201 }))
    })

    it.each(['/requests', '/requests/', '/REQUESTS', '/Requests/', '/requests//', '/requests/x', '/requestsx', '/v2/requests'])(
      'should give %s the bound of a signing request exactly when the router matches it to POST /requests',
      pathname => {
        expect(bodySizeBoundFor('POST', pathname) === MAX_REQUEST_MESSAGE_SIZE_BYTES).toBe(router.match(pathname, 'POST').route)
      }
    )
  })
})
