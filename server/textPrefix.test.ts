import { describe, expect, it } from 'vitest'
import { textPrefix } from './textPrefix.ts'

/** An answer whose body comes in `chunks`, recording whether it was cancelled. */
function streamed(chunks: string[]) {
  const state = { cancelled: false, pulled: 0 }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[state.pulled++]
      if (chunk === undefined) controller.close()
      else controller.enqueue(new TextEncoder().encode(chunk))
    },
    cancel() {
      state.cancelled = true
    },
  })
  return { response: new Response(body), state }
}

describe('textPrefix', () => {
  it('reads a short answer whole', async () => {
    expect(await textPrefix(new Response('Forbidden'))).toBe('Forbidden')
    expect(await textPrefix(new Response(null))).toBe('')
  })

  it('stops at its limit, cuts the text there and cancels the rest', async () => {
    const { response, state } = streamed(['abcd', 'efgh', 'ijkl', 'mnop'])
    expect(await textPrefix(response, 6)).toBe('abcdef')
    expect(state.pulled).toBeLessThan(4)
    expect(state.cancelled).toBe(true)
  })
})
