// Which modules are places that name a failed link (#600): every module that reads who failed has
// its check (`namesTheFailedLink`, ./failedLinks.ts) in a test file, or a reason here why it has
// none, so a new place can't go unchecked (docs/TESTING.md → Places that name a failed link).
import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSync } from 'vite'

/**
 * What reading who failed takes: the reading itself (`unreachable`, `unreachableText`), the
 * clients' failures a place tells apart, and the states that show one. A module that imports one of
 * them by name, as a value, is read as a place.
 */
const READERS = new Set([
  'unreachable',
  'unreachableText',
  'qbtFailedText',
  'KinopeerUnreachableError',
  'QbittorrentError',
  'TmdbError',
  'TmdbKeyError',
  'TmdbKeyReadError',
  'ProwlarrError',
  'ProwlarrSetupError',
  'ProwlarrKeyReadError',
  'UnreachableState',
  'TmdbFailedState',
  'StoreUnreadState',
])

/** Each place, by its module, and the test file that runs its check. */
const PLACES: Record<string, string> = {
  // The confirmations and sheets of torrent actions, checked through the hooks that show them.
  'src/screens/CategorySheet.tsx': 'src/screens/useChangeCategory.test.tsx',
  'src/screens/DeleteTorrentDialog.tsx': 'src/screens/useDeleteTorrents.test.tsx',
  'src/screens/MediaNamesSheet.tsx': 'src/screens/useMediaNames.test.tsx',
  'src/screens/RecheckDialog.tsx': 'src/screens/useRecheck.test.tsx',
  'src/screens/SpeedLimitsSheet.tsx': 'src/screens/useSpeedLimits.test.tsx',
  'src/screens/TorrentActionsSheet.tsx': 'src/screens/TorrentActionsSheet.test.tsx',
  // The torrent actions' toasts.
  'src/screens/useChangeCategory.tsx': 'src/screens/useChangeCategory.test.tsx',
  'src/screens/useDeleteTorrents.tsx': 'src/screens/useDeleteTorrents.test.tsx',
  'src/screens/useDownloadToggle.ts': 'src/screens/useDownloadToggle.test.tsx',
  'src/screens/useNotifyToggle.ts': 'src/screens/useNotifyToggle.test.tsx',
  'src/screens/usePauseResume.ts': 'src/screens/usePauseResume.test.tsx',
  'src/screens/useReannounce.ts': 'src/screens/useReannounce.test.tsx',
  'src/screens/useRecheck.tsx': 'src/screens/useRecheck.test.tsx',
  'src/components/Sidebar/SidebarStatus.tsx': 'src/components/Sidebar/Sidebar.test.tsx',
  'src/screens/AddReleaseSheet.tsx': 'src/screens/AddReleaseSheet.test.tsx',
  'src/screens/ChangeTitleSheet.tsx': 'src/screens/ChangeTitleSheet.test.tsx',
  'src/screens/ConnectScreen.tsx': 'src/screens/ConnectScreen.test.tsx',
  'src/screens/DownloadsScreen.tsx': 'src/screens/DownloadsScreen.test.tsx',
  // Move files and the folders' saves say it; Move files' check runs it, and the folders' checks too.
  'src/screens/folderFailure.ts': 'src/screens/useMoveTorrent.test.tsx',
  'src/screens/FoldersSheet.tsx': 'src/screens/FoldersSheet.test.tsx',
  'src/screens/FreeUpSpace.tsx': 'src/screens/FreeUpSpace.test.tsx',
  // Downloads and the torrent's page show it; Downloads' check runs it through the poll.
  'src/screens/OfflineBanner.tsx': 'src/screens/DownloadsScreen.test.tsx',
  'src/screens/PollRing.tsx': 'src/screens/PollRing.test.tsx',
  'src/screens/QbittorrentInterfaceDialog.tsx': 'src/screens/QbittorrentInterfaceDialog.test.tsx',
  // With what `useReleases` reads from the search, on the phone's releases and the desktop title page alike.
  'src/screens/ReleasesBlock.tsx': 'src/screens/ReleasesScreen.test.tsx',
  'src/screens/ReleasesScreen.tsx': 'src/screens/ReleasesScreen.test.tsx',
  'src/screens/SearchScreen.tsx': 'src/screens/SearchScreen.test.tsx',
  'src/screens/SettingsScreen.tsx': 'src/screens/SettingsScreen.test.tsx',
  'src/screens/TitleScreen.tsx': 'src/screens/TitleScreen.test.tsx',
  'src/screens/TorrentDetails.tsx': 'src/screens/TorrentScreen.test.tsx',
  'src/screens/WebuiConnectScreen.tsx': 'src/screens/WebuiConnectScreen.test.tsx',
}

/** The modules that read who failed but show nothing of it themselves, and why. */
const NOT_PLACES: Record<string, string> = {
  'src/api/prowlarr/client.ts': 'a client: what it throws is a row of WAYS',
  'src/api/prowlarr/direct.ts': 'a client: what it throws is a row of WAYS',
  'src/api/qbittorrent/client.ts': 'a client: what it throws is a row of WAYS',
  'src/api/qbittorrent/transport.ts': 'a client: what it throws is a row of WAYS',
  'src/api/qbittorrent/webui.ts': 'a client: what it throws is a row of WAYS',
  'src/api/tmdb/transport.ts': 'a client: what it throws is a row of WAYS',
  'src/lib/unreachable.ts': 'the reading itself (`unreachableText`, `qbtFailedText`), checked through each place that says it',
  'src/releases/addRelease.ts': 'throws what qBittorrent refused; the add sheet says it',
  'src/screens/useReleases.ts': 'reads who failed the search for ReleasesBlock, whose check runs through it',
  'src/session/useQbitSession.ts': 'reads who failed the session check for the connect screens, whose checks give them its reading',
  'src/torrents/useMainData.ts': 'reads who failed the poll for its places, whose checks run through it or give them its reading',
  'src/torrents/useTitleMatches.ts': 'waits out TMDB’s 429 for the titles in Downloads; shows no failure',
  'src/screens/StoreUnreadState.tsx': 'a state the places show, checked through each of them',
  'src/screens/TmdbFailedState.tsx': 'a state the places show, checked through each of them',
  'src/screens/UnreachableState.tsx': 'a state the places show, checked through each of them',
  'src/screens/QbittorrentLoginForm.tsx':
    'saves a login through the settings client, whose failures are the server’s own check of the address (SettingsError’s codes), outside WAYS',
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path) || path.startsWith('src/test/') || path === 'src/test-setup.ts'

/** The names a module imports as values, by the names their modules export them under. */
function importedValues(path: string, source = readFileSync(path, 'utf8')): string[] {
  const { module, errors } = parseSync(path, source)
  expect(errors, path).toEqual([])
  return module.staticImports.flatMap((declaration) =>
    declaration.entries.flatMap((entry) => (!entry.isType && entry.importName.kind === 'Name' ? [entry.importName.name!] : [])),
  )
}

/** Every module of the app that reads who failed. */
function readingModules(): string[] {
  return globSync('src/**/*.{ts,tsx}')
    .filter((path) => !isTest(path) && !path.endsWith('.d.ts'))
    .filter((path) => importedValues(path).some((name) => READERS.has(name)))
    .sort()
}

describe('what the registry reads as importing a reader', () => {
  it.each([
    ['a named import', "import { unreachable } from '../api/qbittorrent'", ['unreachable']],
    ['a named import under another name, by the name it is exported under', "import { unreachable as who } from '../api/qbittorrent'", ['unreachable']],
    ['a default import beside named ones, the named ones only', "import client, { TmdbError } from '../api/tmdb'", ['TmdbError']],
    ['a type-only import', "import type { QbittorrentError } from '../api/qbittorrent'", []],
    ['a type-only name among values', "import { type QbittorrentError, unreachable } from '../api/qbittorrent'", ['unreachable']],
    ['a re-export, which is no import', "export { unreachable } from '../api/qbittorrent'", []],
    // The blind spots (docs/TESTING.md → Places that name a failed link): none in src/ today.
    ['a namespace import', "import * as api from '../api/qbittorrent'", []],
    ['a dynamic import', "const api = await import('../api/qbittorrent')", []],
  ])('%s: %s', (_spelling, source, names) => {
    expect(importedValues('src/screens/Planted.tsx', source)).toEqual(names)
  })
})

describe('the places that name a failed link', () => {
  it('lists every module that reads who failed, as a place with its check or with why it has none, and nothing else', () => {
    expect(readingModules()).toEqual([...Object.keys(PLACES), ...Object.keys(NOT_PLACES)].sort())
  })

  it('runs each place’s check in the test file it names', () => {
    for (const test of new Set(Object.values(PLACES))) {
      expect(importedValues(test), test).toContain('namesTheFailedLink')
    }
  })

  // The two lists' own rows: a module in both would be a place and not one.
  it('keeps a module in one list', () => {
    expect(Object.keys(PLACES).filter((path) => path in NOT_PLACES)).toEqual([])
  })
})
