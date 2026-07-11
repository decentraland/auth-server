import { Interface } from 'ethers'
import { ITenderlyAdapter, TenderlyRawLog, TenderlySimulationResult } from '../../src/adapters/tenderly'
import { createSimulationComponent } from '../../src/logic/simulation/component'
import { UnsupportedChainError } from '../../src/logic/simulation/errors'
import { ISimulationComponent, SimulationRequestBody } from '../../src/logic/simulation/types'
import { createMockLogs } from '../mocks'

const FROM = '0x1111111111111111111111111111111111111111'
const TO = '0x2222222222222222222222222222222222222222'
const SPENDER = '0x3333333333333333333333333333333333333333'
const TOKEN = '0x4444444444444444444444444444444444444444'
const TOKEN_TWO = '0x5555555555555555555555555555555555555555'
const MAX_UINT256 = 2n ** 256n - 1n
const SUPPORTED_CHAIN_IDS = [1, 137, 11155111, 80002]

const erc20ApprovalInterface = new Interface(['event Approval(address indexed owner, address indexed spender, uint256 value)'])
const erc721ApprovalInterface = new Interface(['event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)'])
const approvalForAllInterface = new Interface(['event ApprovalForAll(address indexed owner, address indexed operator, bool approved)'])
const transferSingleInterface = new Interface([
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'
])
const transferBatchInterface = new Interface([
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)'
])

function erc20ApprovalLog(owner: string, spender: string, value: bigint, address: string): TenderlyRawLog {
  return { address, ...erc20ApprovalInterface.encodeEventLog('Approval', [owner, spender, value]) }
}

function erc721ApprovalLog(owner: string, approved: string, tokenId: bigint, address: string): TenderlyRawLog {
  return { address, ...erc721ApprovalInterface.encodeEventLog('Approval', [owner, approved, tokenId]) }
}

function approvalForAllLog(owner: string, operator: string, approved: boolean, address: string): TenderlyRawLog {
  return { address, ...approvalForAllInterface.encodeEventLog('ApprovalForAll', [owner, operator, approved]) }
}

function transferSingleLog(operator: string, from: string, to: string, id: bigint, value: bigint, address: string): TenderlyRawLog {
  return { address, ...transferSingleInterface.encodeEventLog('TransferSingle', [operator, from, to, id, value]) }
}

function transferBatchLog(operator: string, from: string, to: string, ids: bigint[], values: bigint[], address: string): TenderlyRawLog {
  return { address, ...transferBatchInterface.encodeEventLog('TransferBatch', [operator, from, to, ids, values]) }
}

function baseResult(overrides: Partial<TenderlySimulationResult> = {}): TenderlySimulationResult {
  return {
    status: true,
    errorMessage: null,
    assetChanges: [],
    exposureChanges: [],
    rawLogs: [],
    balanceChanges: [],
    events: [],
    ...overrides
  }
}

describe('when simulating a transaction', () => {
  let tenderly: { simulate: jest.Mock }
  let component: ISimulationComponent

  beforeEach(async () => {
    tenderly = { simulate: jest.fn().mockResolvedValue(baseResult()) }
    component = await createSimulationComponent(
      { tenderly: tenderly as unknown as ITenderlyAdapter, logs: createMockLogs() },
      { supportedChainIds: SUPPORTED_CHAIN_IDS }
    )
  })

  describe('and the chain id is not supported', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 999, from: FROM, to: TO }
    })

    it('should throw an UnsupportedChainError', async () => {
      await expect(component.simulateTransaction(body)).rejects.toThrow(UnsupportedChainError)
    })

    it('should not call the Tenderly adapter', async () => {
      await expect(component.simulateTransaction(body)).rejects.toThrow(UnsupportedChainError)
      expect(tenderly.simulate).not.toHaveBeenCalled()
    })
  })

  describe('and the value is a hexadecimal string', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: '0xde0b6b3a7640000' }
    })

    it('should normalize the value to a decimal string and default data to 0x when calling Tenderly', async () => {
      await component.simulateTransaction(body)

      expect(tenderly.simulate).toHaveBeenCalledWith({
        networkId: '137',
        from: FROM,
        to: TO,
        input: '0x',
        value: '1000000000000000000'
      })
    })
  })

  describe('and the value is a decimal string', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: '1000000000000000000', data: '0xabcdef' }
    })

    it('should pass the decimal value and data through to Tenderly', async () => {
      await component.simulateTransaction(body)

      expect(tenderly.simulate).toHaveBeenCalledWith({
        networkId: '137',
        from: FROM,
        to: TO,
        input: '0xabcdef',
        value: '1000000000000000000'
      })
    })
  })

  describe('and Tenderly reports an ERC20 transfer', () => {
    let body: SimulationRequestBody
    const mixedCaseFrom = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa'
    const mixedCaseTo = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb'
    const mixedCaseToken = '0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc'

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [
            {
              type: 'Transfer',
              from: mixedCaseFrom,
              to: mixedCaseTo,
              amount: '1.5',
              raw_amount: '1500000000000000000',
              dollar_value: '1.50',
              token_info: {
                standard: 'ERC20',
                contract_address: mixedCaseToken,
                symbol: 'MANA',
                name: 'Decentraland MANA',
                logo: 'https://logo.example/mana.png',
                decimals: 18
              }
            }
          ]
        })
      )
    })

    it('should map it to a normalized erc20 asset change with lowercased addresses', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toEqual([
        {
          type: 'transfer',
          standard: 'erc20',
          from: mixedCaseFrom.toLowerCase(),
          to: mixedCaseTo.toLowerCase(),
          amount: '1.5',
          rawAmount: '1500000000000000000',
          tokenId: null,
          contractAddress: mixedCaseToken.toLowerCase(),
          symbol: 'MANA',
          name: 'Decentraland MANA',
          decimals: 18,
          logoUrl: 'https://logo.example/mana.png',
          dollarValue: '1.50'
        }
      ])
    })
  })

  describe('and Tenderly reports net balance changes and decoded events', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          balanceChanges: [{ address: FROM.toLowerCase(), dollarValue: '-12.34' }],
          events: [{ name: 'Transfer', address: TOKEN.toLowerCase() }]
        })
      )
    })

    it('should include the net balance changes from the adapter result', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.balanceChanges).toEqual([{ address: FROM.toLowerCase(), dollarValue: '-12.34' }])
    })

    it('should include the decoded events from the adapter result', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.events).toEqual([{ name: 'Transfer', address: TOKEN.toLowerCase() }])
    })
  })

  describe('and the transaction would revert', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO }
      tenderly.simulate.mockResolvedValue(baseResult({ status: false, errorMessage: 'execution reverted: ERC20: insufficient allowance' }))
    })

    it('should report the status as reverted', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.status).toBe('reverted')
    })

    it('should include the revert reason as the error', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.error).toBe('execution reverted: ERC20: insufficient allowance')
    })
  })

  describe('and the calldata approves an unlimited ERC20 allowance', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [erc20ApprovalLog(FROM, SPENDER, MAX_UINT256, TOKEN)] }))
    })

    it('should decode an erc20 approval with the raw amount and owner/spender', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([
        {
          kind: 'approval',
          standard: 'erc20',
          owner: FROM.toLowerCase(),
          spender: SPENDER.toLowerCase(),
          amount: null,
          rawAmount: MAX_UINT256.toString(),
          isUnlimited: true,
          tokenId: null,
          approved: null,
          contractAddress: TOKEN.toLowerCase(),
          symbol: null,
          name: null
        }
      ])
    })
  })

  describe('and the calldata approves a limited ERC20 allowance', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [erc20ApprovalLog(FROM, SPENDER, 1000n, TOKEN)] }))
    })

    it('should not flag the approval as unlimited', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges[0].isUnlimited).toBe(false)
    })
  })

  describe('and the calldata approves a single ERC721 token', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [erc721ApprovalLog(FROM, SPENDER, 42n, TOKEN)] }))
    })

    it('should decode an erc721 approval with the tokenId and standard erc721', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([
        {
          kind: 'approval',
          standard: 'erc721',
          owner: FROM.toLowerCase(),
          spender: SPENDER.toLowerCase(),
          amount: null,
          rawAmount: null,
          isUnlimited: false,
          tokenId: '42',
          approved: null,
          contractAddress: TOKEN.toLowerCase(),
          symbol: null,
          name: null
        }
      ])
    })
  })

  describe('and both an ERC20 and an ERC721 Approval share the same topic0', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          rawLogs: [erc20ApprovalLog(FROM, SPENDER, 1000n, TOKEN), erc721ApprovalLog(FROM, SPENDER, 42n, TOKEN_TWO)]
        })
      )
    })

    it('should disambiguate them by topic count into erc20 and erc721', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges.map(approval => approval.standard).sort()).toEqual(['erc20', 'erc721'])
    })
  })

  describe('and the calldata grants approval for all', () => {
    describe('and approved is true', () => {
      let body: SimulationRequestBody

      beforeEach(() => {
        body = { chainId: 137, from: FROM, to: TOKEN }
        tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [approvalForAllLog(FROM, SPENDER, true, TOKEN)] }))
      })

      it('should decode an approvalForAll flagged as unlimited with approved true', async () => {
        const response = await component.simulateTransaction(body)

        expect(response.approvalChanges).toEqual([
          {
            kind: 'approvalForAll',
            standard: 'unknown',
            owner: FROM.toLowerCase(),
            spender: SPENDER.toLowerCase(),
            amount: null,
            rawAmount: null,
            isUnlimited: true,
            tokenId: null,
            approved: true,
            contractAddress: TOKEN.toLowerCase(),
            symbol: null,
            name: null
          }
        ])
      })
    })

    describe('and approved is false (revoke)', () => {
      let body: SimulationRequestBody

      beforeEach(() => {
        body = { chainId: 137, from: FROM, to: TOKEN }
        tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [approvalForAllLog(FROM, SPENDER, false, TOKEN)] }))
      })

      it('should decode an approvalForAll with approved false and not unlimited', async () => {
        const response = await component.simulateTransaction(body)

        expect(response.approvalChanges[0]).toMatchObject({ kind: 'approvalForAll', approved: false, isUnlimited: false })
      })
    })
  })

  describe('and an ERC1155 TransferSingle is logged', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [transferSingleLog(FROM, FROM, TO, 7n, 5n, TOKEN)] }))
    })

    it('should add an erc1155 transfer asset change with the tokenId and raw amount', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toEqual([
        {
          type: 'transfer',
          standard: 'erc1155',
          from: FROM.toLowerCase(),
          to: TO.toLowerCase(),
          amount: null,
          rawAmount: '5',
          tokenId: '7',
          contractAddress: TOKEN.toLowerCase(),
          symbol: null,
          name: null,
          decimals: null,
          logoUrl: null,
          dollarValue: null
        }
      ])
    })
  })

  describe('and an ERC1155 TransferBatch is logged', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [transferBatchLog(FROM, FROM, TO, [1n, 2n], [10n, 20n], TOKEN)] }))
    })

    it('should add one erc1155 transfer per id/value pair', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.map(change => ({ tokenId: change.tokenId, rawAmount: change.rawAmount }))).toEqual([
        { tokenId: '1', rawAmount: '10' },
        { tokenId: '2', rawAmount: '20' }
      ])
    })
  })

  describe('and a native value is sent with no native asset change reported', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: '1000000000000000000' }
      tenderly.simulate.mockResolvedValue(baseResult())
    })

    it('should synthesize a native asset change with the value formatted to 18 decimals', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toEqual([
        {
          type: 'transfer',
          standard: 'native',
          from: FROM.toLowerCase(),
          to: TO.toLowerCase(),
          amount: '1.0',
          rawAmount: '1000000000000000000',
          tokenId: null,
          contractAddress: null,
          symbol: null,
          name: null,
          decimals: 18,
          logoUrl: null,
          dollarValue: null
        }
      ])
    })
  })

  describe('and an ERC20 allowance is reset from zero to unlimited to the same spender', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          rawLogs: [erc20ApprovalLog(FROM, SPENDER, 0n, TOKEN), erc20ApprovalLog(FROM, SPENDER, MAX_UINT256, TOKEN)]
        })
      )
    })

    it('should collapse the two Approval logs into a single approval change', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toHaveLength(1)
    })

    it('should keep the last occurrence and flag it as unlimited', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges[0]).toMatchObject({ isUnlimited: true, rawAmount: MAX_UINT256.toString() })
    })
  })

  describe('and the transaction would revert while sending a native value', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: '1000000000000000000' }
      tenderly.simulate.mockResolvedValue(baseResult({ status: false, errorMessage: 'execution reverted' }))
    })

    it('should not synthesize a native asset change for the reverted transaction', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.some(change => change.standard === 'native')).toBe(false)
    })
  })

  describe('and a raw log is malformed with no topics array', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          rawLogs: [{ address: TOKEN, data: '0x' } as unknown as TenderlyRawLog, erc20ApprovalLog(FROM, SPENDER, 1000n, TOKEN)]
        })
      )
    })

    it('should resolve without throwing', async () => {
      await expect(component.simulateTransaction(body)).resolves.toBeDefined()
    })

    it('should still decode the well-formed approval and skip the malformed log', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toHaveLength(1)
    })
  })

  describe('and Tenderly reports an ERC721 transfer with a token id', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [
            {
              type: 'Transfer',
              from: FROM,
              to: TO,
              token_id: '512',
              token_info: { standard: 'ERC721', contract_address: TOKEN }
            }
          ]
        })
      )
    })

    it('should map the Tenderly token_id into the asset change tokenId', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges[0].tokenId).toBe('512')
    })
  })

  describe('and an ERC1155 transfer is reported by both Tenderly and a raw log', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [
            {
              type: 'Transfer',
              from: FROM,
              to: TO,
              token_id: '5',
              token_info: { standard: 'ERC1155', contract_address: TOKEN }
            }
          ],
          rawLogs: [transferSingleLog(FROM, FROM, TO, 5n, 3n, TOKEN)]
        })
      )
    })

    it('should deduplicate them into a single asset change', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toHaveLength(1)
    })
  })

  describe('and a finite ERC20 approval has token decimals known from asset changes', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [{ type: 'Transfer', token_info: { standard: 'ERC20', contract_address: TOKEN, decimals: 6 } }],
          rawLogs: [erc20ApprovalLog(FROM, SPENDER, 500n * 1000000n, TOKEN)]
        })
      )
    })

    it('should format the approval amount using the token decimals', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges[0].amount).toBe('500.0')
    })
  })
})
