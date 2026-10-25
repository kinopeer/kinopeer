/**
 * Marks <html data-input="pointer"> after a click or tap and removes it on the next key press, so
 * focus rings show only for keyboard navigation. `:focus-visible` alone isn't enough: browsers show
 * it when a modal dialog opens or the app moves focus (a menu's first item, a drawer's Close), even
 * after a click. base.css turns rings off under the attribute. Returns a function that stops it.
 */
export function trackInputModality(root: HTMLElement = document.documentElement): () => void {
  const doc = root.ownerDocument
  const onPointer = () => {
    root.dataset.input = 'pointer'
  }
  const onKey = (event: KeyboardEvent) => {
    // Shortcuts such as switching apps aren't navigation.
    if (event.metaKey || event.ctrlKey || event.altKey) return
    delete root.dataset.input
  }
  doc.addEventListener('pointerdown', onPointer, true)
  doc.addEventListener('keydown', onKey, true)
  return () => {
    doc.removeEventListener('pointerdown', onPointer, true)
    doc.removeEventListener('keydown', onKey, true)
    delete root.dataset.input
  }
}
