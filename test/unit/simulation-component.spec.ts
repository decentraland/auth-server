import { Interface, MaxUint256, ZeroAddress, id, zeroPadValue } from 'ethers'
import { ITenderlyAdapter, TenderlyAssetChange, TenderlyRawLog, TenderlySimulationResult } from '../../src/adapters/tenderly'
import { createSimulationComponent } from '../../src/logic/simulation/component'
import { InvalidSimulationParamsError, UnreadableSimulationError, UnsupportedChainError } from '../../src/logic/simulation/errors'
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
const erc20TransferInterface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)'])
const erc721TransferInterface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'])
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

function erc20TransferLog(from: string, to: string, value: bigint, address: string): TenderlyRawLog {
  return { address, ...erc20TransferInterface.encodeEventLog('Transfer', [from, to, value]) }
}

function erc721TransferLog(from: string, to: string, tokenId: bigint, address: string): TenderlyRawLog {
  return { address, ...erc721TransferInterface.encodeEventLog('Transfer', [from, to, tokenId]) }
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

  describe('and the transaction would revert after the simulator traced asset changes and approvals', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          status: false,
          errorMessage: 'execution reverted',
          assetChanges: [
            { type: 'Transfer', from: FROM, to: TO, raw_amount: '1', token_info: { standard: 'ERC20', contract_address: TOKEN } }
          ],
          rawLogs: [approvalForAllLog(FROM, SPENDER, true, TOKEN), erc721TransferLog(FROM, TO, 1n, TOKEN)],
          balanceChanges: [{ address: FROM.toLowerCase(), dollarValue: '-1.00' }],
          events: [{ name: 'Transfer', address: TOKEN.toLowerCase() }]
        })
      )
    })

    it('should report no asset changes and no approvals', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.status).toBe('reverted')
      expect(response.assetChanges).toEqual([])
      expect(response.approvalChanges).toEqual([])
    })

    it('should carry the revert reason', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.error).toBe('execution reverted')
    })

    it('should report no balance changes and no events', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.balanceChanges).toEqual([])
      expect(response.events).toEqual([])
    })
  })

  describe('and the transaction would revert with a reason carrying control characters and running long', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(baseResult({ status: false, errorMessage: `Safe\u202E\u0000 to sign ${'x'.repeat(300)}` }))
    })

    it('should strip the control characters and bound the length', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.error).toBe(`Safe to sign ${'x'.repeat(199 - 'Safe to sign '.length)}…`)
    })
  })

  describe('and an ERC721 transfer clears the token approval as OpenZeppelin collections do', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          rawLogs: [erc721ApprovalLog(FROM, ZeroAddress, 512n, TOKEN), erc721TransferLog(FROM, TO, 512n, TOKEN)]
        })
      )
    })

    it('should not report the implied clear as an approval change', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([])
    })
  })

  describe('and an ERC721 token comes back to its owner in the same transaction and is then approved to a spender', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          rawLogs: [
            erc721ApprovalLog(FROM, ZeroAddress, 512n, TOKEN),
            erc721TransferLog(FROM, TO, 512n, TOKEN),
            erc721ApprovalLog(TO, ZeroAddress, 512n, TOKEN),
            erc721TransferLog(TO, FROM, 512n, TOKEN),
            erc721ApprovalLog(FROM, SPENDER, 512n, TOKEN)
          ]
        })
      )
    })

    it('should keep the grant and drop only the two clears', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([
        expect.objectContaining({ kind: 'approval', standard: 'erc721', owner: FROM.toLowerCase(), spender: SPENDER, tokenId: '512' })
      ])
    })
  })

  describe('and an ERC721 token comes back to its owner, is approved to a spender and then explicitly revoked', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          rawLogs: [
            erc721ApprovalLog(FROM, ZeroAddress, 512n, TOKEN),
            erc721TransferLog(FROM, TO, 512n, TOKEN),
            erc721ApprovalLog(TO, ZeroAddress, 512n, TOKEN),
            erc721TransferLog(TO, FROM, 512n, TOKEN),
            erc721ApprovalLog(FROM, SPENDER, 512n, TOKEN),
            erc721ApprovalLog(FROM, ZeroAddress, 512n, TOKEN)
          ]
        })
      )
    })

    it('should report the revocation and not the grant it undid, since a token has one approved address', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([
        expect.objectContaining({ kind: 'approval', standard: 'erc721', owner: FROM.toLowerCase(), spender: ZeroAddress, tokenId: '512' })
      ])
    })
  })

  describe('and an ERC721 zero-address approval is followed by a transfer of another token', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({ rawLogs: [erc721ApprovalLog(FROM, ZeroAddress, 512n, TOKEN), erc721TransferLog(FROM, TO, 513n, TOKEN)] })
      )
    })

    it('should keep the revocation, since the transfer next to it is not of that token', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([expect.objectContaining({ spender: ZeroAddress, tokenId: '512' })])
    })
  })

  describe('and an ERC721 token is approved and then revoked with no transfer', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({ rawLogs: [erc721ApprovalLog(FROM, SPENDER, 512n, TOKEN), erc721ApprovalLog(FROM, ZeroAddress, 512n, TOKEN)] })
      )
    })

    it('should report only the revocation, the final state', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([expect.objectContaining({ spender: ZeroAddress, tokenId: '512' })])
    })
  })

  describe('and an ERC721 token approval is revoked with the zero address without transferring the token', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [erc721ApprovalLog(FROM, ZeroAddress, 512n, TOKEN)] }))
    })

    it('should keep the revocation', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([
        expect.objectContaining({ kind: 'approval', standard: 'erc721', owner: FROM.toLowerCase(), spender: ZeroAddress, tokenId: '512' })
      ])
    })
  })

  describe('and an ERC721 token approval is granted without a transfer of that token', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({ rawLogs: [erc721ApprovalLog(FROM, SPENDER, 512n, TOKEN), erc721TransferLog(FROM, TO, 513n, TOKEN)] })
      )
    })

    it('should keep the grant', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([
        expect.objectContaining({ kind: 'approval', standard: 'erc721', spender: SPENDER, tokenId: '512' })
      ])
    })
  })

  describe('and the owner transfers ERC20 tokens and a distinct real allowance is granted in the same transaction', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({ rawLogs: [erc20TransferLog(FROM, TO, 100n, TOKEN), erc20ApprovalLog(FROM, SPENDER, MAX_UINT256, TOKEN)] })
      )
    })

    it('should keep the grant', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([
        expect.objectContaining({ kind: 'approval', standard: 'erc20', owner: FROM.toLowerCase(), spender: SPENDER, isUnlimited: true })
      ])
    })
  })

  describe('and an ERC20 transferFrom writes the remaining allowance as an Approval', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: SPENDER }
      tenderly.simulate.mockResolvedValue(
        baseResult({ rawLogs: [erc20TransferLog(FROM, TO, 100n, TOKEN), erc20ApprovalLog(FROM, SPENDER, MAX_UINT256 - 100n, TOKEN)] })
      )
    })

    it('should report it as logged and leave telling consumption from a grant to the client', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([expect.objectContaining({ kind: 'approval', standard: 'erc20', spender: SPENDER })])
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

    it('should report an erc1155 movement with the token id and the raw amount, for the dapp to refuse on', async () => {
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

    it('should report one erc1155 movement per id and value pair', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.map(change => ({ tokenId: change.tokenId, rawAmount: change.rawAmount }))).toEqual([
        { tokenId: '1', rawAmount: '10' },
        { tokenId: '2', rawAmount: '20' }
      ])
    })
  })

  describe('and two identical ERC1155 transfers are logged', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({ rawLogs: [transferSingleLog(FROM, FROM, TO, 7n, 5n, TOKEN), transferSingleLog(FROM, FROM, TO, 7n, 5n, TOKEN)] })
      )
    })

    it('should report both movements', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.map(change => change.rawAmount)).toEqual(['5', '5'])
    })
  })

  describe('and Tenderly reports an ERC1155 transfer that a raw log also records', () => {
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
              token_id: '7',
              raw_amount: '5',
              token_info: { standard: 'ERC1155', contract_address: TOKEN }
            }
          ],
          rawLogs: [transferSingleLog(FROM, FROM, TO, 7n, 5n, TOKEN)]
        })
      )
    })

    it('should report the movement once, from the log, and leave the Tenderly row for that contract out', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.filter(change => change.standard === 'erc1155')).toEqual([
        expect.objectContaining({ rawAmount: '5', tokenId: '7' })
      ])
    })
  })

  describe('and the value is not a number', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: 'ten' }
    })

    it('should reject it as invalid params before asking Tenderly', async () => {
      await expect(component.simulateTransaction(body)).rejects.toBeInstanceOf(InvalidSimulationParamsError)
      expect(tenderly.simulate).not.toHaveBeenCalled()
    })
  })

  describe('and the value is the largest an EVM transaction can carry', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: MaxUint256.toString() }
      tenderly.simulate.mockResolvedValue(baseResult())
    })

    it('should pass validation and simulate with it', async () => {
      expect(() => component.validateRequest(body)).not.toThrow()
      await component.simulateTransaction(body)
      expect(tenderly.simulate).toHaveBeenCalledWith(expect.objectContaining({ value: MaxUint256.toString() }))
    })
  })

  describe('and the value is one above what an EVM transaction can carry', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: (MaxUint256 + 1n).toString() }
    })

    it('should reject it as invalid params before asking Tenderly', async () => {
      expect(() => component.validateRequest(body)).toThrow(InvalidSimulationParamsError)
      await expect(component.simulateTransaction(body)).rejects.toBeInstanceOf(InvalidSimulationParamsError)
      expect(tenderly.simulate).not.toHaveBeenCalled()
    })
  })

  describe('and Tenderly reports an ERC1155 transfer while the logs record no movement on that contract', () => {
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
              token_id: '7',
              raw_amount: '5',
              token_info: { standard: 'ERC1155', contract_address: TOKEN }
            }
          ],
          rawLogs: []
        })
      )
    })

    it('should keep the Tenderly row, so a partial answer never hides a reported movement', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toEqual([
        expect.objectContaining({ standard: 'erc1155', tokenId: '7', rawAmount: '5', contractAddress: TOKEN.toLowerCase() })
      ])
    })
  })

  describe('and Tenderly reports an ERC1155 transfer on one contract while the logs record a movement on another', () => {
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
              token_id: '7',
              raw_amount: '5',
              token_info: { standard: 'ERC1155', contract_address: TOKEN }
            }
          ],
          rawLogs: [transferSingleLog(FROM, FROM, TO, 1n, 2n, TOKEN_TWO)]
        })
      )
    })

    it('should report both, each from its own source', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.map(change => [change.contractAddress, change.rawAmount])).toEqual([
        [TOKEN.toLowerCase(), '5'],
        [TOKEN_TWO.toLowerCase(), '2']
      ])
    })
  })

  describe.each([-1, 1.5, 300, Number.POSITIVE_INFINITY])('and a finite ERC20 approval has token decimals of %p', decimals => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [{ type: 'Transfer', token_info: { standard: 'ERC20', contract_address: TOKEN, decimals } }],
          rawLogs: [erc20ApprovalLog(FROM, SPENDER, 500n, TOKEN)]
        })
      )
    })

    it('should treat the decimals as unknown and report the approval without a formatted amount', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.approvalChanges).toEqual([expect.objectContaining({ kind: 'approval', rawAmount: '500', amount: null })])
    })
  })

  describe.each([
    [
      'an ERC20 Approval with truncated data',
      { topics: [id('Approval(address,address,uint256)'), zeroPadValue(FROM, 32), zeroPadValue(SPENDER, 32)], data: '0x12' }
    ],
    [
      'an Approval with a topic count of neither standard',
      { topics: [id('Approval(address,address,uint256)'), zeroPadValue(FROM, 32)], data: '0x' }
    ],
    [
      'an ApprovalForAll with no data',
      { topics: [id('ApprovalForAll(address,address,bool)'), zeroPadValue(FROM, 32), zeroPadValue(SPENDER, 32)], data: '0x' }
    ],
    [
      'a TransferSingle with no data',
      {
        topics: [
          id('TransferSingle(address,address,address,uint256,uint256)'),
          zeroPadValue(FROM, 32),
          zeroPadValue(FROM, 32),
          zeroPadValue(TO, 32)
        ],
        data: '0x'
      }
    ],
    [
      'a TransferBatch with truncated data',
      {
        topics: [
          id('TransferBatch(address,address,address,uint256[],uint256[])'),
          zeroPadValue(FROM, 32),
          zeroPadValue(FROM, 32),
          zeroPadValue(TO, 32)
        ],
        data: '0x1234'
      }
    ],
    [
      'a Transfer with a topic count of neither standard',
      { topics: [id('Transfer(address,address,uint256)'), zeroPadValue(FROM, 32)], data: '0x' }
    ],
    [
      'an ERC20 Transfer with truncated data',
      { topics: [id('Transfer(address,address,uint256)'), zeroPadValue(FROM, 32), zeroPadValue(TO, 32)], data: '0x12' }
    ]
  ])('and the logs carry %s', (_label, log) => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [{ address: TOKEN, ...log }] }))
    })

    it('should fail the simulation as unreadable rather than report the effects without it', async () => {
      await expect(component.simulateTransaction(body)).rejects.toBeInstanceOf(UnreadableSimulationError)
    })
  })

  describe('and the logs record an ERC721 transfer that Tenderly did not report', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [],
          exposureChanges: [{ token_info: { contract_address: TOKEN, symbol: 'HAT', name: 'Hats' } }],
          rawLogs: [erc721TransferLog(FROM, TO, 512n, TOKEN)]
        })
      )
    })

    it('should report the movement from the log, named from what Tenderly said about the token', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toEqual([
        expect.objectContaining({
          type: 'transfer',
          standard: 'erc721',
          from: FROM.toLowerCase(),
          to: TO.toLowerCase(),
          tokenId: '512',
          contractAddress: TOKEN.toLowerCase(),
          symbol: 'HAT',
          name: 'Hats'
        })
      ])
    })
  })

  describe('and the logs record an ERC20 transfer that Tenderly did not report', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [],
          exposureChanges: [{ token_info: { contract_address: TOKEN, symbol: 'MANA', decimals: 2 } }],
          rawLogs: [erc20TransferLog(FROM, TO, 150n, TOKEN)]
        })
      )
    })

    it('should report the movement from the log with the amount formatted from the known decimals', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toEqual([
        expect.objectContaining({
          standard: 'erc20',
          from: FROM.toLowerCase(),
          to: TO.toLowerCase(),
          rawAmount: '150',
          amount: '1.5',
          symbol: 'MANA',
          decimals: 2
        })
      ])
    })
  })

  describe('and Tenderly reports the same ERC20 transfer the logs record', () => {
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
              raw_amount: '150',
              amount: '1.5',
              dollar_value: '0.42',
              token_info: { standard: 'ERC20', contract_address: TOKEN, symbol: 'MANA', decimals: 2, logo: 'https://x/mana.png' }
            }
          ],
          rawLogs: [erc20TransferLog(FROM, TO, 150n, TOKEN)]
        })
      )
    })

    it('should report it once, from the log, keeping the dollar value and logo Tenderly gave it', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toEqual([
        expect.objectContaining({
          standard: 'erc20',
          rawAmount: '150',
          amount: '1.5',
          dollarValue: '0.42',
          logoUrl: 'https://x/mana.png',
          symbol: 'MANA'
        })
      ])
    })
  })

  describe('and the logs record a mint and a burn on a collection', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({ rawLogs: [erc721TransferLog(ZeroAddress, TO, 1n, TOKEN), erc721TransferLog(FROM, ZeroAddress, 2n, TOKEN)] })
      )
    })

    it('should report them as a mint and a burn', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.map(change => [change.type, change.tokenId])).toEqual([
        ['mint', '1'],
        ['burn', '2']
      ])
    })
  })

  describe('and Tenderly reports a second movement on the same contract that the logs do not record', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [
            { type: 'Transfer', from: FROM, to: TO, token_id: '1', token_info: { standard: 'ERC721', contract_address: TOKEN } },
            { type: 'Transfer', from: FROM, to: TO, token_id: '2', token_info: { standard: 'ERC721', contract_address: TOKEN } }
          ],
          rawLogs: [erc721TransferLog(FROM, TO, 1n, TOKEN)]
        })
      )
    })

    it('should report both, the logged one from the log and the other as Tenderly reported it', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.map(change => change.tokenId).sort()).toEqual(['1', '2'])
    })
  })

  describe('and Tenderly reports a mint with no sender that the logs record from the zero address', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [
            { type: 'Mint', to: TO, token_id: '1', dollar_value: '3.00', token_info: { standard: 'ERC721', contract_address: TOKEN } }
          ],
          rawLogs: [erc721TransferLog(ZeroAddress, TO, 1n, TOKEN)]
        })
      )
    })

    it('should recognize them as one movement and report it once as a mint with the dollar value', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toEqual([expect.objectContaining({ type: 'mint', tokenId: '1', dollarValue: '3.00' })])
    })
  })

  describe('and Tenderly reports an ERC1155 movement whose parties and amount an ERC20 log on the same contract also carries', () => {
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
              token_id: '7',
              raw_amount: '5',
              token_info: { standard: 'ERC1155', contract_address: TOKEN }
            }
          ],
          rawLogs: [erc20TransferLog(FROM, TO, 5n, TOKEN)]
        })
      )
    })

    it('should report both, never consuming a row of another standard', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.map(change => change.standard).sort()).toEqual(['erc1155', 'erc20'])
    })
  })

  describe('and Tenderly reports an ERC1155 movement whose parties and id an ERC721 log on the same contract also carries', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [
            { type: 'Transfer', from: FROM, to: TO, token_id: '7', token_info: { standard: 'ERC1155', contract_address: TOKEN } }
          ],
          rawLogs: [erc721TransferLog(FROM, TO, 7n, TOKEN)]
        })
      )
    })

    it('should report both', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.map(change => change.standard).sort()).toEqual(['erc1155', 'erc721'])
    })
  })

  describe('and the logs record an ERC1155 mint and burn', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          rawLogs: [transferSingleLog(FROM, ZeroAddress, TO, 7n, 5n, TOKEN), transferSingleLog(FROM, FROM, ZeroAddress, 8n, 1n, TOKEN)]
        })
      )
    })

    it('should report them as a mint and a burn, like the other standards', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.map(change => change.type)).toEqual(['mint', 'burn'])
    })
  })

  describe('and Tenderly reports an ERC20 transfer on a contract the logs say nothing about', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [
            { type: 'Transfer', from: FROM, to: TO, raw_amount: '5', token_info: { standard: 'ERC20', contract_address: TOKEN_TWO } }
          ],
          rawLogs: [erc721TransferLog(FROM, TO, 1n, TOKEN)]
        })
      )
    })

    it('should keep the Tenderly row next to the logged movement', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.map(change => [change.contractAddress, change.standard])).toEqual([
        [TOKEN_TWO.toLowerCase(), 'erc20'],
        [TOKEN.toLowerCase(), 'erc721']
      ])
    })
  })

  describe.each([
    ['more ids than values', [1n, 2n], [10n]],
    ['more values than ids', [1n], [10n, 20n]]
  ])('and a TransferBatch log carries %s', (_label, ids, values) => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [transferBatchLog(FROM, FROM, TO, ids, values, TOKEN)] }))
    })

    it('should fail the simulation as unreadable rather than report a partial batch', async () => {
      await expect(component.simulateTransaction(body)).rejects.toBeInstanceOf(UnreadableSimulationError)
    })
  })

  describe('and a Tenderly asset change carries its token id in hexadecimal', () => {
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
              token_id: '0x1F',
              raw_amount: '0x1',
              token_info: { standard: 'ERC721', contract_address: TOKEN }
            }
          ]
        })
      )
    })

    it('should report it in decimal, so one quantity has one spelling', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toEqual([expect.objectContaining({ tokenId: '31', rawAmount: '1' })])
    })
  })

  describe('and the logs carry an event this service does not report, with data it cannot decode', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(baseResult({ rawLogs: [{ address: TOKEN, topics: [id('Something(uint256)')], data: '0x12' }] }))
    })

    it('should leave it alone', async () => {
      await expect(component.simulateTransaction(body)).resolves.toMatchObject({ status: 'success', approvalChanges: [], assetChanges: [] })
    })
  })

  describe('and an asset change carries fields of the wrong type', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [
            {
              type: 7,
              from: 1,
              to: { nested: true },
              amount: 12,
              raw_amount: null,
              token_id: 3,
              token_info: { standard: 1, contract_address: 5, decimals: 'six' }
            } as unknown as TenderlyAssetChange
          ]
        })
      )
    })

    it('should read each field for its type instead of failing, leaving what does not fit out', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges).toEqual([
        expect.objectContaining({
          type: 'transfer',
          standard: 'unknown',
          from: null,
          to: null,
          amount: '12',
          rawAmount: null,
          tokenId: '3',
          contractAddress: null,
          decimals: null
        })
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

  describe('and a native value is sent while Tenderly reports an unrelated internal native movement', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: '1000000000000000000' }
      tenderly.simulate.mockResolvedValue(
        baseResult({ assetChanges: [{ type: 'Transfer', from: TO, to: SPENDER, raw_amount: '1', token_info: { standard: 'native' } }] })
      )
    })

    it('should still synthesize the submitted value transfer next to the reported one', async () => {
      const response = await component.simulateTransaction(body)

      expect(
        response.assetChanges.filter(change => change.standard === 'native').map(change => [change.from, change.to, change.rawAmount])
      ).toEqual([
        [TO.toLowerCase(), SPENDER.toLowerCase(), '1'],
        [FROM.toLowerCase(), TO.toLowerCase(), '1000000000000000000']
      ])
    })
  })

  describe('and a native value is sent that Tenderly reports as that very movement', () => {
    let body: SimulationRequestBody

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: '1000000000000000000' }
      tenderly.simulate.mockResolvedValue(
        baseResult({
          assetChanges: [{ type: 'Transfer', from: FROM, to: TO, raw_amount: '1000000000000000000', token_info: { standard: 'native' } }]
        })
      )
    })

    it('should not add a second native row', async () => {
      const response = await component.simulateTransaction(body)

      expect(response.assetChanges.filter(change => change.standard === 'native')).toHaveLength(1)
    })
  })

  describe('and the request is checked before any simulation', () => {
    describe('and the chain is not supported', () => {
      it('should throw an UnsupportedChainError without calling Tenderly', () => {
        expect(() => component.validateRequest({ chainId: 999999, from: FROM, to: TO })).toThrow(UnsupportedChainError)
        expect(tenderly.simulate).not.toHaveBeenCalled()
      })
    })

    describe('and the value is not an integer', () => {
      it('should throw an InvalidSimulationParamsError without calling Tenderly', () => {
        expect(() => component.validateRequest({ chainId: 137, from: FROM, to: TO, value: 'ten' })).toThrow(InvalidSimulationParamsError)
        expect(tenderly.simulate).not.toHaveBeenCalled()
      })
    })

    describe('and the request is valid', () => {
      it('should pass', () => {
        expect(() => component.validateRequest({ chainId: 137, from: FROM, to: TO, value: '0x1' })).not.toThrow()
      })
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
