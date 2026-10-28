import type { Category } from '../api/qbittorrent'

const ABSOLUTE = /^([/\\]|[A-Za-z]:[/\\])/

/**
 * Where qBittorrent puts a category's torrents: its path when absolute, else that path (or, with no
 * path, the category's name) under the default save path. Empty when that can't be known.
 */
export function categoryFolder(category: Category, defaultPath: string): string {
  const path = category.savePath || category.name
  if (ABSOLUTE.test(path)) return path
  if (!defaultPath) return ''
  const separator = defaultPath.includes('\\') && !defaultPath.includes('/') ? '\\' : '/'
  return `${defaultPath.replace(/[/\\]+$/, '')}${separator}${path}`
}

/** The default save path, then each category's folder, without empties or repeats. */
export function knownFolders(categories: Category[], defaultPath: string): string[] {
  const folders: string[] = []
  const seen = new Set<string>()
  for (const folder of [defaultPath, ...categories.map((category) => categoryFolder(category, defaultPath))]) {
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
