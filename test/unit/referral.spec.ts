import { test } from '../components'

test('Referral', async ({ components }) => {
  let invitedUserAddress: string
  let mockFetch: jest.Mock

  beforeEach(async () => {
    jest.clearAllMocks()
    mockFetch = jest.fn()
    global.fetch = mockFetch
    invitedUserAddress = '0x36359cd12e64c150a347f1dd3ff95bf68b46b33f'
  })

  describe('when successfully updating the referral', () => {
    it('should resolve', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204
      })

      const promise = components.referral.updateReferral(invitedUserAddress)
      expect(mockFetch).toHaveBeenCalled()
      await promise
    })
  })

  describe('when fails updating the referral', () => {
    it('should reject', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400
      })

      const promise = components.referral.updateReferral(invitedUserAddress)
      expect(mockFetch).toHaveBeenCalled()
      await promise
    })
  })
})
