/** A folder of a torrent, for the file lists. */
export interface FileFolder {
  name: string
  /** Path from the torrent's top, without a trailing slash: a stable key. */
  path: string
  /** Subfolders, by name. */
  folders: FileFolder[]
  /** Indexes into the torrent's file list of the files directly in this folder, by name. */
  files: number[]
  /** Indexes of every file below this folder. */
  all: number[]
  size: number
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * The torrent's folders as they are in it, with no regrouping. When everything sits in one folder (the
 * torrent's own, named like the release), the tree starts inside it: the name is shown elsewhere and the extra
 * level only costs width. Folders and files are sorted by name, numbers by value ("Season 2" before
 * "Season 10"), like qBittorrent's own file list: a .torrent's order can be anything.
 */
export function buildFileTree(files: { path: string; size: number }[]): FileFolder {
  const top: FileFolder = { name: '', path: '', folders: [], files: [], all: [], size: 0 }
  const byPath = new Map<string, FileFolder>([['', top]])
  files.forEach((file, index) => {
    const parts = file.path.split('/')
    let folder = top
    folder.all.push(index)
    folder.size += file.size
    for (const name of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${name}` : name
      let child = byPath.get(path)
      if (!child) {
        child = { name, path, folders: [], files: [], all: [], size: 0 }
        folder.folders.push(child)
        byPath.set(path, child)
      }
      folder = child
      folder.all.push(index)
      folder.size += file.size
    }
    folder.files.push(index)
  })
  const name = (index: number) => fileName(files[index].path)
  const sort = (folder: FileFolder) => {
    folder.folders.sort((a, b) => byName.compare(a.name, b.name))
    folder.files.sort((a, b) => byName.compare(name(a), name(b)))
    folder.folders.forEach(sort)
  }
  sort(top)
  return top.folders.length === 1 && top.files.length === 0 ? { ...top.folders[0], name: '' } : top
}

/** Folders to show expanded at first: a single top folder, so its contents are visible. */
export function initiallyOpen(top: FileFolder): Set<string> {
  return new Set(top.folders.length === 1 && top.files.length === 0 ? [top.folders[0].path] : [])
}

/** The file's name without its folders. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
