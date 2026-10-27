/**
 * For tests: jsdom lays nothing out, so every element is 0px tall. This gives every element these
 * heights, for code that tells clipped text by `scrollHeight > clientHeight`. Undo with
 * `restoreLayout()`.
 */
export function stubLayout(clientHeight: number, scrollHeight: number): void {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight })
}

export function restoreLayout(): void {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
}
