import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonFile } from './jsonFile.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinoseed-json-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('JsonFile', () => {
  it('starts empty, writes the file readable only by the server and reads it back', async () => {
    const file = new JsonFile<Record<string, number>>(join(dir, 'nested'), 'data.json')
    expect(await file.load()).toEqual({})
    expect(file.current).toEqual({})

    await file.change((current) => ({ ...current, a: 1 }))

    const path = join(dir, 'nested', 'data.json')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ a: 1 })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(file.current).toEqual({ a: 1 })
    expect(await new JsonFile(join(dir, 'nested'), 'data.json').load()).toEqual({ a: 1 })
  })

  it('treats a broken or non-object file as empty', async () => {
    await writeFile(join(dir, 'broken.json'), '{ not json')
    await writeFile(join(dir, 'list.json'), '[1, 2]')
    expect(await new JsonFile(dir, 'broken.json').load()).toEqual({})
    expect(await new JsonFile(dir, 'list.json').load()).toEqual({})
  })

  it('applies changes made at the same time one after another, losing none', async () => {
    const file = new JsonFile<Record<string, number>>(dir, 'data.json')
    await Promise.all(['a', 'b', 'c'].map((key) => file.change((current) => ({ ...current, [key]: 1 }))))
    expect(JSON.parse(await readFile(join(dir, 'data.json'), 'utf8'))).toEqual({ a: 1, b: 1, c: 1 })
  })

  it('keeps working after a failed write', async () => {
    const file = new JsonFile<Record<string, number>>(dir, 'data.json')
    await expect(
      file.change(() => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await expect(file.change(() => ({ a: 1 }))).resolves.toEqual({ a: 1 })
  })
})
