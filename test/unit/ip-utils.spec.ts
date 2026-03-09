import { createIpUtilsComponent } from '../../src/logic/ip'
import { IpHeaders } from '../../src/logic/ip.types'
import { AppComponents, IIpUtilsComponent } from '../../src/types/components'

describe('when using ip utility functions', () => {
  let ipUtils: IIpUtilsComponent

  beforeEach(async () => {
    const logs = {
      getLogger: jest.fn(() => ({
        log: jest.fn(),
        error: jest.fn()
      }))
    } as unknown as AppComponents['logs']
    ipUtils = await createIpUtilsComponent({ logs })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  describe('and normalizing ip values', () => {
    describe('when the ip is an ipv6-mapped ipv4 value', () => {
      let inputIp: string
      let normalizedIp: string

      beforeEach(() => {
        inputIp = '::ffff:192.168.0.1'
        normalizedIp = ipUtils.normalizeIp(inputIp)
      })

      it('should strip the ipv6 mapped prefix', () => {
        expect(normalizedIp).toBe('192.168.0.1')
      })
    })

    describe('when the ip has leading and trailing spaces', () => {
      let inputIp: string
      let normalizedIp: string

      beforeEach(() => {
        inputIp = ' 192.168.0.1 '
        normalizedIp = ipUtils.normalizeIp(inputIp)
      })

      it('should return the trimmed ip value', () => {
        expect(normalizedIp).toBe('192.168.0.1')
      })
    })
  })

  describe('and getting the client ip', () => {
    describe('when true-client-ip is present', () => {
      let headers: IpHeaders
      let clientIp: string

      beforeEach(() => {
        headers = {
          'true-client-ip': '1.1.1.1',
          'x-real-ip': '2.2.2.2',
          'cf-connecting-ip': '3.3.3.3',
          'x-forwarded-for': '4.4.4.4'
        }
        clientIp = ipUtils.getClientIp({ headers })
      })

      it('should prioritize true-client-ip over other headers', () => {
        expect(clientIp).toBe('1.1.1.1')
      })
    })

    describe('when true-client-ip is missing and x-real-ip is present', () => {
      let headers: IpHeaders
      let clientIp: string

      beforeEach(() => {
        headers = {
          'x-real-ip': '2.2.2.2',
          'cf-connecting-ip': '3.3.3.3',
          'x-forwarded-for': '4.4.4.4'
        }
        clientIp = ipUtils.getClientIp({ headers })
      })

      it('should return x-real-ip', () => {
        expect(clientIp).toBe('2.2.2.2')
      })
    })

    describe('when true-client-ip and x-real-ip are missing and cf-connecting-ip is present', () => {
      let headers: IpHeaders
      let clientIp: string

      beforeEach(() => {
        headers = {
          'cf-connecting-ip': '3.3.3.3',
          'x-forwarded-for': '4.4.4.4'
        }
        clientIp = ipUtils.getClientIp({ headers })
      })

      it('should return cf-connecting-ip', () => {
        expect(clientIp).toBe('3.3.3.3')
      })
    })

    describe('when only x-forwarded-for is present', () => {
      let headers: IpHeaders
      let clientIp: string

      beforeEach(() => {
        headers = {
          'x-forwarded-for': '5.5.5.5, 6.6.6.6'
        }
        clientIp = ipUtils.getClientIp({ headers })
      })

      it('should return the first forwarded ip', () => {
        expect(clientIp).toBe('5.5.5.5')
      })
    })

    describe('when header values are arrays', () => {
      let headers: IpHeaders
      let clientIp: string

      beforeEach(() => {
        headers = {
          'true-client-ip': ['::ffff:7.7.7.7']
        }
        clientIp = ipUtils.getClientIp({ headers })
      })

      it('should normalize and use the first array value', () => {
        expect(clientIp).toBe('7.7.7.7')
      })
    })

    describe('when no header ip exists and request ip exists', () => {
      let headers: IpHeaders
      let requestIp: string
      let clientIp: string

      beforeEach(() => {
        headers = {}
        requestIp = '8.8.8.8'
        clientIp = ipUtils.getClientIp({ headers, ip: requestIp })
      })

      it('should fall back to request ip', () => {
        expect(clientIp).toBe('8.8.8.8')
      })
    })

    describe('when no header ip exists and remote address exists', () => {
      let headers: IpHeaders
      let remoteAddress: string
      let clientIp: string

      beforeEach(() => {
        headers = {}
        remoteAddress = '9.9.9.9'
        clientIp = ipUtils.getClientIp({ headers, remoteAddress })
      })

      it('should fall back to remote address', () => {
        expect(clientIp).toBe('9.9.9.9')
      })
    })

    describe('when no ip source exists', () => {
      let headers: IpHeaders
      let clientIp: string

      beforeEach(() => {
        headers = {}
        clientIp = ipUtils.getClientIp({ headers })
      })

      it('should return unknown', () => {
        expect(clientIp).toBe('unknown')
      })
    })
  })

  describe('and comparing ips', () => {
    describe('when both values are equal', () => {
      let firstIp: string
      let secondIp: string
      let result: boolean

      beforeEach(() => {
        firstIp = '1.1.1.1'
        secondIp = '1.1.1.1'
        result = ipUtils.ipsMatch(firstIp, secondIp)
      })

      it('should return true', () => {
        expect(result).toBe(true)
      })
    })

    describe('when one value is ipv6-mapped and the other is ipv4', () => {
      let firstIp: string
      let secondIp: string
      let result: boolean

      beforeEach(() => {
        firstIp = '::ffff:10.0.16.1'
        secondIp = '10.0.16.1'
        result = ipUtils.ipsMatch(firstIp, secondIp)
      })

      it('should return true after normalization', () => {
        expect(result).toBe(true)
      })
    })

    describe('when both ipv4 values share the same /24 subnet', () => {
      let firstIp: string
      let secondIp: string
      let result: boolean

      beforeEach(() => {
        firstIp = '10.0.16.1'
        secondIp = '10.0.16.200'
        result = ipUtils.ipsMatch(firstIp, secondIp)
      })

      it('should return true', () => {
        expect(result).toBe(true)
      })
    })

    describe('when both ipv4 values are in different subnets', () => {
      let firstIp: string
      let secondIp: string
      let result: boolean

      beforeEach(() => {
        firstIp = '10.0.16.1'
        secondIp = '10.0.17.1'
        result = ipUtils.ipsMatch(firstIp, secondIp)
      })

      it('should return false', () => {
        expect(result).toBe(false)
      })
    })

    describe('when the first ip is unknown', () => {
      let firstIp: string
      let secondIp: string
      let result: boolean

      beforeEach(() => {
        firstIp = 'unknown'
        secondIp = '10.0.16.1'
        result = ipUtils.ipsMatch(firstIp, secondIp)
      })

      it('should return false', () => {
        expect(result).toBe(false)
      })
    })

    describe('when the first ip is empty', () => {
      let firstIp: string
      let secondIp: string
      let result: boolean

      beforeEach(() => {
        firstIp = ''
        secondIp = '10.0.16.1'
        result = ipUtils.ipsMatch(firstIp, secondIp)
      })

      it('should return false', () => {
        expect(result).toBe(false)
      })
    })
  })

  describe('and formatting ip headers', () => {
    let headers: IpHeaders
    let formattedHeaders: string

    beforeEach(() => {
      headers = {
        'true-client-ip': '1.1.1.1',
        'x-real-ip': '2.2.2.2',
        'cf-connecting-ip': '3.3.3.3',
        'x-forwarded-for': '4.4.4.4'
      }
      formattedHeaders = ipUtils.formatIpHeaders(headers)
    })

    it('should include all expected headers in the output', () => {
      expect(formattedHeaders).toBe('true-client-ip=1.1.1.1, x-real-ip=2.2.2.2, cf-connecting-ip=3.3.3.3, x-forwarded-for=4.4.4.4')
    })
  })
})
