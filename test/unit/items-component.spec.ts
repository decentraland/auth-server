import { ILoggerComponent } from '@well-known-components/interfaces'
import { ISubgraphComponent } from '@well-known-components/thegraph-component'
import { IItemsComponent, createItemsComponent } from '../../src/ports/items'
import { ItemNotFoundError } from '../../src/ports/items/errors'
import { QueryFailure } from '../../src/ports/lists/errors'
import { createTestLogsComponent, createTestSubgraphComponent } from '../components'

let itemId: string
let collectionsSubgraphQueryMock: jest.Mock
let items: IItemsComponent
let collectionsSubgraph: ISubgraphComponent
let logs: ILoggerComponent

beforeEach(() => {
  collectionsSubgraphQueryMock = jest.fn()
  logs = createTestLogsComponent({
    getLogger: jest.fn().mockReturnValue({ error: () => undefined, info: () => undefined })
  })
  collectionsSubgraph = createTestSubgraphComponent({ query: collectionsSubgraphQueryMock })
  items = createItemsComponent({
    collectionsSubgraph,
    logs
  })
  itemId = '0x08de0de733cc11081d43569b809c00e6ddf314fb-0'
})

describe('when validating if an item exists', () => {
  describe('and the collections subgraph query fails without a message', () => {
    beforeEach(() => {
      collectionsSubgraphQueryMock.mockRejectedValueOnce('Unknown')
    })

    it('should throw an error saying that the request failed with its message', () => {
      return expect(items.validateItemExists(itemId)).rejects.toEqual(new QueryFailure('Unknown'))
    })
  })

  describe('and the collections subgraph query fails with a message', () => {
    beforeEach(() => {
      collectionsSubgraphQueryMock.mockRejectedValueOnce(new Error('anError'))
    })

    it('should throw an error saying that the request failed with its message', () => {
      return expect(items.validateItemExists(itemId)).rejects.toEqual(new QueryFailure('anError'))
    })
  })

  describe("and the item doesn't exist", () => {
    beforeEach(() => {
      collectionsSubgraphQueryMock.mockResolvedValueOnce({ items: [] })
    })

    it('should throw an item not found error', () => {
      return expect(items.validateItemExists(itemId)).rejects.toEqual(new ItemNotFoundError(itemId))
    })
  })

  describe('and the item exists', () => {
    beforeEach(() => {
      collectionsSubgraphQueryMock.mockResolvedValueOnce({
        items: [{ id: itemId }]
      })
    })

    it('should resolve without any specific result', async () => {
      await expect(items.validateItemExists(itemId)).resolves.toEqual(undefined)
    })
  })
})
