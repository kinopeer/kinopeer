/**
 * What the screenshot tests feed the mocked server routes (app.ts). The data lives in
 * src/test/fixtures.ts, shared with the jsdom and server tests; only what needs the browser or
 * Playwright stays here.
 */
import { createHash } from 'node:crypto'
import { shogunTorrent as shogunTorrentBytes } from '../src/test/fixtures.ts'

export { GB, GUESSED, LONG_OVERVIEW_ID, NOW, RELEASES, TITLES, TORRENTS, details, mainData, page, torrent, torrentFiles } from '../src/test/fixtures.ts'

/** A .torrent for the Shōgun release, as `route.fulfill` wants it. */
export function shogunTorrent(): Buffer {
  return Buffer.from(shogunTorrentBytes())
}

/**
 * The Shōgun .torrent's info hash, as qBittorrent knows it: the SHA-1 of its bencoded info
 * dictionary, which is the file's last key (bencoded keys are sorted: announce, info), so it runs
 * from after the key to the outer dictionary's closing `e`.
 */
export function shogunInfoHash(): string {
  const bytes = shogunTorrent()
  const info = bytes.subarray(bytes.indexOf('4:info') + '4:info'.length, bytes.length - 1)
  return createHash('sha1').update(info).digest('hex')
}

/**
 * A stand-in poster: a diagonal gradient whose hue comes from the file name, so each title looks
 * different without shipping images. No text, so it renders the same everywhere.
 */
export function posterSvg(path: string): string {
  let hash = 0
  // The file name only, so a title looks the same at every poster size.
  for (const char of path.slice(path.lastIndexOf('/'))) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return `<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513" viewBox="0 0 342 513">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue} 55% 42%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 60% 16%)"/>
</linearGradient></defs>
<rect width="342" height="513" fill="url(#g)"/>
<circle cx="250" cy="150" r="70" fill="hsl(${(hue + 180) % 360} 70% 70% / 0.35)"/>
</svg>`
}
