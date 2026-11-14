// PostCSS's tokenizer, which its package exports but ships no types for: what stylesheets.ts reads.
declare module 'postcss/lib/tokenize' {
  /** A token's type, its text and, for most types, its first and last offsets in the input. */
  type Token = [type: string, content: string, start?: number, end?: number]
  export default function tokenizer(input: { css: string }, options?: { ignoreErrors?: boolean }): { nextToken(): Token | undefined; endOfFile(): boolean }
}
