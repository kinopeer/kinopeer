/** A folder of a torrent's files, for the file picker. */
export interface FileGroup {
  /** Folder name, or '' for files at the top of the torrent. */
  name: string
  /** Indexes into the torrent's file list. */
  files: number[]
  size: number
}

/** Groups files by their top folder (a series pack usually has one per season), in torrent order. */
export function groupFiles(files: { path: string; size: number }[]): FileGroup[] {
  const groups = new Map<string, FileGroup>()
  files.forEach((file, index) => {
    const slash = file.path.indexOf('/')
    const name = slash < 0 ? '' : file.path.slice(0, slash)
    const group = groups.get(name) ?? { name, files: [], size: 0 }
    group.files.push(index)
    group.size += file.size
    groups.set(name, group)
  })
  return [...groups.values()]
}

/** The file's name without the group folder. */
export function fileLabel(path: string, group: FileGroup): string {
  return group.name ? path.slice(group.name.length + 1) : path
}
