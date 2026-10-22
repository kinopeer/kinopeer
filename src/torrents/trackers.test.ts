import { describe, expect, it } from 'vitest'
import { trackerHosts } from './trackers'

describe('trackerHosts', () => {
  it('lists unique host names without pseudo-trackers', () => {
    expect(
      trackerHosts([
        { url: '** [PeX] **', status: 2, msg: '' },
        { url: 'http://a.example/announce', status: 2, msg: '' },
        { url: 'udp://a.example:80', status: 2, msg: '' },
        { url: 'not a url', status: 4, msg: '' },
      ]),
    ).toEqual(['a.example', 'not a url'])
  })
})
