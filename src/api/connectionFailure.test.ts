import { describe, expect, it } from 'vitest'
import { CONNECTION_FAILURES, failureOf, knownFailure } from './connectionFailure'
import { ProwlarrError } from './prowlarr'
import { QbittorrentError } from './qbittorrent'
import { SettingsError } from './settings'

describe('knownFailure', () => {
  it('takes each cause this app knows, and nothing else', () => {
    for (const failure of CONNECTION_FAILURES) expect(knownFailure(failure)).toBe(failure)
    for (const value of ['solar-flare', 'REFUSED', '', null, undefined, 3]) expect(knownFailure(value), String(value)).toBeUndefined()
  })
})

describe('failureOf', () => {
  it('reads the cause each API client’s error carries', () => {
    expect(failureOf(new SettingsError(502, 'unreachable', 'refused'))).toBe('refused')
    expect(failureOf(new QbittorrentError('down', 502, 'timeout'))).toBe('timeout')
    expect(failureOf(new ProwlarrError('down', 502, 'unreachable', 'name'))).toBe('name')
  })

  it('reads none from an error without one, or that isn’t an error', () => {
    expect(failureOf(new SettingsError(502, 'unreachable'))).toBeUndefined()
    expect(failureOf(new TypeError('Failed to fetch'))).toBeUndefined()
    expect(failureOf(Object.assign(new Error('x'), { failure: 'solar-flare' }))).toBeUndefined()
    expect(failureOf({ failure: 'refused' })).toBeUndefined()
  })
})
