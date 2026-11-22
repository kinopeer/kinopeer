import { describe, expect, it } from 'vitest'
import { MIN_QBITTORRENT_VERSION, MIN_WEBUI_QBITTORRENT_VERSION, isSupportedVersion, subcategoriesUnderParent } from './qbittorrentVersion'

describe('isSupportedVersion', () => {
  it.each(['4.6.0', '4.6.7', '4.6.7.10', '5.0.0', '5.1.0beta1', '4.10.0', '10.0', 'v4.6.0', MIN_QBITTORRENT_VERSION])(
    'takes %s',
    (version) => {
      expect(isSupportedVersion(version)).toBe(true)
    },
  )

  it.each(['4.5.5', '4.5.99', '4.1.0', '4', '3.3.16', '4.5.5.10', '4.5.0beta1'])('refuses %s', (version) => {
    expect(isSupportedVersion(version)).toBe(false)
  })

  it('lets through a version it can’t read rather than refuse a working qBittorrent', () => {
    expect(isSupportedVersion('')).toBe(true)
    expect(isSupportedVersion('dev')).toBe(true)
    expect(isSupportedVersion('r4.5.0')).toBe(true)
  })

  it.each(['5.2.0', '5.2.1', '5.3.0', '6.0', MIN_WEBUI_QBITTORRENT_VERSION])('takes %s as the WebUI build’s minimum', (version) => {
    expect(isSupportedVersion(version, MIN_WEBUI_QBITTORRENT_VERSION)).toBe(true)
  })

  it.each(['5.1.4', '5.1.0', '5.0.0', '4.6.7', '5.1.99.1'])('refuses %s below the WebUI build’s minimum', (version) => {
    expect(isSupportedVersion(version, MIN_WEBUI_QBITTORRENT_VERSION)).toBe(false)
  })
})

describe('subcategoriesUnderParent', () => {
  it('follows the setting from qBittorrent 5.0', () => {
    expect(subcategoriesUnderParent('5.0.0', true)).toBe(true)
    expect(subcategoriesUnderParent('5.1.4', false)).toBe(false)
  })

  it('never puts them under the parent before 5.0, whatever the setting', () => {
    expect(subcategoriesUnderParent('4.6.7', true)).toBe(false)
    expect(subcategoriesUnderParent('4.99', undefined)).toBe(false)
  })

  it('takes a setting qBittorrent no longer reports as on, as 5.2 always has it', () => {
    expect(subcategoriesUnderParent('5.2.0', undefined)).toBe(true)
  })

  it('counts a version it doesn’t know as 5.x', () => {
    expect(subcategoriesUnderParent(undefined, true)).toBe(true)
    expect(subcategoriesUnderParent(undefined, false)).toBe(false)
    expect(subcategoriesUnderParent('dev', true)).toBe(true)
  })
})
