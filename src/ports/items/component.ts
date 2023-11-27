import { isErrorWithMessage } from '../../logic/errors'
import { AppComponents } from '../../types'
import { QueryFailure } from '../lists/errors'
import { ItemNotFoundError } from './errors'
import { IItemsComponent } from './types'

export function createItemsComponent(components: Pick<AppComponents, 'collectionsSubgraph' | 'logs'>): IItemsComponent {
  const { collectionsSubgraph, logs } = components
  const logger = logs.getLogger('Items component')

  async function validateItemExists(itemId: string): Promise<void> {
    try {
      const { items } = await collectionsSubgraph.query<{ items: { id: string }[] }>(
        `query items($itemId: String) {
          items(first: 1, where: { id: $itemId }) {
            id
          }
        }`,
        { itemId }
      )

      if (items.length === 0) {
        throw new ItemNotFoundError(itemId)
      }
    } catch (error) {
      if (error instanceof ItemNotFoundError) throw error

      logger.error('Querying the collections subgraph failed.')
      throw new QueryFailure(isErrorWithMessage(error) ? error.message : 'Unknown')
    }
  }

  return { validateItemExists }
}
