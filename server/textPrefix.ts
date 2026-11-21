/** How much of a scanned host's answer Find reads: its tells are at the start (#511). */
export const TEXT_PREFIX_BYTES = 65_536

/**
 * The first `max` bytes of an answer's body as text, the rest left unread and the body cancelled,
 * so a host that streams on a scanned port can't fill the server's memory.
 */
export async function textPrefix(response: Response, max = TEXT_PREFIX_BYTES): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < max) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel()
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max))
}
