import { IFetchComponent } from '@well-known-components/http-server'
import { ITracerComponent } from '@well-known-components/interfaces'
import * as nodeFetch from 'node-fetch'
import { createFetchComponent } from '../../src/ports/fetch'
import { createTestTracerComponent } from '../components'

jest.mock('node-fetch')

let fetchComponent: IFetchComponent
let tracerComponent: ITracerComponent

let isInsideOfTraceSpanMock: jest.Mock
let getTraceChildStringMock: jest.Mock
let getTraceStateStringMock: jest.Mock

let url: nodeFetch.RequestInfo
let init: nodeFetch.RequestInit

beforeEach(async () => {
  isInsideOfTraceSpanMock = jest.fn()
  getTraceChildStringMock = jest.fn()
  getTraceStateStringMock = jest.fn()

  url = 'http://fetch-component-test.com'
  init = { headers: { 'Content-Type': 'application/json' } }

  tracerComponent = createTestTracerComponent({
    isInsideOfTraceSpan: isInsideOfTraceSpanMock,
    getTraceChildString: getTraceChildStringMock,
    getTraceStateString: getTraceStateStringMock
  })
  fetchComponent = await createFetchComponent({ tracer: tracerComponent })
  ;(nodeFetch.default as unknown as jest.Mock).mockResolvedValue({} as nodeFetch.Response)
})

describe('when fetching', () => {
  describe('and the tracer is outside the trace span', () => {
    beforeEach(() => {
      isInsideOfTraceSpanMock.mockReturnValue(false)
    })

    it('should call the node fetch without any additional header related to the tracer', async () => {
      await fetchComponent.fetch(url, init)
      expect(nodeFetch.default).toHaveBeenCalledWith(url, init)
    })
  })

  describe('and the tracer is inside the trace span', () => {
    const traceChild = 'trace-child'
    let expectedHeaders: nodeFetch.HeadersInit

    beforeEach(() => {
      isInsideOfTraceSpanMock.mockReturnValue(true)
      getTraceChildStringMock.mockReturnValue(traceChild)

      expectedHeaders = { ...init.headers, traceparent: traceChild }
    })

    it('should call the node fetch with the trace parent header in addition to the original ones', async () => {
      await fetchComponent.fetch(url, init)
      expect(nodeFetch.default).toHaveBeenCalledWith(url, { ...init, headers: expectedHeaders })
    })

    describe('and the trace state is not undefined', () => {
      const traceState = 'trace-state'

      beforeEach(() => {
        isInsideOfTraceSpanMock.mockReturnValue(true)
        getTraceStateStringMock.mockReturnValue(traceState)

        expectedHeaders = { ...expectedHeaders, tracestate: traceState }
      })

      it('should call the node fetch with also the trace state in the headers', async () => {
        await fetchComponent.fetch(url, init)
        expect(nodeFetch.default).toHaveBeenCalledWith(url, { ...init, headers: expectedHeaders })
      })
    })
  })
})
