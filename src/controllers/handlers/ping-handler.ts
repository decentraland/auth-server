import { HandlerContextWithPath } from '../../types'

// handlers arguments only type what they need, to make unit testing easier
// TODO: handle the following eslint-disable statement
// eslint-disable-next-line @typescript-eslint/require-await
export async function pingHandler(context: Pick<HandlerContextWithPath<'metrics', '/ping'>, 'url' | 'components'>) {
  const {
    url,
    components: { metrics }
  } = context

  metrics.increment('test_ping_counter', {
    pathname: url.pathname
  })

  return {
    body: url.pathname
  }
}
