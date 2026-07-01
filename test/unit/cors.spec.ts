import { parseCorsOrigins } from '../../src/logic/cors'

describe('when parsing CORS origins', () => {
  describe('and an entry is an unanchored origin pattern', () => {
    let origins: RegExp[]

    beforeEach(() => {
      origins = parseCorsOrigins('https://play\\.decentraland\\.org')
    })

    it('should match the exact origin', () => {
      expect(origins[0].test('https://play.decentraland.org')).toBe(true)
    })

    it('should reject a suffix-bypass origin', () => {
      expect(origins[0].test('https://play.decentraland.org.evil.com')).toBe(false)
    })

    it('should reject a prefix-bypass origin', () => {
      expect(origins[0].test('https://evil.com?x=https://play.decentraland.org')).toBe(false)
    })
  })

  describe('and an entry is already anchored', () => {
    let origins: RegExp[]

    beforeEach(() => {
      origins = parseCorsOrigins('^http:\\/\\/localhost:[0-9]{1,10}$')
    })

    it('should preserve the regex semantics without double-anchoring', () => {
      expect(origins[0].test('http://localhost:8080')).toBe(true)
    })

    it('should still reject a suffix-bypass origin', () => {
      expect(origins[0].test('http://localhost:8080.evil.com')).toBe(false)
    })
  })

  describe('and there are multiple semicolon-separated entries with empty ones', () => {
    let origins: RegExp[]

    beforeEach(() => {
      origins = parseCorsOrigins('https://a\\.org;;https://b\\.org;')
    })

    it('should drop the empty entries', () => {
      expect(origins).toHaveLength(2)
    })

    it('should match each configured origin', () => {
      expect(origins.some(re => re.test('https://a.org'))).toBe(true)
      expect(origins.some(re => re.test('https://b.org'))).toBe(true)
    })

    it('should not turn an empty entry into an allow-all', () => {
      expect(origins.some(re => re.test('https://anything.com'))).toBe(false)
    })
  })
})
