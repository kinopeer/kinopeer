import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { lint } from './oxlint'

vi.mock('node:child_process', async (actual) => {
  const module = await actual<typeof import('node:child_process')>()
  return { ...module, spawnSync: vi.fn(module.spawnSync) }
})

describe('lint', () => {
  it('fails on a planted file oxlint couldn’t read, rather than finding no problem in it', () => {
    expect(() => lint({ 'src/screens/Broken.tsx': "export const A = () => <p>{t('a')</p>\n" })).toThrow(
      /oxlint couldn't read src\/screens\/Broken\.tsx/,
    )
  })

  it('fails with what oxlint said when it refuses to run', () => {
    // As oxlint 1.91 answers a config it can't read: exit 1 and its reason where the report would be.
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 1, stdout: "Failed to parse oxlint configuration file.\n\n  x Plugin 'a' not found\n", stderr: '' } as SpawnSyncReturns<string>)
    expect(() => lint({ 'src/a.ts': 'export const a = 1\n' })).toThrow(/oxlint didn't run \(exit 1\): Failed to parse oxlint configuration file\.\n\n {2}x Plugin 'a' not found/)
  })

  it('fails when oxlint exits for another reason than the problems it found', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 2, stdout: '{"diagnostics":[]}', stderr: 'Out of memory' } as SpawnSyncReturns<string>)
    expect(() => lint({ 'src/a.ts': 'export const a = 1\n' })).toThrow(/oxlint didn't run \(exit 2\): Out of memory/)
  })
})
