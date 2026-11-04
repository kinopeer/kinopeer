import { describe, expect, it } from 'vitest'
import type { SaveLocations } from '../api/qbittorrent'
import { torrent } from '../test/fixtures'
import { categoryChange, withCategory } from './categoryChange'

const LOCATIONS: SaveLocations = {
  categories: [
    { name: 'Movies', savePath: '/downloads/movies' },
    { name: 'TV Shows', savePath: '' },
  ],
  defaultPath: '/downloads',
  categoryPaths: true,
  subcategories: false,
  relocateOnCategoryChange: true,
}

const AUTO = torrent('auto', { auto_tmm: true, category: 'Movies', save_path: '/downloads/movies' })

describe('categoryChange', () => {
  it('moves the files of a torrent under automatic management to the new category’s folder', () => {
    expect(categoryChange(AUTO, 'TV Shows', LOCATIONS)).toEqual({ kind: 'move', folder: '/downloads/TV Shows' })
  })

  it('moves them to the default save path when the category is taken off', () => {
    expect(categoryChange(AUTO, '', LOCATIONS)).toEqual({ kind: 'move', folder: '/downloads' })
  })

  it('leaves them where they are when that is the new category’s folder already', () => {
    const elsewhere = { ...AUTO, category: 'Old', save_path: '/downloads/movies/' }
    expect(categoryChange(elsewhere, 'Movies', LOCATIONS)).toEqual({ kind: 'stay', folder: '/downloads/movies/' })
  })

  it('turns automatic management off instead when qBittorrent is set not to relocate', () => {
    expect(categoryChange(AUTO, 'TV Shows', { ...LOCATIONS, relocateOnCategoryChange: false })).toEqual({
      kind: 'toManual',
      folder: '/downloads/movies',
    })
  })

  it('moves nothing for a torrent in manual mode, whatever qBittorrent’s preferences', () => {
    const manual = torrent('manual', { save_path: '/media' })
    expect(categoryChange(manual, 'TV Shows', LOCATIONS)).toEqual({ kind: 'manual', folder: '/media' })
    expect(categoryChange(manual, 'TV Shows', { ...LOCATIONS, relocateOnCategoryChange: false })).toEqual({
      kind: 'manual',
      folder: '/media',
    })
  })

  it('says a move without the folder when qBittorrent’s default save path is unknown', () => {
    expect(categoryChange(AUTO, 'TV Shows', { ...LOCATIONS, defaultPath: '' })).toEqual({ kind: 'move', folder: '' })
  })
})

describe('withCategory', () => {
  it('gives the torrent the category and, when it moves, the new folder', () => {
    expect(withCategory(AUTO, 'TV Shows', { kind: 'move', folder: '/downloads/TV Shows' })).toEqual({
      ...AUTO,
      category: 'TV Shows',
      save_path: '/downloads/TV Shows',
    })
  })

  it('keeps the folder of a move whose folder is unknown, until the poll has it', () => {
    expect(withCategory(AUTO, 'TV Shows', { kind: 'move', folder: '' })).toEqual({ ...AUTO, category: 'TV Shows' })
  })

  it('turns automatic management off when qBittorrent does', () => {
    expect(withCategory(AUTO, 'TV Shows', { kind: 'toManual', folder: AUTO.save_path })).toEqual({
      ...AUTO,
      category: 'TV Shows',
      auto_tmm: false,
    })
  })

  it('changes only the category of a torrent whose files stay', () => {
    expect(withCategory(AUTO, '', { kind: 'stay', folder: AUTO.save_path })).toEqual({ ...AUTO, category: '' })
  })
})
