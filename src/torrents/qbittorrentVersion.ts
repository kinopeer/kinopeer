// Which qBittorrent versions Kinopeer works with, and what differs between the ones it does.

/**
 * The oldest qBittorrent whose Web API has every call and field Kinopeer uses: 4.6.0 added
 * `addToTopOfQueue` to `torrents/add`, the newest of them (4.5 `stopCondition`, 4.4 the categories'
 * `download_path` and category paths in manual mode, 4.3.5 the files' `index`). The 4.x names of
 * what 5.0 renamed (pause and resume, the paused states) are handled where they're used.
 */
export const MIN_QBITTORRENT_VERSION = '4.6.0'

/**
 * The oldest qBittorrent the WebUI build works with: 5.2.0 added the `clientdata` store, which holds
 * the settings and the torrent-to-title matches there in place of Kinopeer's server.
 */
export const MIN_WEBUI_QBITTORRENT_VERSION = '5.2.0'

/**
 * A version's numbers, e.g. [5, 0, 4] for "5.0.4", [4, 6, 7, 10] for "4.6.7.10" and [5, 1, 0] for
 * "5.1.0beta1"; undefined when it doesn't start with one.
 */
function numbers(version: string | undefined): number[] | undefined {
  const match = version === undefined ? null : /^v?(\d+(?:\.\d+)*)/.exec(version)
  return match ? match[1].split('.').map(Number) : undefined
}

/** Whether `version` is `min` or later; undefined when either can't be read. */
function atLeast(version: string | undefined, min: string): boolean | undefined {
  const have = numbers(version)
  const need = numbers(min)
  if (!have || !need) return undefined
  for (let i = 0; i < Math.max(have.length, need.length); i++) {
    const a = have[i] ?? 0
    const b = need[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

/**
 * Whether Kinopeer works with this qBittorrent, `minimum` or later (the WebUI build's is
 * `MIN_WEBUI_QBITTORRENT_VERSION`). A version it can't read (a build of qBittorrent's own) is let
 * through: only a version known to be too old is refused.
 */
export function isSupportedVersion(version: string, minimum = MIN_QBITTORRENT_VERSION): boolean {
  return atLeast(version, minimum) !== false
}

/**
 * Whether a subcategory without a path of its own goes under its parent's folder. qBittorrent 5.0
 * started doing so with subcategories on (`use_subcategories`); before, it went under the default
 * save path by its whole name either way. 5.2 always has them on and stopped reporting the setting,
 * so a setting not reported means on. A version not known (it didn't answer) counts as 5.x.
 */
export function subcategoriesUnderParent(version: string | undefined, setting: boolean | undefined): boolean {
  if (atLeast(version, '5.0') === false) return false
  return setting ?? true
}
