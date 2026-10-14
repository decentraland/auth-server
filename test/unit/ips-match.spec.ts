import { expandIpv6, ipsMatch } from '../../src/controllers/utils'

describe('when matching IPs', () => {
  let storedIp: string
  let requestIp: string

  describe('and both are IPv4 addresses in the same /24', () => {
    beforeEach(() => {
      storedIp = '10.0.16.1'
      requestIp = '10.0.16.200'
    })

    it('should match', () => {
      expect(ipsMatch(storedIp, requestIp)).toBe(true)
    })
  })

  describe('and both are IPv6 addresses in the same /64', () => {
    beforeEach(() => {
      storedIp = '2001:db8:85a3:42::1a2b'
      requestIp = '2001:0db8:85a3:0042:9c1e:44ff:fe01:7'
    })

    it('should match', () => {
      expect(ipsMatch(storedIp, requestIp)).toBe(true)
    })
  })

  describe('and both are IPv6 addresses in different /64 prefixes', () => {
    beforeEach(() => {
      storedIp = '2001:db8:85a3:42::1'
      requestIp = '2001:db8:85a3:43::1'
    })

    it('should not match', () => {
      expect(ipsMatch(storedIp, requestIp)).toBe(false)
    })
  })

  describe('and one is IPv4 and the other is IPv6', () => {
    beforeEach(() => {
      storedIp = '2001:db8:85a3:42::1'
      requestIp = '203.0.113.7'
    })

    it('should not match', () => {
      expect(ipsMatch(storedIp, requestIp)).toBe(false)
    })
  })

  describe('and one is the IPv6-mapped form of the other IPv4', () => {
    beforeEach(() => {
      storedIp = '203.0.113.7'
      requestIp = '::ffff:203.0.113.7'
    })

    it('should match', () => {
      expect(ipsMatch(storedIp, requestIp)).toBe(true)
    })
  })
})

describe('when expanding an IPv6 address', () => {
  let ip: string

  describe('and the address uses :: compression', () => {
    beforeEach(() => {
      ip = '2001:db8::7'
    })

    it('should fill the compressed groups with zeros', () => {
      expect(expandIpv6(ip)).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 7])
    })
  })

  describe('and the address ends in an embedded IPv4', () => {
    beforeEach(() => {
      ip = '64:ff9b::192.0.2.33'
    })

    it('should convert the IPv4 tail into two hextets', () => {
      expect(expandIpv6(ip)).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0xc000, 0x0221])
    })
  })

  describe('and the address has a zone id', () => {
    beforeEach(() => {
      ip = 'fe80::1%en0'
    })

    it('should ignore the zone id', () => {
      expect(expandIpv6(ip)).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1])
    })
  })

  describe('and the value is not an IPv6 address', () => {
    beforeEach(() => {
      ip = '203.0.113.7'
    })

    it('should return null', () => {
      expect(expandIpv6(ip)).toBeNull()
    })
  })
})
