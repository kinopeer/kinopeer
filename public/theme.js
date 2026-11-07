// Applies the saved theme before first paint, so a light theme doesn't flash dark first. Mirrors
// src/theme/theme.ts. A file of its own rather than inline in index.html, since the
// Content-Security-Policy (server/securityHeaders.ts) runs no inline script.
try {
  var preference = localStorage.getItem('kinopeer.theme')
  var light = preference === 'light' || (preference !== 'dark' && matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.dataset.theme = light ? 'light' : 'dark'
  document.querySelector('meta[name="theme-color"]').content = light ? '#f3f5f5' : '#0e1113'
} catch {
  // No storage or matchMedia: the app applies the theme itself as it starts.
}
