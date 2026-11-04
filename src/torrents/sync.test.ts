import { describe, expect, it } from 'vitest'
import type { MainData } from '../api/qbittorrent'
import { EMPTY_SYNC_STATE, applyMainData } from './sync'

describe('applyMainData', () => {
  const full = applyMainData(EMPTY_SYNC_STATE, {
    rid: 1,
    full_update: true,
    torrents: { a: { name: 'A', progress: 0.1 }, b: { name: 'B', progress: 1 } },
    server_state: { dl_info_speed: 100, free_space_on_disk: 5 },
  })

  it('builds the state from a full update', () => {
    expect(full.rid).toBe(1)
    expect(full.torrents.a).toEqual({ hash: 'a', name: 'A', progress: 0.1 })
    expect(full.server).toEqual({ dl_info_speed: 100, free_space_on_disk: 5 })
  })

  it('merges partial changes and removals', () => {
    const next = applyMainData(full, {
      rid: 2,
      torrents: { a: { progress: 0.2 }, c: { name: 'C' } },
      torrents_removed: ['b'],
      server_state: { dl_info_speed: 200 },
    })
    expect(next.torrents).toEqual({
      a: { hash: 'a', name: 'A', progress: 0.2 },
      c: { hash: 'c', name: 'C' },
    })
    expect(next.server).toEqual({ dl_info_speed: 200, free_space_on_disk: 5 })
    expect(full.torrents.a.progress).toBe(0.1)
  })

  it('drops everything not in a new full update', () => {
    const next = applyMainData(full, { rid: 9, full_update: true, torrents: { c: { name: 'C' } } })
    expect(Object.keys(next.torrents)).toEqual(['c'])
    expect(next.server).toEqual({})
  })
})

describe('applyMainData and the fields the app reads', () => {
  const full = applyMainData(EMPTY_SYNC_STATE, {
    rid: 1,
    full_update: true,
    torrents: {
      a: { name: 'A', progress: 0.1, dlspeed: 100, time_active: 10, magnet_uri: 'magnet:?xt=a' },
      b: { name: 'B', progress: 1, upspeed: 5, seeding_time: 20 },
    } as MainData['torrents'],
  })

  it('keeps only the fields the app reads', () => {
    expect(full.torrents.a).toEqual({ hash: 'a', name: 'A', progress: 0.1, dlspeed: 100 })
    expect(full.torrents.b).toEqual({ hash: 'b', name: 'B', progress: 1, upspeed: 5 })
  })

  it('keeps a torrent’s object when only fields the app doesn’t read changed, or those it reads came back the same', () => {
    const next = applyMainData(full, {
      rid: 2,
      torrents: {
        a: { time_active: 12, reannounce: 1700, popularity: 0.2 },
        b: { seeding_time: 22, progress: 1, upspeed: 5 },
      } as MainData['torrents'],
    })
    expect(next.torrents.a).toBe(full.torrents.a)
    expect(next.torrents.b).toBe(full.torrents.b)
  })

  it('gives a torrent a new object when a field the app reads changed, leaving the old one as it was', () => {
    const next = applyMainData(full, {
      rid: 2,
      torrents: { a: { dlspeed: 200, time_active: 12 } } as MainData['torrents'],
    })
    expect(next.torrents.a).toEqual({ hash: 'a', name: 'A', progress: 0.1, dlspeed: 200 })
    expect(full.torrents.a.dlspeed).toBe(100)
    expect(next.torrents.b).toBe(full.torrents.b)
  })

  it('adds a torrent that comes only with fields the app doesn’t read, by its hash', () => {
    const next = applyMainData(full, { rid: 2, torrents: { c: { time_active: 1 } } as MainData['torrents'] })
    expect(next.torrents.c).toEqual({ hash: 'c' })
  })
})
