import { describe, expect, it } from 'vitest'
import type { Torrent } from '../api/qbittorrent'
import { DOWNLOAD_SORTS, clickedOrder, compareTorrents, knownOrder, usualOrder, type DownloadSort } from './sort'

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

/** The hashes in `sort`'s order, its usual direction unless `descending` says otherwise. */
const order = (
  sort: DownloadSort,
  torrents: Torrent[],
  { titleOf = (torrent: Torrent) => torrent.name, descending = usualOrder(sort).descending } = {},
) => [...torrents].sort(compareTorrents({ sort, descending }, titleOf)).map((torrent) => torrent.hash)

describe('compareTorrents', () => {
  it('keeps the queue order for priority', () => {
    // Outside the queue qBittorrent reports 0 or -1, so neither is a position.
    const torrents = [
      make('old', { added_on: 1 }),
      make('q2', { priority: 2 }),
      make('q1', { priority: 1 }),
      make('new', { priority: 0, added_on: 2 }),
    ]
    expect(order('priority', torrents)).toEqual(['q1', 'q2', 'new', 'old'])
  })

  it('puts the newest first for date added', () => {
    const torrents = [make('a', { added_on: 1 }), make('b', { added_on: 3 }), make('c', { added_on: 2 })]
    expect(order('added', torrents)).toEqual(['b', 'c', 'a'])
  })

  it('orders by the shown title, ignoring case and reading numbers as numbers', () => {
    const torrents = [make('s10', {}), make('alien', {}), make('s9', {}), make('dune', {})]
    const titles: Record<string, string> = { s10: 'Season 10', alien: 'alien', s9: 'Season 9', dune: 'Dune' }
    expect(order('name', torrents, { titleOf: (torrent) => titles[torrent.hash] })).toEqual(['alien', 'dune', 's9', 's10'])
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

  it('puts what needs attention first for status: errors, then what is still to come in, then what is done', () => {
    const torrents = [
      make('completed', { state: 'stoppedUP', progress: 1 }),
      make('seeding', { state: 'stalledUP', progress: 1 }),
      make('paused', { state: 'stoppedDL' }),
      make('queued', { state: 'queuedDL' }),
      make('checking', { state: 'checkingDL' }),
      make('downloading', { state: 'stalledDL' }),
      make('error', { state: 'missingFiles' }),
    ]
    expect(order('status', torrents)).toEqual(['error', 'downloading', 'checking', 'queued', 'paused', 'seeding', 'completed'])
  })

  it('breaks ties in queue order', () => {
    const torrents = [make('new', { added_on: 2 }), make('q1', { priority: 1 }), make('old', { added_on: 1 })]
    expect(order('size', torrents)).toEqual(['q1', 'new', 'old'])
    // Statuses tie more often than anything: one per torrent, seven in all.
    expect(order('status', torrents)).toEqual(['q1', 'new', 'old'])
  })
})

describe('compareTorrents reversed', () => {
  it('puts the oldest, Z to A, the least progress, the smallest and the slowest first', () => {
    const torrents = [
      make('a', { added_on: 1, progress: 0.2, size: 3, dlspeed: 100 }),
      make('b', { added_on: 3, progress: 0.9, size: 1, dlspeed: 0, upspeed: 50 }),
      make('c', { added_on: 2, progress: 0.5, size: 2, dlspeed: 0, upspeed: 10 }),
    ]
    expect(order('added', torrents, { descending: false })).toEqual(['a', 'c', 'b'])
    expect(order('name', torrents, { descending: true })).toEqual(['c', 'b', 'a'])
    expect(order('progress', torrents, { descending: false })).toEqual(['a', 'c', 'b'])
    expect(order('size', torrents, { descending: false })).toEqual(['b', 'c', 'a'])
    expect(order('speed', torrents, { descending: false })).toEqual(['c', 'b', 'a'])
  })

  it('puts what is done first for status, with ties still in queue order', () => {
    const torrents = [
      make('error', { state: 'error' }),
      make('new', { state: 'uploading', progress: 1, added_on: 2 }),
      make('downloading', {}),
      make('q1', { state: 'uploading', progress: 1, priority: 1 }),
      make('completed', { state: 'pausedUP', progress: 1 }),
    ]
    expect(order('status', torrents, { descending: true })).toEqual(['completed', 'q1', 'new', 'downloading', 'error'])
  })

  it('puts the queue from its last position, then the torrents outside it, newest first', () => {
    const torrents = [
      make('old', { added_on: 1 }),
      make('q1', { priority: 1 }),
      make('new', { added_on: 2 }),
      make('q2', { priority: 2 }),
    ]
    expect(order('priority', torrents, { descending: true })).toEqual(['q2', 'q1', 'new', 'old'])
  })

  it('puts the slowest first and still the torrents without a speed shown last, in queue order', () => {
    const torrents = [
      make('paused', { state: 'stoppedDL', priority: 2 }),
      make('fast', { dlspeed: 1_000 }),
      make('done', { state: 'stoppedUP', progress: 1, priority: 1 }),
      make('stalled', { dlspeed: 0 }),
      make('seeding', { state: 'uploading', progress: 1, upspeed: 50 }),
    ]
    // A downloading torrent at 0 B/s shows "↓ 0 B/s", a value; a paused or finished one shows "—".
    expect(order('speed', torrents, { descending: false })).toEqual(['stalled', 'seeding', 'fast', 'done', 'paused'])
  })

  it('puts the latest done first and still the torrents without a time left last', () => {
    const torrents = [
      make('stalled', { eta: 8_640_000 }),
      make('fast', { dlspeed: 1_000, eta: 60 }),
      make('slow', { dlspeed: 10, eta: 3_600 }),
    ]
    expect(order('eta', torrents, { descending: true })).toEqual(['slow', 'fast', 'stalled'])
  })
})

describe('usualOrder', () => {
  it('gives each sort its usual direction', () => {
    expect(
      Object.fromEntries(DOWNLOAD_SORTS.map((sort) => [sort, usualOrder(sort).descending ? 'descending' : 'ascending'])),
    ).toEqual({
      priority: 'ascending',
      added: 'descending',
      name: 'ascending',
      progress: 'descending',
      status: 'ascending',
      size: 'descending',
      speed: 'descending',
      eta: 'ascending',
    })
  })
})

describe('knownOrder', () => {
  it('keeps a stored sort and direction', () => {
    expect(knownOrder('size', false)).toEqual({ sort: 'size', descending: false })
  })

  it('gives a sort stored without a direction its usual one', () => {
    expect(knownOrder('size', undefined)).toEqual({ sort: 'size', descending: true })
    expect(knownOrder('name', 'up')).toEqual({ sort: 'name', descending: false })
  })

  it('falls back to the queue order, from its first position, for a sort that is not offered', () => {
    expect(knownOrder('seeds', true)).toEqual({ sort: 'priority', descending: false })
    expect(knownOrder(undefined, undefined)).toEqual({ sort: 'priority', descending: false })
  })
})

describe('clickedOrder', () => {
  it('reverses the current sort', () => {
    expect(clickedOrder({ sort: 'size', descending: true }, 'size')).toEqual({ sort: 'size', descending: false })
    expect(clickedOrder({ sort: 'size', descending: false }, 'size')).toEqual({ sort: 'size', descending: true })
  })

  it('takes another sort in its usual direction, whatever the current one is in', () => {
    expect(clickedOrder({ sort: 'name', descending: true }, 'eta')).toEqual({ sort: 'eta', descending: false })
    expect(clickedOrder({ sort: 'name', descending: false }, 'size')).toEqual({ sort: 'size', descending: true })
  })
})
