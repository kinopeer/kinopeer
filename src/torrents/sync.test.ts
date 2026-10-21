import { describe, expect, it } from 'vitest'
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
