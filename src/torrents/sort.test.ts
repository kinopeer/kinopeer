import { describe, expect, it } from 'vitest'
import type { Torrent } from '../api/qbittorrent'
import { compareTorrents, knownSort, type DownloadSort } from './sort'

const make = (hash: string, fields: Partial<Torrent>) =>
  ({
    hash,
    name: hash,
    state: 'downloading',
    progress: 0,
    size: 0,
    dlspeed: 0,
    upspeed: 0,
    eta: 8_640_000,
    priority: -1,
    added_on: 0,
    ...fields,
  }) as Torrent

const order = (sort: DownloadSort, torrents: Torrent[], titleOf = (torrent: Torrent) => torrent.name) =>
  [...torrents].sort(compareTorrents(sort, titleOf)).map((torrent) => torrent.hash)

describe('compareTorrents', () => {
  it('keeps the queue order for priority', () => {
    const torrents = [make('old', { added_on: 1 }), make('q2', { priority: 2 }), make('q1', { priority: 1 })]
    expect(order('priority', torrents)).toEqual(['q1', 'q2', 'old'])
  })

  it('puts the newest first for date added', () => {
    const torrents = [make('a', { added_on: 1 }), make('b', { added_on: 3 }), make('c', { added_on: 2 })]
    expect(order('added', torrents)).toEqual(['b', 'c', 'a'])
  })

  it('orders by the shown title, ignoring case and reading numbers as numbers', () => {
    const torrents = [make('s10', {}), make('alien', {}), make('s9', {}), make('dune', {})]
    const titles: Record<string, string> = { s10: 'Season 10', alien: 'alien', s9: 'Season 9', dune: 'Dune' }
    expect(order('name', torrents, (torrent) => titles[torrent.hash])).toEqual(['alien', 'dune', 's9', 's10'])
  })

  it('puts the most progress, the largest and the fastest first', () => {
    const torrents = [
      make('a', { progress: 0.2, size: 3, dlspeed: 100 }),
      make('b', { progress: 0.9, size: 1, dlspeed: 0, upspeed: 50 }),
      make('c', { progress: 0.5, size: 2, dlspeed: 0, upspeed: 10 }),
    ]
    expect(order('progress', torrents)).toEqual(['b', 'c', 'a'])
    expect(order('size', torrents)).toEqual(['a', 'c', 'b'])
    expect(order('speed', torrents)).toEqual(['a', 'b', 'c'])
  })

  it('puts the soonest done first and torrents without a time left last, in queue order', () => {
    const torrents = [
      make('paused', { state: 'stoppedDL', eta: 10, priority: 2 }),
      make('slow', { dlspeed: 10, eta: 3_600 }),
      make('stalled', { eta: 8_640_000, priority: 1 }),
      make('fast', { dlspeed: 1_000, eta: 60 }),
    ]
    expect(order('eta', torrents)).toEqual(['fast', 'slow', 'stalled', 'paused'])
  })

  it('breaks ties in queue order', () => {
    const torrents = [make('new', { added_on: 2 }), make('q1', { priority: 1 }), make('old', { added_on: 1 })]
    expect(order('size', torrents)).toEqual(['q1', 'new', 'old'])
  })
})

describe('knownSort', () => {
  it('falls back to the queue order for a sort that is not offered', () => {
    expect(knownSort('size')).toBe('size')
    expect(knownSort('seeds')).toBe('priority')
    expect(knownSort(undefined)).toBe('priority')
  })
})
