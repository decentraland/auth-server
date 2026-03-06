import { validateCheckpointRequest } from '../../src/ports/server/validations'

describe('when validating a valid checkpoint request', () => {
  it('should accept a reached action with wallet identifier', () => {
    const result = validateCheckpointRequest({
      checkpointId: 3,
      userIdentifier: '0xabc123def',
      identifierType: 'wallet',
      action: 'reached'
    })
    expect(result).toMatchObject({ checkpointId: 3, identifierType: 'wallet', action: 'reached' })
  })

  it('should accept a completed action with email identifier', () => {
    const result = validateCheckpointRequest({
      checkpointId: 3,
      userIdentifier: 'user@test.com',
      identifierType: 'email',
      action: 'completed'
    })
    expect(result).toMatchObject({ action: 'completed', identifierType: 'email' })
  })

  it('should accept all checkpoint ids from 1 to 7', () => {
    for (let id = 1; id <= 7; id++) {
      expect(() =>
        validateCheckpointRequest({ checkpointId: id, userIdentifier: 'x', identifierType: 'wallet', action: 'reached' })
      ).not.toThrow()
    }
  })

  it('should accept an optional email field with valid format', () => {
    const result = validateCheckpointRequest({
      checkpointId: 3,
      userIdentifier: '0xabc',
      identifierType: 'wallet',
      action: 'reached',
      email: 'user@decentraland.org'
    })
    expect(result.email).toBe('user@decentraland.org')
  })

  it('should accept an optional source field', () => {
    const result = validateCheckpointRequest({
      checkpointId: 1,
      userIdentifier: 'anon',
      identifierType: 'wallet',
      action: 'reached',
      source: 'auth'
    })
    expect(result.source).toBe('auth')
  })

  it('should accept an optional metadata object', () => {
    const result = validateCheckpointRequest({
      checkpointId: 2,
      userIdentifier: 'user@test.com',
      identifierType: 'email',
      action: 'reached',
      metadata: { loginMethod: 'metamask', platform: 'desktop' }
    })
    expect(result.metadata).toEqual({ loginMethod: 'metamask', platform: 'desktop' })
  })
})

describe('when validating an invalid checkpoint request', () => {
  it('should reject checkpointId = 0', () => {
    expect(() => validateCheckpointRequest({ checkpointId: 0, userIdentifier: 'x', identifierType: 'wallet', action: 'reached' })).toThrow()
  })

  it('should reject checkpointId = 8', () => {
    expect(() => validateCheckpointRequest({ checkpointId: 8, userIdentifier: 'x', identifierType: 'wallet', action: 'reached' })).toThrow()
  })

  it('should reject unknown identifierType', () => {
    expect(() => validateCheckpointRequest({ checkpointId: 3, userIdentifier: 'x', identifierType: 'phone', action: 'reached' })).toThrow()
  })

  it('should reject unknown action', () => {
    expect(() => validateCheckpointRequest({ checkpointId: 3, userIdentifier: 'x', identifierType: 'wallet', action: 'viewed' })).toThrow()
  })

  it('should reject malformed email', () => {
    expect(() =>
      validateCheckpointRequest({
        checkpointId: 3,
        userIdentifier: 'x',
        identifierType: 'wallet',
        action: 'reached',
        email: 'not-an-email'
      })
    ).toThrow()
  })

  it('should reject missing checkpointId', () => {
    expect(() => validateCheckpointRequest({ userIdentifier: 'x', identifierType: 'wallet', action: 'reached' })).toThrow()
  })

  it('should reject missing userIdentifier', () => {
    expect(() => validateCheckpointRequest({ checkpointId: 3, identifierType: 'wallet', action: 'reached' })).toThrow()
  })

  it('should reject missing identifierType', () => {
    expect(() => validateCheckpointRequest({ checkpointId: 3, userIdentifier: 'x', action: 'reached' })).toThrow()
  })

  it('should reject missing action', () => {
    expect(() => validateCheckpointRequest({ checkpointId: 3, userIdentifier: 'x', identifierType: 'wallet' })).toThrow()
  })

  it('should reject empty userIdentifier', () => {
    expect(() => validateCheckpointRequest({ checkpointId: 3, userIdentifier: '', identifierType: 'wallet', action: 'reached' })).toThrow()
  })

  it('should reject additional unknown properties', () => {
    expect(() =>
      validateCheckpointRequest({
        checkpointId: 3,
        userIdentifier: 'x',
        identifierType: 'wallet',
        action: 'reached',
        unknownField: 'value'
      })
    ).toThrow()
  })
})
