import { describe, expect, it } from 'vitest'
import { downloadToken, failedIds, indexerNames } from './prowlarrResults'

const KEY = 'secret-key-123'

describe('downloadToken', () => {
  it('keeps the indexer and link but drops the API key', () => {
    expect(downloadToken(`http://prowlarr:9696/12/download?apikey=${KEY}&link=abc%3D&file=Dune`)).toBe(
      '12/download?link=abc%3D&file=Dune',
    )
    expect(downloadToken('http://prowlarr:9696/api/v1/indexer')).toBeUndefined()
    expect(downloadToken('not a url')).toBeUndefined()
  })
})

describe('failedIds and indexerNames', () => {
  const now = Date.parse('2026-10-28T01:00:00Z')
  const since = Date.parse('2026-10-28T00:59:00Z')
  const indexers = [
    { id: 1, name: 'Indexer D', enable: true },
    { id: 2, name: 'Indexer C', enable: true },
    { id: 3, name: 'Old', enable: false },
    { id: 4, name: 'Fine', enable: true },
    { id: 5, name: 'Earlier', enable: true },
  ]

  it('names enabled indexers that failed during the search or are on hold, sorted', () => {
    const statuses = [
      { indexerId: 1, mostRecentFailure: '2026-10-28T00:59:30Z' },
      { indexerId: 2, disabledTill: '2026-10-28T02:00:00Z', mostRecentFailure: '2026-10-27T20:00:00Z' },
      { indexerId: 3, disabledTill: '2026-10-28T02:00:00Z' },
      { indexerId: 4, disabledTill: '2026-10-28T00:30:00Z' },
      // Failed before this search and isn't on hold: an older failure, not this search's.
      { indexerId: 5, mostRecentFailure: '2026-10-28T00:58:59Z' },
    ]
    expect(indexerNames(indexers, failedIds(statuses, since, now))).toEqual(['Indexer C', 'Indexer D'])
  })

  it('names none when nothing failed', () => {
    expect(indexerNames(indexers, failedIds([], since, now))).toEqual([])
  })

  it('never counts a row without an id as a failure', () => {
    const statuses = [{ mostRecentFailure: '2026-10-28T00:59:30Z' }]
    expect(indexerNames([...indexers, { name: 'No id', enable: true }], failedIds(statuses, since, now))).toEqual([])
  })
})
