/* eslint-disable @typescript-eslint/naming-convention */
import { ReferralError } from '../../src/ports/referral/types'
import { test } from '../components'

test('Referral', ({ components }) => {
  const endpoint = 'https://referral-server.decentraland.zone/referral-progress'
  let apiKey: string
  let invitedUserAddress: string
  let mockFetch: jest.Mock

  beforeEach(async () => {
    jest.clearAllMocks()

    mockFetch = jest.fn()
    global.fetch = mockFetch

    apiKey = await components.config.requireString('REFERRAL_SERVER_API_KEY')
    invitedUserAddress = '0x36359cd12e64c150a347f1dd3ff95bf68b46b33f'
  })

  describe('When updateReferral is called', () => {
    describe('with valid body', () => {
      beforeEach(() => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 204
        })
      })

      it('should update referral progress as signed up and return 204', async () => {
        await components.referralServer.updateReferral(invitedUserAddress)

        expect(mockFetch).toHaveBeenCalledWith(`${endpoint}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            invited_user: invitedUserAddress.toLowerCase()
          })
        })

        const mockResponse = await mockFetch.mock.results[0].value
        expect(mockResponse.status).toBe(204)
      })
    })

    describe('when authentication fails', () => {
      beforeEach(() => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => 'Unauthorized'
        })
      })

      it('should return an error when api key is invalid', async () => {
        const error = await components.referralServer.updateReferral(invitedUserAddress).catch(e => e)
        expect(error).toBeInstanceOf(Object)
        expect((error as ReferralError).message).toBe('Failed to update referral: Unauthorized')
      })
    })

    describe('when input validation fails', () => {
      describe('and invited_user is missing', () => {
        beforeEach(() => {
          mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            text: async () => 'Missing required field: invited_user'
          })
        })

        it('should throw error when invited_user is missing', async () => {
          const error = await components.referralServer.updateReferral('').catch(e => e)
          expect(error).toBeInstanceOf(Object)
          expect((error as ReferralError).message).toBe('Failed to update referral: Missing required field: invited_user')
        })
      })

      describe('when invited_user is not a valid ethereum address', () => {
        beforeEach(() => {
          mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            text: async () => 'Invalid invited_user address'
          })
        })

        it('should throw error when invited_user is invalid', async () => {
          const error = await components.referralServer.updateReferral('invalid-address').catch(e => e)
          expect(error).toBeInstanceOf(Object)
          expect((error as ReferralError).message).toBe('Failed to update referral: Invalid invited_user address')
        })
      })
    })
  })
})
