/**
 * The desktop layout's breakpoint, from the design system's README: from this width up a sidebar
 * replaces the tab bar (an icon rail up to 1100px, then with labels). CSS can't import it (nor use
 * custom properties in media queries), so stylesheets repeat it as `@media (min-width: 1024px)`.
 */
export const DESKTOP_MIN_WIDTH = 1024

export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`
