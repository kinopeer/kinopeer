import { BrowserRouter, HashRouter } from 'react-router'

/**
 * The app's router. The server's build routes by path (`/title/movie/1`), which Kinopeer's server
 * answers with index.html (server/static.ts), so bookmarks and the push notifications' links open
 * their screen. The WebUI build (`__WEBUI__`) routes after `#` (`/#/title/movie/1`): qBittorrent
 * serves only the files the build has, and a path that isn't one gets its error page. A route reads
 * the same in both, so links, `navigate`, the scroll positions and the tabs' places, which take the
 * router's location, need nothing of their own. The other build's router is dropped from each bundle.
 */
export const AppRouter = __WEBUI__ ? HashRouter : BrowserRouter
