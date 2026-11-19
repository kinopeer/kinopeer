import { describe, expect, it } from 'vitest'
import type { ServerSettings } from '../api/settings'
import { setupSteps } from './useSetupSteps'

/** The server's settings with everything set: the TMDB key, Prowlarr's address from the environment, the login on. */
const SET: ServerSettings = {
  tmdb: { configured: true, source: 'saved', fallback: null },
  prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
  qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
  downloads: null,
  auth: { enabled: true, source: 'saved' },
}
const noProwlarr: ServerSettings['prowlarr'] = { configured: false, source: null, serverKey: false, address: { source: null } }

describe('setupSteps', () => {
  it('asks nothing when the server has a TMDB key and Prowlarr’s address', () => {
    expect(setupSteps(SET)).toEqual([])
    // A saved address is Prowlarr set up, its key too or not: Settings changes it.
    expect(setupSteps({ ...SET, prowlarr: { ...noProwlarr, address: { source: 'saved', url: 'http://prowlarr.test' } } })).toEqual([])
  })

  it('asks for the TMDB key, then Prowlarr, when the server has neither', () => {
    expect(setupSteps({ ...SET, tmdb: { configured: false, source: null, fallback: null }, prowlarr: noProwlarr })).toEqual(['tmdb', 'prowlarr'])
    expect(setupSteps({ ...SET, prowlarr: noProwlarr })).toEqual(['prowlarr'])
  })

  it.each([
    ['Kinopeer’s own login is off', { enabled: false } as const],
    ['the server is older and says nothing of it', undefined],
  ])('asks nothing of Prowlarr when %s, since the server wouldn’t save an address', (_name, auth) => {
    expect(setupSteps({ ...SET, prowlarr: noProwlarr, auth })).toEqual([])
  })
})
