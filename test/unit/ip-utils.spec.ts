import { Request } from 'express'
import { Socket } from 'socket.io'
import { extractClientIp, validateIpAddress } from '../../src/ports/server/ip-utils'

describe('when extracting client IP addresses', () => {
  describe('and the request is an HTTP request', () => {
    let mockRequest: Partial<Request>

    beforeEach(() => {
      mockRequest = {
        headers: {},
        connection: { remoteAddress: '192.168.1.100' } as any,
        socket: { remoteAddress: '192.168.1.200' } as any
      }
    })

    describe('and CloudFlare headers are present', () => {
      describe('and cf-connecting-ip header exists', () => {
        let cfConnectingIp: string

        beforeEach(() => {
          cfConnectingIp = '203.0.113.1'
          mockRequest.headers = {
            'cf-connecting-ip': cfConnectingIp,
            'x-forwarded-for': '203.0.113.2, 203.0.113.3',
            'x-real-ip': '203.0.113.4'
          }
          mockRequest.ip = '203.0.113.5'
        })

        it('should return the connecting IP with highest priority', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(cfConnectingIp)
        })
      })

      describe('and cf-connecting-ip header contains whitespace', () => {
        let cfConnectingIpWithWhitespace: string
        let expectedCleanIp: string

        beforeEach(() => {
          cfConnectingIpWithWhitespace = '  203.0.113.1  '
          expectedCleanIp = '203.0.113.1'
          mockRequest.headers = {
            'cf-connecting-ip': cfConnectingIpWithWhitespace
          }
        })

        it('should return the trimmed connecting IP', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(expectedCleanIp)
        })
      })
    })

    describe('and X-Forwarded-For headers are present', () => {
      describe('and cf-connecting-ip is not available', () => {
        let xForwardedForIp: string

        beforeEach(() => {
          xForwardedForIp = '203.0.113.1'
          mockRequest.headers = {
            'x-forwarded-for': `${xForwardedForIp}, 203.0.113.2`,
            'x-real-ip': '203.0.113.3'
          }
          mockRequest.ip = '203.0.113.4'
        })

        it('should return the first IP from header', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(xForwardedForIp)
        })
      })

      describe('and X-Forwarded-For contains a single IP', () => {
        let singleIp: string

        beforeEach(() => {
          singleIp = '203.0.113.1'
          mockRequest.headers = {
            'x-forwarded-for': singleIp
          }
        })

        it('should return the single IP from header', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(singleIp)
        })
      })

      describe('and X-Forwarded-For contains multiple IPs with whitespace', () => {
        let firstIpWithWhitespace: string
        let expectedFirstIp: string

        beforeEach(() => {
          firstIpWithWhitespace = ' 203.0.113.1 '
          expectedFirstIp = '203.0.113.1'
          mockRequest.headers = {
            'x-forwarded-for': `${firstIpWithWhitespace}, 203.0.113.2 , 203.0.113.3 `
          }
        })

        it('should return the first trimmed IP from header', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(expectedFirstIp)
        })
      })

      describe('and X-Forwarded-For starts with localhost IP', () => {
        beforeEach(() => {
          mockRequest.headers = {
            'x-forwarded-for': '127.0.0.1, 203.0.113.1'
          }
          // Override connection to be localhost so it uses the header
          mockRequest.connection = { remoteAddress: '127.0.0.1' } as any
          mockRequest.socket = { remoteAddress: '::1' } as any
        })

        it('should return "unknown" because first IP is localhost', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe('unknown')
        })
      })

      describe('and X-Forwarded-For starts with valid IP', () => {
        let validIp: string

        beforeEach(() => {
          validIp = '203.0.113.1'
          mockRequest.headers = {
            'x-forwarded-for': `${validIp}, 127.0.0.1`
          }
          // Override connection to be localhost so it uses the header
          mockRequest.connection = { remoteAddress: '127.0.0.1' } as any
          mockRequest.socket = { remoteAddress: '::1' } as any
        })

        it('should return the valid IP from header', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(validIp)
        })
      })
    })

    describe('and X-Real-IP header is present', () => {
      describe('and cf-connecting-ip and x-forwarded-for are not available', () => {
        let xRealIp: string

        beforeEach(() => {
          xRealIp = '203.0.113.1'
          mockRequest.headers = {
            'x-real-ip': xRealIp
          }
          mockRequest.ip = '203.0.113.2'
        })

        it('should return the X-Real-IP header value', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(xRealIp)
        })
      })
    })

    describe('and Express req.ip is available', () => {
      describe('and proxy headers are not available', () => {
        let reqIp: string

        beforeEach(() => {
          reqIp = '203.0.113.1'
          mockRequest.headers = {}
          mockRequest.ip = reqIp
        })

        it('should return the Express req.ip value', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(reqIp)
        })
      })
    })

    describe('and connection fallbacks are needed', () => {
      describe('and req.ip is not available', () => {
        let connectionRemoteAddress: string

        beforeEach(() => {
          connectionRemoteAddress = '192.168.1.100'
          mockRequest.headers = {}
          mockRequest.ip = undefined
          mockRequest.connection = { remoteAddress: connectionRemoteAddress } as any
        })

        it('should return the connection.remoteAddress value', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(connectionRemoteAddress)
        })
      })

      describe('and connection.remoteAddress is not available', () => {
        let socketRemoteAddress: string

        beforeEach(() => {
          socketRemoteAddress = '192.168.1.200'
          mockRequest = {
            headers: {},
            connection: {} as any,
            socket: { remoteAddress: socketRemoteAddress } as any
          }
        })

        it('should return the socket.remoteAddress value as last resort', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(socketRemoteAddress)
        })
      })
    })

    describe('and localhost filtering is applied', () => {
      describe('and only localhost IPs are available', () => {
        beforeEach(() => {
          mockRequest.headers = {}
          mockRequest.ip = '127.0.0.1'
          mockRequest.connection = { remoteAddress: '::1' } as any
          mockRequest.socket = { remoteAddress: '127.0.0.1' } as any
        })

        it('should return "unknown" when all sources are localhost', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe('unknown')
        })
      })
    })

    describe('and edge cases occur', () => {
      describe('and headers are undefined', () => {
        let expectedFallbackIp: string

        beforeEach(() => {
          expectedFallbackIp = '192.168.1.100'
          mockRequest.headers = {
            'cf-connecting-ip': undefined as any,
            'x-forwarded-for': undefined as any
          }
        })

        it('should fallback to connection.remoteAddress', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(expectedFallbackIp)
        })
      })

      describe('and headers are empty strings', () => {
        let expectedFallbackIp: string

        beforeEach(() => {
          expectedFallbackIp = '192.168.1.100'
          mockRequest.headers = {
            'cf-connecting-ip': '',
            'x-forwarded-for': '',
            'x-real-ip': ''
          }
        })

        it('should fallback to connection.remoteAddress', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe(expectedFallbackIp)
        })
      })

      describe('and no valid IPs are found anywhere', () => {
        beforeEach(() => {
          mockRequest = {
            headers: {},
            connection: {} as any,
            socket: {} as any
          }
        })

        it('should return "unknown"', () => {
          const result = extractClientIp(mockRequest as Request)

          expect(result).toBe('unknown')
        })
      })
    })
  })

  describe('and the request is a WebSocket connection', () => {
    let mockSocket: any

    beforeEach(() => {
      mockSocket = {
        handshake: {
          headers: {},
          address: undefined
        }
      }
    })

    describe('and cf-connecting-ip header is present', () => {
      let cfConnectingIp: string

      beforeEach(() => {
        cfConnectingIp = '203.0.113.1'
        mockSocket.handshake.headers = {
          'cf-connecting-ip': cfConnectingIp
        }
      })

      it('should extract IP from WebSocket CloudFlare header', () => {
        const result = extractClientIp(mockSocket as Socket)

        expect(result).toBe(cfConnectingIp)
      })
    })

    describe('and multiple headers are present', () => {
      let cfConnectingIp: string

      beforeEach(() => {
        cfConnectingIp = '203.0.113.1'
        mockSocket.handshake.headers = {
          'cf-connecting-ip': cfConnectingIp,
          'x-forwarded-for': '203.0.113.2',
          'x-real-ip': '203.0.113.3'
        }
        mockSocket.handshake.address = '203.0.113.4'
      })

      it('should follow same priority order as HTTP requests', () => {
        const result = extractClientIp(mockSocket as Socket)

        expect(result).toBe(cfConnectingIp)
      })
    })

    describe('and handshake.address is available', () => {
      let handshakeAddress: string

      beforeEach(() => {
        handshakeAddress = '203.0.113.1'
        mockSocket.handshake.address = handshakeAddress
      })

      it('should use handshake.address as fallback for WebSocket', () => {
        const result = extractClientIp(mockSocket as Socket)

        expect(result).toBe(handshakeAddress)
      })
    })

    describe('and handshake.address is localhost', () => {
      beforeEach(() => {
        mockSocket.handshake.address = '127.0.0.1'
      })

      it('should filter localhost IPs in WebSocket connections', () => {
        const result = extractClientIp(mockSocket as Socket)

        expect(result).toBe('unknown')
      })
    })
  })
})

describe('when validating IP addresses', () => {
  let originalIp: string
  let currentIp: string

  describe('and original IP is "unknown"', () => {
    beforeEach(() => {
      originalIp = 'unknown'
      currentIp = '203.0.113.1'
    })

    it('should return valid as true for first time setup scenarios', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.valid).toBe(true)
    })

    it('should not provide reason when validation succeeds for first time setup', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.reason).toBeUndefined()
    })

    it('should not provide metric reason when validation succeeds for first time setup', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.metricReason).toBeUndefined()
    })
  })

  describe('and IPs match exactly', () => {
    beforeEach(() => {
      originalIp = '203.0.113.1'
      currentIp = '203.0.113.1'
    })

    it('should return valid as true', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.valid).toBe(true)
    })

    it('should not provide reason', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.reason).toBeUndefined()
    })

    it('should not provide metric reason', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.metricReason).toBeUndefined()
    })
  })

  describe('and both IPs are "unknown"', () => {
    beforeEach(() => {
      originalIp = 'unknown'
      currentIp = 'unknown'
    })

    it('should allow access', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.valid).toBe(true)
    })
  })

  describe('and current IP is "unknown" but original is not', () => {
    beforeEach(() => {
      originalIp = '203.0.113.1'
      currentIp = 'unknown'
    })

    it('should return valid as false', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.valid).toBe(false)
    })

    it('should provide unable to verify IP message', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.reason).toBe('Unable to verify IP address')
    })

    it('should provide current_ip_unknown metric reason', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.metricReason).toBe('current_ip_unknown')
    })
  })

  describe('and IPs do not match', () => {
    beforeEach(() => {
      originalIp = '203.0.113.1'
      currentIp = '203.0.113.2'
    })

    it('should return valid as false', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.valid).toBe(false)
    })

    it('should provide detailed mismatch message', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.reason).toBe(
        'We detected a sign-in from a different network. Please connect using the same Wi-Fi or mobile network you used before and try again.'
      )
    })

    it('should provide ip_mismatch metric reason', () => {
      const result = validateIpAddress(originalIp, currentIp)

      expect(result.metricReason).toBe('ip_mismatch')
    })
  })

  describe('and edge cases are handled', () => {
    describe('and IPv6 addresses are used', () => {
      let ipv6Address: string

      beforeEach(() => {
        ipv6Address = '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
        originalIp = ipv6Address
        currentIp = ipv6Address
      })

      it('should handle IPv6 addresses correctly', () => {
        const result = validateIpAddress(originalIp, currentIp)

        expect(result.valid).toBe(true)
      })
    })

    describe('and IPv6 vs IPv4 mismatch occurs', () => {
      beforeEach(() => {
        originalIp = '203.0.113.1'
        currentIp = '2001:0db8:85a3::8a2e:0370:7334'
      })

      it('should detect mismatch between IPv4 and IPv6 addresses', () => {
        const result = validateIpAddress(originalIp, currentIp)

        expect(result.valid).toBe(false)
        expect(result.metricReason).toBe('ip_mismatch')
      })
    })
  })
})
