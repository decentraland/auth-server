import { getSocketTrustedClientIp, getTrustedClientIp } from '../../src/controllers/utils'

const CLOUDFLARE_EDGE = '162.158.10.20'
const CLOUDFLARE_EDGE_V6 = '2a06:98c0:3600::103'

const headersOf = (values: Record<string, string>) => new Headers(values)

describe('getTrustedClientIp', () => {
  describe('when the request reached the load balancer through Cloudflare', () => {
    it("should use Cloudflare's view of the client", () => {
      expect(
        getTrustedClientIp(headersOf({ 'x-forwarded-for': `203.0.113.7, ${CLOUDFLARE_EDGE}`, 'cf-connecting-ip': '203.0.113.7' }))
      ).toBe('203.0.113.7')
    })

    it('should recognise an IPv6 Cloudflare edge too', () => {
      expect(getTrustedClientIp(headersOf({ 'x-forwarded-for': CLOUDFLARE_EDGE_V6, 'cf-connecting-ip': '203.0.113.7' }))).toBe(
        '203.0.113.7'
      )
    })

    it('should ignore whatever the client prepended to X-Forwarded-For', () => {
      expect(
        getTrustedClientIp(headersOf({ 'x-forwarded-for': `1.1.1.1, 2.2.2.2, ${CLOUDFLARE_EDGE}`, 'cf-connecting-ip': '203.0.113.7' }))
      ).toBe('203.0.113.7')
    })

    describe('and Cloudflare did not say who the client is', () => {
      it('should key on the edge that connected rather than leave the caller unlimited', () => {
        expect(getTrustedClientIp(headersOf({ 'x-forwarded-for': CLOUDFLARE_EDGE }))).toBe(CLOUDFLARE_EDGE)
      })
    })
  })

  describe('when the request reached the load balancer directly, around Cloudflare', () => {
    it('should key on the address that connected, not on the Cloudflare header it sent', () => {
      expect(getTrustedClientIp(headersOf({ 'x-forwarded-for': '198.51.100.77', 'cf-connecting-ip': '10.9.8.7' }))).toBe('198.51.100.77')
    })

    it('should give the same key however often the client rotates that header', () => {
      const keys = ['10.0.0.1', '10.0.0.2', '10.0.0.3'].map(spoofed =>
        getTrustedClientIp(headersOf({ 'x-forwarded-for': `${CLOUDFLARE_EDGE}, 198.51.100.77`, 'cf-connecting-ip': spoofed }))
      )

      expect(new Set(keys)).toEqual(new Set(['198.51.100.77']))
    })

    it('should not be fooled by a Cloudflare address the client placed earlier in the chain', () => {
      expect(
        getTrustedClientIp(headersOf({ 'x-forwarded-for': `${CLOUDFLARE_EDGE}, 198.51.100.77`, 'cf-connecting-ip': '10.9.8.7' }))
      ).toBe('198.51.100.77')
    })
  })

  describe('when nothing sits in front of the process', () => {
    it('should vouch for no one, so every client is not counted as one', () => {
      expect(getTrustedClientIp(headersOf({ 'cf-connecting-ip': '203.0.113.7', 'x-real-ip': '203.0.113.8' }))).toBeUndefined()
    })
  })

  describe('when the client address is IPv6', () => {
    it('should key it by its /64, so one host cannot be a new client on every request', () => {
      const a = getTrustedClientIp(headersOf({ 'x-forwarded-for': '2001:db8:abcd:12:1::1' }))
      const b = getTrustedClientIp(headersOf({ 'x-forwarded-for': '2001:db8:abcd:12:ffff:ffff:ffff:ffff' }))

      expect(a).toBe('2001:db8:abcd:12::/64')
      expect(b).toBe(a)
    })

    it('should expand a compressed address before taking its /64', () => {
      expect(getTrustedClientIp(headersOf({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8:0:0::/64')
    })

    it('should tell apart two different /64s', () => {
      expect(getTrustedClientIp(headersOf({ 'x-forwarded-for': '2001:db8:abcd:12::1' }))).not.toBe(
        getTrustedClientIp(headersOf({ 'x-forwarded-for': '2001:db8:abcd:13::1' }))
      )
    })
  })

  describe('when the connecting hop is an IPv4-mapped address', () => {
    it('should read it as the IPv4 address it is', () => {
      expect(getTrustedClientIp(headersOf({ 'x-forwarded-for': '::ffff:198.51.100.4' }))).toBe('198.51.100.4')
    })

    it('should read it the same way in uppercase, rather than folding every such client into one key', () => {
      expect(getTrustedClientIp(headersOf({ 'x-forwarded-for': '::FFFF:198.51.100.4' }))).toBe('198.51.100.4')
    })
  })

  describe('when the connecting hop is not an address at all', () => {
    it('should key on it as given, so nothing escapes the limit by being unparseable', () => {
      expect(getTrustedClientIp(headersOf({ 'x-forwarded-for': 'unknown' }))).toBe('unknown')
    })
  })
})

describe('getSocketTrustedClientIp', () => {
  describe('when the handshake came through Cloudflare', () => {
    it('should resolve the client the same way the HTTP path does', () => {
      expect(getSocketTrustedClientIp({ headers: { 'x-forwarded-for': CLOUDFLARE_EDGE, 'cf-connecting-ip': '203.0.113.7' } })).toBe(
        '203.0.113.7'
      )
    })
  })

  describe('when a header arrives repeated', () => {
    it('should take the last hop across all of its values', () => {
      expect(getSocketTrustedClientIp({ headers: { 'x-forwarded-for': ['203.0.113.9', '198.51.100.4'] } })).toBe('198.51.100.4')
    })
  })

  describe('when the handshake reached the process directly', () => {
    it('should vouch for no one', () => {
      expect(getSocketTrustedClientIp({ headers: { 'cf-connecting-ip': '203.0.113.7' } })).toBeUndefined()
    })
  })
})
