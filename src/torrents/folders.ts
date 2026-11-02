import type { SaveLocations } from '../api/qbittorrent'

const ABSOLUTE = /^([/\\]|[A-Za-z]:[/\\])/
// What qBittorrent's Utils::Fs::toValidPath replaces in a category name used as a folder.
const INVALID = /[:?"*<>|]+/g

/** A full path qBittorrent can take as it is: from the root, or from a drive on Windows. */
export function isAbsolute(path: string): boolean {
  return ABSOLUTE.test(path)
}

/**
 * Joins a relative path to a folder with the folder's own separator. Windows paths use \, which
 * elsewhere is an ordinary character in a folder's name.
 */
function join(folder: string, path: string): string {
  const windows = folder.includes('\\') && !folder.includes('/')
  const separator = windows ? '\\' : '/'
  return `${folder.replace(/[/\\]+$/, '')}${separator}${path.split(windows ? /[/\\]+/ : /\/+/).join(separator)}`
}

/**
 * Where qBittorrent keeps a category's torrents, following its Session::categorySavePath: the
 * category's path when absolute, else that path under the default save path; without a path, the
 * category's name made valid, under the default save path or, with subcategories, under the
 * parent's folder. Empty when that can't be known.
 */
export function categoryFolder(name: string, locations: SaveLocations): string {
  const path = locations.categories.find((category) => category.name === name)?.savePath
  if (path && isAbsolute(path)) return path
  let base = locations.defaultPath
  let relative = path
  if (!relative) {
    const parent = name.lastIndexOf('/')
    if (locations.subcategories && parent > 0) {
      base = categoryFolder(name.slice(0, parent), locations)
      relative = name.slice(parent + 1).replace(INVALID, ' ')
    } else {
      relative = name.replace(INVALID, ' ')
    }
  }
  return base ? join(base, relative) : ''
}

/** Where a torrent added with `category` (or none) goes when Kinoseed sends no save path. */
export function addFolder(category: string, locations: SaveLocations): string {
  if (!category || !locations.categoryPaths) return locations.defaultPath
  return categoryFolder(category, locations) || locations.defaultPath
}

/** The default save path, then each category's folder, without empties or repeats. */
export function knownFolders(locations: SaveLocations): string[] {
  const folders: string[] = []
  const seen = new Set<string>()
  const all = [locations.defaultPath, ...locations.categories.map((category) => categoryFolder(category.name, locations))]
  for (const folder of all) {
    if (!folder || seen.has(sameFolder(folder))) continue
    seen.add(sameFolder(folder))
    folders.push(folder)
  }
  return folders
}

/** A folder as qBittorrent treats it, for comparing: without a trailing separator. */
export function sameFolder(path: string): string {
  return path.length > 1 ? path.replace(/[/\\]+$/, '') : path
}
