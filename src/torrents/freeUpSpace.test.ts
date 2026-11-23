import { describe, expect, it } from 'vitest'
import { GB, torrent } from '../test/fixtures'
import {
  DEFAULT_FREE_UP_ORDER,
  countedSpace,
  estimatedFreeSpace,
  groupForFreeUp,
  isUnder,
  knownFreeUpOrder,
  onDisk,
  withFreed,
} from './freeUpSpace'

describe('onDisk', () => {
  it('is the part of the selected size qBittorrent has', () => {
    expect(onDisk({ size: 10 * GB, progress: 1 })).toBe(10 * GB)
    expect(onDisk({ size: 10 * GB, progress: 0.25 })).toBe(2.5 * GB)
    expect(onDisk({ size: 10 * GB, progress: 0 })).toBe(0)
  })
})

describe('isUnder', () => {
  it('takes the folder itself and what is under it', () => {
    expect(isUnder('/downloads', '/downloads')).toBe(true)
    expect(isUnder('/downloads/', '/downloads')).toBe(true)
    expect(isUnder('/downloads/Movies', '/downloads/')).toBe(true)
    expect(isUnder('/downloads', '/downloads/')).toBe(true)
    expect(isUnder('/downloads', '/downloads//')).toBe(true)
  })

  it('leaves out a folder whose name only starts the same', () => {
    expect(isUnder('/downloads2/Movies', '/downloads')).toBe(false)
    expect(isUnder('/mnt/media', '/downloads')).toBe(false)
  })

  it('reads Windows separators as slashes', () => {
    expect(isUnder('D:\\Torrents\\Movies', 'D:/Torrents')).toBe(true)
    expect(isUnder('D:/Torrents/Movies\\', 'D:\\Torrents\\')).toBe(true)
    expect(isUnder('E:\\Torrents', 'D:\\Torrents')).toBe(false)
  })

  it('takes everything under the root', () => {
    expect(isUnder('/mnt/media', '/')).toBe(true)
  })

  it('takes nothing when there is no default save path', () => {
    expect(isUnder('/downloads', '')).toBe(false)
  })

  it('counts letters’ case', () => {
    expect(isUnder('/Downloads/Movies', '/downloads')).toBe(false)
  })
})

describe('knownFreeUpOrder', () => {
  it('keeps a stored sort and direction', () => {
    expect(knownFreeUpOrder('ratio', false)).toEqual({ key: 'ratio', descending: false })
  })

  it('gives a sort stored without a direction its usual one', () => {
    expect(knownFreeUpOrder('added', undefined)).toEqual({ key: 'added', descending: false })
    expect(knownFreeUpOrder('ratio', 'yes')).toEqual({ key: 'ratio', descending: true })
  })

  it('falls back to the largest first for a sort it doesn’t offer', () => {
    expect(knownFreeUpOrder('speed', true)).toEqual(DEFAULT_FREE_UP_ORDER)
    expect(knownFreeUpOrder(undefined, undefined)).toEqual({ key: 'size', descending: true })
  })
})

describe('groupForFreeUp', () => {
  const big = torrent('big', { name: 'Big', size: 40 * GB, progress: 1, save_path: '/downloads/Movies', added_on: 3, ratio: 0.5 })
  const half = torrent('half', { name: 'Half', size: 60 * GB, progress: 0.5, save_path: '/downloads', added_on: 1, ratio: 2 })
  const small = torrent('small', { name: 'Small', size: 2 * GB, progress: 1, save_path: '/downloads/TV', added_on: 2, ratio: 1 })
  const other = torrent('other', { name: 'Other', size: 90 * GB, progress: 1, save_path: '/mnt/archive', added_on: 0, ratio: 3 })
  const all = [small, other, half, big]
  const hashes = (list: { hash: string }[]) => list.map((item) => item.hash)

  it('counts the torrents under the default save path, the rest elsewhere', () => {
    const groups = groupForFreeUp(all, '/downloads', DEFAULT_FREE_UP_ORDER)
    expect(hashes(groups.counted)).toEqual(['big', 'half', 'small'])
    expect(hashes(groups.elsewhere)).toEqual(['other'])
  })

  it('sorts by what is on disk, not by the selected size', () => {
    // Half is the larger torrent, but has only 30 GB of it.
    expect(hashes(groupForFreeUp(all, '/downloads', { key: 'size', descending: true }).counted)).toEqual(['big', 'half', 'small'])
    expect(hashes(groupForFreeUp(all, '/downloads', { key: 'size', descending: false }).counted)).toEqual(['small', 'half', 'big'])
  })

  it('sorts by date added and by ratio', () => {
    expect(hashes(groupForFreeUp(all, '/downloads', { key: 'added', descending: false }).counted)).toEqual(['half', 'small', 'big'])
    expect(hashes(groupForFreeUp(all, '/downloads', { key: 'ratio', descending: true }).counted)).toEqual(['half', 'small', 'big'])
  })

  it('breaks ties by name', () => {
    const a = torrent('a', { name: 'Alpha 10', size: GB, progress: 1, save_path: '/downloads' })
    const b = torrent('b', { name: 'Alpha 9', size: GB, progress: 1, save_path: '/downloads' })
    expect(hashes(groupForFreeUp([a, b], '/downloads', DEFAULT_FREE_UP_ORDER).counted)).toEqual(['b', 'a'])
    expect(hashes(groupForFreeUp([b, a], '/downloads', DEFAULT_FREE_UP_ORDER).counted)).toEqual(['b', 'a'])
  })

  it('puts everything elsewhere when the default save path isn’t known', () => {
    const groups = groupForFreeUp(all, '', DEFAULT_FREE_UP_ORDER)
    expect(groups.counted).toEqual([])
    expect(hashes(groups.elsewhere)).toEqual(['other', 'big', 'half', 'small'])
  })
})

describe('countedSpace', () => {
  const torrents = [
    torrent('a', { size: 10 * GB, progress: 1, save_path: '/downloads' }),
    torrent('b', { size: 8 * GB, progress: 0.5, save_path: '/downloads/TV' }),
    torrent('c', { size: 5 * GB, progress: 1, save_path: '/mnt/archive' }),
  ]

  it('adds what the torrents under the default save path have on disk', () => {
    expect(countedSpace(torrents, '/downloads')).toBe(14 * GB)
    expect(countedSpace([], '/downloads')).toBe(0)
  })

  it('counts nothing while the default save path isn’t known', () => {
    expect(countedSpace(torrents, undefined)).toBe(0)
  })
})

describe('the free space after deleting', () => {
  it('holds what was freed against the figure it was freed from', () => {
    const held = withFreed(undefined, 4 * GB, 10 * GB)
    expect(held).toEqual({ reported: 4 * GB, freed: 10 * GB })
    expect(estimatedFreeSpace(held, 4 * GB)).toEqual({ free: 14 * GB, estimate: true })
  })

  it('adds a second delete before qBittorrent measures again', () => {
    const held = withFreed(withFreed(undefined, 4 * GB, 10 * GB), 4 * GB, 3 * GB)
    expect(estimatedFreeSpace(held, 4 * GB)).toEqual({ free: 17 * GB, estimate: true })
  })

  it('shows qBittorrent’s own figure once it reports another', () => {
    const held = withFreed(undefined, 4 * GB, 10 * GB)
    expect(estimatedFreeSpace(held, 13 * GB)).toEqual({ free: 13 * GB, estimate: false })
  })

  it('holds a delete after a new figure from that figure alone', () => {
    const held = withFreed(withFreed(undefined, 4 * GB, 10 * GB), 13 * GB, 2 * GB)
    expect(held).toEqual({ reported: 13 * GB, freed: 2 * GB })
  })

  it('holds nothing when qBittorrent can’t tell the free space, or nothing was freed', () => {
    expect(withFreed(undefined, undefined, 10 * GB)).toBeUndefined()
    expect(withFreed(undefined, 4 * GB, 0)).toBeUndefined()
    expect(estimatedFreeSpace(undefined, undefined)).toEqual({ free: undefined, estimate: false })
    expect(estimatedFreeSpace({ reported: 4 * GB, freed: GB }, undefined)).toEqual({ free: undefined, estimate: false })
  })

  it('keeps what is held through a delete that freed nothing where it counts', () => {
    const held = withFreed(withFreed(undefined, 4 * GB, 10 * GB), 4 * GB, 0)
    expect(held).toEqual({ reported: 4 * GB, freed: 10 * GB })
  })
})
