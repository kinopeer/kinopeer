import { describe, expect, it } from 'vitest'
import { categoryFolder, knownFolders } from './folders'

describe('categoryFolder', () => {
  it('keeps an absolute category path', () => {
    expect(categoryFolder({ name: 'Movies', savePath: '/media/movies' }, '/downloads')).toBe('/media/movies')
    expect(categoryFolder({ name: 'Movies', savePath: 'D:\\Movies' }, 'C:\\Downloads')).toBe('D:\\Movies')
  })

  it('puts a relative category path under the default save path, as qBittorrent does', () => {
    expect(categoryFolder({ name: 'Movies', savePath: 'films' }, '/downloads/')).toBe('/downloads/films')
    expect(categoryFolder({ name: 'Movies', savePath: 'films' }, 'C:\\Downloads')).toBe('C:\\Downloads\\films')
  })

  it('uses the category’s name under the default save path when it has no path', () => {
    expect(categoryFolder({ name: 'TV', savePath: '' }, '/downloads')).toBe('/downloads/TV')
  })

  it('can’t place a relative path without the default save path', () => {
    expect(categoryFolder({ name: 'TV', savePath: '' }, '')).toBe('')
    expect(categoryFolder({ name: 'TV', savePath: 'shows' }, '')).toBe('')
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
    expect(knownFolders(categories, '/downloads')).toEqual(['/downloads', '/media/movies', '/downloads/Other'])
  })

  it('is empty when qBittorrent told nothing', () => {
    expect(knownFolders([], '')).toEqual([])
  })
})
