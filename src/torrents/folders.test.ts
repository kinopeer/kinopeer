import { describe, expect, it } from 'vitest'
import type { SaveLocations } from '../api/qbittorrent'
import { addFolder, categoryFolder, isAbsolute, knownFolders } from './folders'

const locations = (fields: Partial<SaveLocations> = {}): SaveLocations => ({
  categories: [],
  defaultPath: '/downloads',
  categoryPaths: true,
  subcategories: false,
  ...fields,
})

describe('isAbsolute', () => {
  it('takes a path from the root or from a Windows drive', () => {
    expect(isAbsolute('/media/movies')).toBe(true)
    expect(isAbsolute('D:\\Movies')).toBe(true)
    expect(isAbsolute('d:/Movies')).toBe(true)
  })

  it('doesn’t take a relative path, a bare drive or ~, which qBittorrent doesn’t expand', () => {
    expect(isAbsolute('Movies')).toBe(false)
    expect(isAbsolute('./Movies')).toBe(false)
    expect(isAbsolute('D:Movies')).toBe(false)
    expect(isAbsolute('~/Movies')).toBe(false)
  })
})

describe('categoryFolder', () => {
  it('keeps an absolute category path', () => {
    const where = locations({ categories: [{ name: 'Movies', savePath: '/media/movies' }] })
    expect(categoryFolder('Movies', where)).toBe('/media/movies')
    const windows = locations({ defaultPath: 'C:\\Downloads', categories: [{ name: 'Movies', savePath: 'D:\\Movies' }] })
    expect(categoryFolder('Movies', windows)).toBe('D:\\Movies')
  })

  it('puts a relative category path under the default save path, as qBittorrent does', () => {
    const where = locations({ defaultPath: '/downloads/', categories: [{ name: 'Movies', savePath: 'films/hd' }] })
    expect(categoryFolder('Movies', where)).toBe('/downloads/films/hd')
    const windows = locations({ defaultPath: 'C:\\Downloads', categories: [{ name: 'Movies', savePath: 'films/hd' }] })
    expect(categoryFolder('Movies', windows)).toBe('C:\\Downloads\\films\\hd')
  })

  it('takes a backslash as a separator under a Windows folder, and as part of a folder’s name elsewhere', () => {
    const categories = [{ name: 'Movies', savePath: 'films\\hd' }]
    expect(categoryFolder('Movies', locations({ defaultPath: 'C:\\Downloads', categories }))).toBe('C:\\Downloads\\films\\hd')
    expect(categoryFolder('Movies', locations({ defaultPath: '/downloads', categories }))).toBe('/downloads/films\\hd')
    expect(categoryFolder('Movies', locations({ defaultPath: '/media/a\\b', categories }))).toBe('/media/a\\b/films\\hd')
  })

  it('leaves one separator where a folder’s end or a relative path repeats them', () => {
    const where = locations({ defaultPath: '/downloads//', categories: [{ name: 'Movies', savePath: 'films//hd' }] })
    expect(categoryFolder('Movies', where)).toBe('/downloads/films/hd')
    const windows = locations({ defaultPath: 'C:\\Downloads\\\\', categories: [{ name: 'Movies', savePath: 'films\\\\hd' }] })
    expect(categoryFolder('Movies', windows)).toBe('C:\\Downloads\\films\\hd')
  })

  it('names the folder of a category without a path after the category, made valid as qBittorrent does', () => {
    const where = locations({ categories: [{ name: 'TV', savePath: '' }, { name: 'A:B*?C', savePath: '' }] })
    expect(categoryFolder('TV', where)).toBe('/downloads/TV')
    expect(categoryFolder('A:B*?C', where)).toBe('/downloads/A B C')
  })

  it('keeps a subcategory’s folder under its parent’s with subcategories on, and its whole name without', () => {
    const categories = [
      { name: 'Movies', savePath: '/media/movies' },
      { name: 'Movies/HD', savePath: '' },
    ]
    expect(categoryFolder('Movies/HD', locations({ categories, subcategories: true }))).toBe('/media/movies/HD')
    expect(categoryFolder('Movies/HD', locations({ categories }))).toBe('/downloads/Movies/HD')
    const windows = locations({ defaultPath: 'C:\\Downloads', categories })
    expect(categoryFolder('Movies/HD', windows)).toBe('C:\\Downloads\\Movies\\HD')
  })

  it('can’t place a relative path without the default save path', () => {
    expect(categoryFolder('TV', locations({ defaultPath: '', categories: [{ name: 'TV', savePath: '' }] }))).toBe('')
  })
})

describe('addFolder', () => {
  const where = locations({ categories: [{ name: 'TV', savePath: '/media/tv' }] })

  it('is the category’s folder when qBittorrent uses category folders for new torrents', () => {
    expect(addFolder('TV', where)).toBe('/media/tv')
  })

  it('is the default save path in qBittorrent’s default manual mode, or without a category', () => {
    expect(addFolder('TV', { ...where, categoryPaths: false })).toBe('/downloads')
    expect(addFolder('', where)).toBe('/downloads')
  })
})

describe('knownFolders', () => {
  it('lists the default save path, then each category’s folder once', () => {
    const categories = [
      { name: 'Movies', savePath: '/media/movies' },
      { name: 'Other', savePath: '' },
      { name: 'Misc', savePath: '/downloads/' },
      { name: 'Films', savePath: '/media/movies/' },
    ]
    expect(knownFolders(locations({ categories }))).toEqual(['/downloads', '/media/movies', '/downloads/Other'])
  })

  it('offers the categories’ folders in manual mode too, as places to move to', () => {
    const categories = [{ name: 'TV', savePath: '/media/tv' }]
    expect(knownFolders(locations({ categories, categoryPaths: false }))).toEqual(['/downloads', '/media/tv'])
  })

  it('is empty when qBittorrent told nothing', () => {
    expect(knownFolders(locations({ defaultPath: '' }))).toEqual([])
  })
})
