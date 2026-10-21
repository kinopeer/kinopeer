import { describe, expect, it } from 'vitest'
import type { Torrent, TorrentState } from '../api/qbittorrent'
import { compareByQueue, downloadStatus, matchesFilter } from './status'

const torrent = (state: TorrentState, progress = 0.5) => ({ state, progress })

describe('downloadStatus', () => {
  it.each([
    ['downloading', 'downloading'],
    ['stalledDL', 'downloading'],
    ['metaDL', 'downloading'],
    ['uploading', 'seeding'],
    ['stalledUP', 'seeding'],
    ['pausedDL', 'paused'],
    ['stoppedDL', 'paused'],
    ['stoppedUP', 'completed'],
    ['queuedDL', 'queued'],
    ['checkingResumeData', 'checking'],
    ['missingFiles', 'error'],
  ] as const)('maps %s to %s', (state, status) => {
    expect(downloadStatus({ state })).toBe(status)
  })
})

describe('matchesFilter', () => {
  it('counts queued and checking torrents as downloading until they finish', () => {
    expect(matchesFilter(torrent('queuedDL'), 'downloading')).toBe(true)
    expect(matchesFilter(torrent('checkingUP', 1), 'downloading')).toBe(false)
  })

  it('treats any finished torrent as completed', () => {
    expect(matchesFilter(torrent('uploading', 1), 'completed')).toBe(true)
    expect(matchesFilter(torrent('stoppedUP', 1), 'completed')).toBe(true)
    expect(matchesFilter(torrent('downloading', 0.9), 'completed')).toBe(false)
  })

  it('matches the rest by status', () => {
    expect(matchesFilter(torrent('stoppedDL'), 'paused')).toBe(true)
    expect(matchesFilter(torrent('error'), 'error')).toBe(true)
    expect(matchesFilter(torrent('error'), 'all')).toBe(true)
  })
})

describe('compareByQueue', () => {
  it('puts the queue first, then the newest', () => {
    const make = (hash: string, priority: number, added_on: number) => ({ hash, priority, added_on }) as Torrent
    const sorted = [make('old', -1, 1), make('q2', 2, 5), make('new', -1, 9), make('q1', 1, 3)].sort(compareByQueue)
    expect(sorted.map((t) => t.hash)).toEqual(['q1', 'q2', 'new', 'old'])
  })
})
