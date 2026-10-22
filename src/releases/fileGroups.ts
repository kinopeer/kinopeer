/** A folder or season of a torrent's files, for the file lists. */
export interface FileGroup {
  /** Stable id: `dir:<folder>`, `season:<n>` or `root`. */
  key: string
  /** Folder name, or '' for a season or files at the top of the torrent. */
  name: string
  /** Season of loose episode files, when the group isn't a folder. */
  season?: number
  /** Path prefix of the group's files, without the trailing slash; '' when none. */
  prefix: string
  /** Indexes into the torrent's file list. */
  files: number[]
  size: number
}

/** "S01E02", "s1.e2" or "1x02" in a file name. */
const EPISODE = /(?<![\p{L}\p{N}])(?:s(\d{1,2})[ ._-]?e\d{1,3}|(\d{1,2})x\d{2,3}(?!\p{N}))/iu

function seasonOf(name: string): number | undefined {
  const match = EPISODE.exec(name)
  const season = match && Number(match[1] ?? match[2])
  return season || undefined
}

/** Folders every file sits in, such as the torrent's own root folder: "Show/" or "Show/Season 1/". */
function commonRoot(paths: string[]): string {
  let root = ''
  for (;;) {
    const slash = paths[0].indexOf('/', root.length)
    if (slash < 0) return root
    const next = paths[0].slice(0, slash + 1)
    if (!paths.every((path) => path.startsWith(next) && path.length > next.length)) return root
    root = next
  }
}

/**
 * Groups files into a tree like the design's file picker, in torrent order: by the first folder below the
 * folders all files share (a series pack usually has one per season), loose episodes by season, and the
 * remaining loose files last. A single group with key `root` means there's nothing to group.
 */
export function groupFiles(files: { path: string; size: number }[]): FileGroup[] {
  if (files.length === 0) return []
  const root = commonRoot(files.map((file) => file.path))
  const groups = new Map<string, FileGroup>()
  files.forEach((file, index) => {
    const path = file.path.slice(root.length)
    const slash = path.indexOf('/')
    const season = slash < 0 && files.length > 1 ? seasonOf(path) : undefined
    const group =
      slash >= 0
        ? { key: `dir:${path.slice(0, slash)}`, name: path.slice(0, slash), prefix: root + path.slice(0, slash) }
        : season !== undefined
          ? { key: `season:${season}`, name: '', season, prefix: root.slice(0, -1) }
          : { key: 'root', name: '', prefix: root.slice(0, -1) }
    const existing = groups.get(group.key) ?? { ...group, files: [], size: 0 }
    existing.files.push(index)
    existing.size += file.size
    groups.set(group.key, existing)
  })
  const loose = groups.get('root')
  groups.delete('root')
  return loose ? [...groups.values(), loose] : [...groups.values()]
}

/** The file's path inside its group. */
export function fileLabel(path: string, group: FileGroup): string {
  return group.prefix ? path.slice(group.prefix.length + 1) : path
}
