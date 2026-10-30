import { describe, expect, it } from 'vitest'
import type { Torrent, TorrentState } from '../api/qbittorrent'
import i18n from '../i18n'
import { createFormatters } from '../lib/format'
import { compareByQueue, downloadStatus, hasMetadata, matchesFilter, transferSpeed, withChecking, withRunning } from './status'

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

describe('hasMetadata', () => {
  it('is false only while qBittorrent reports the total size as -1', () => {
    expect(hasMetadata({ total_size: -1 })).toBe(false)
    expect(hasMetadata({ total_size: 0 })).toBe(true)
    expect(hasMetadata({ total_size: 4_000_000_000 })).toBe(true)
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

describe('withRunning', () => {
  const make = (state: TorrentState, progress: number) => ({ hash: 'dune', state, progress }) as Torrent

  it('stops a running torrent, as Paused or, once finished, Completed', () => {
    expect(withRunning(make('downloading', 0.5), false).state).toBe('stoppedDL')
    expect(withRunning(make('queuedDL', 0.5), false).state).toBe('stoppedDL')
    expect(withRunning(make('uploading', 1), false).state).toBe('stoppedUP')
  })

  it('starts a stopped one with nothing moving yet, downloading or, once finished, seeding', () => {
    expect(withRunning(make('stoppedDL', 0.5), true).state).toBe('stalledDL')
    expect(withRunning(make('error', 0.5), true).state).toBe('stalledDL')
    expect(withRunning(make('pausedUP', 1), true).state).toBe('stalledUP')
  })

  it('leaves a torrent that already is that way as qBittorrent reports it', () => {
    const paused = make('pausedDL', 0.5)
    expect(withRunning(paused, false)).toBe(paused)
    const queued = make('queuedDL', 0.5)
    expect(withRunning(queued, true)).toBe(queued)
  })
})

describe('withChecking', () => {
  const make = (state: TorrentState, progress: number) => ({ hash: 'dune', state, progress }) as Torrent

  it('checks a torrent with data, downloading or, once finished, seeding, whether it runs or not', () => {
    expect(withChecking(make('downloading', 0.5)).state).toBe('checkingDL')
    expect(withChecking(make('stoppedDL', 0.5)).state).toBe('checkingDL')
    expect(withChecking(make('uploading', 1)).state).toBe('checkingUP')
    expect(withChecking(make('stoppedUP', 1)).state).toBe('checkingUP')
  })

  it('leaves a torrent already being checked as qBittorrent reports it', () => {
    const checking = make('checkingResumeData', 1)
    expect(withChecking(checking)).toBe(checking)
  })
})

describe('transferSpeed', () => {
  const format = createFormatters(i18n.t, 'en')
  const speeds = { dlspeed: 4_300_000, upspeed: 120_000 }

  it('shows the download speed while downloading and the upload speed while seeding', () => {
    expect(transferSpeed(speeds, 'downloading', format)).toMatch(/^↓ 4\.3\sMB\/s$/)
    expect(transferSpeed(speeds, 'seeding', format)).toMatch(/^↑ 120\sKB\/s$/)
  })

  it.each(['paused', 'completed', 'queued', 'checking', 'error'] as const)('shows nothing while %s', (status) => {
    expect(transferSpeed(speeds, status, format)).toBeNull()
  })
})
