import { describe, expect, it, vi } from 'vitest'
import { createSaves, saveKey, type SaveWatcher } from './saves'
import { held } from '../test/held'

const watcher = (takes: boolean) => ({ settled: vi.fn<SaveWatcher['settled']>(() => takes) })

describe('createSaves', () => {
  it('keeps what each save sends while it’s in flight, by kind and target, and tells its listeners', async () => {
    const saves = createSaves()
    const listener = vi.fn()
    saves.subscribe(listener)
    const folder = held()
    const sent = saves.send('folder', 'default', '/media', () => folder.promise)
    void saves.send('folder', 'category:Movies', '/films', () => new Promise(() => {}))
    void saves.send('telegram', 'default', 'token', () => new Promise(() => {}))
    expect(saves.getSnapshot().get(saveKey('folder', 'default'))).toBe('/media')
    expect(saves.getSnapshot().get(saveKey('folder', 'category:Movies'))).toBe('/films')
    expect(saves.getSnapshot().get(saveKey('telegram', 'default'))).toBe('token')
    expect(listener).toHaveBeenCalledTimes(3)

    folder.resolve()
    await sent
    expect(saves.getSnapshot().has(saveKey('folder', 'default'))).toBe(false)
    expect(saves.getSnapshot().has(saveKey('folder', 'category:Movies'))).toBe(true)
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('tells a listener nothing once it unsubscribed', async () => {
    const saves = createSaves()
    const listener = vi.fn()
    saves.subscribe(listener)()
    await saves.send('folder', 'default', '/media', () => Promise.resolve())
    expect(listener).not.toHaveBeenCalled()
  })

  it('sends nothing for a target while its save is in flight, so it never goes out twice', async () => {
    const saves = createSaves()
    const first = held()
    const sending = saves.send('folder', 'default', '/media', () => first.promise)
    const again = vi.fn(() => Promise.resolve())
    await expect(saves.send('folder', 'default', '/other', again)).resolves.toBeUndefined()
    expect(again).not.toHaveBeenCalled()
    expect(saves.getSnapshot().get(saveKey('folder', 'default'))).toBe('/media')

    first.resolve()
    await sending
    // Settled, the target takes a save again.
    await expect(saves.send('folder', 'default', '/other', again)).resolves.toMatchObject({ ok: true })
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('says what the request answered, or why it failed, and takes the save out of flight either way', async () => {
    const saves = createSaves()
    await expect(saves.send('telegram', 'bot', 'token', () => Promise.resolve('settings'))).resolves.toEqual({
      ok: true,
      result: 'settings',
      taken: false,
    })
    const error = new Error('refused')
    await expect(saves.send('telegram', 'bot', 'token', () => Promise.reject(error))).resolves.toEqual({ ok: false, error, taken: false })
    expect(saves.getSnapshot().size).toBe(0)
  })

  it('offers the outcome to every watcher of the kind, with what was sent and for which target, and says whether one took it', async () => {
    const saves = createSaves()
    const showing = watcher(true)
    const elsewhere = watcher(false)
    const otherKind = watcher(true)
    saves.watch('folder', showing)
    saves.watch('folder', elsewhere)
    saves.watch('telegram', otherKind)

    await expect(saves.send('folder', 'default', '/media', () => Promise.resolve(1))).resolves.toMatchObject({ taken: true })
    expect(showing.settled).toHaveBeenCalledWith({ ok: true, result: 1 }, '/media', 'default')
    expect(elsewhere.settled).toHaveBeenCalledWith({ ok: true, result: 1 }, '/media', 'default')
    expect(otherKind.settled).not.toHaveBeenCalled()
  })

  it('offers it to every watcher once one took it, since two sheets may show the same target', async () => {
    const saves = createSaves()
    const first = watcher(true)
    const second = watcher(true)
    saves.watch('folder', first)
    saves.watch('folder', second)
    await saves.send('folder', 'default', '/media', () => Promise.resolve())
    expect(first.settled).toHaveBeenCalledTimes(1)
    expect(second.settled).toHaveBeenCalledTimes(1)
  })

  it('leaves the outcome to the caller when the sheet that would take it stopped watching before it settled', async () => {
    const saves = createSaves()
    const sheet = watcher(true)
    const stop = saves.watch('folder', sheet)
    const folder = held()
    const sent = saves.send('folder', 'default', '/media', () => folder.promise)
    stop()
    folder.reject(new Error('refused'))
    await expect(sent).resolves.toMatchObject({ ok: false, taken: false })
    expect(sheet.settled).not.toHaveBeenCalled()
  })

  it('gives the outcome to a sheet that started watching while the save was in flight', async () => {
    const saves = createSaves()
    const folder = held()
    const sent = saves.send('folder', 'default', '/media', () => folder.promise)
    const opened = watcher(true)
    saves.watch('folder', opened)
    folder.resolve()
    await expect(sent).resolves.toMatchObject({ ok: true, taken: true })
    expect(opened.settled).toHaveBeenCalledTimes(1)
  })

  it('keeps watching a kind for the watchers left when one stops', async () => {
    const saves = createSaves()
    const stays = watcher(true)
    saves.watch('folder', stays)
    saves.watch('folder', watcher(false))()
    await expect(saves.send('folder', 'default', '/media', () => Promise.resolve())).resolves.toMatchObject({ taken: true })
  })

  it('forgets what’s in flight and who watches when cleared', async () => {
    const saves = createSaves()
    const sheet = watcher(true)
    saves.watch('folder', sheet)
    const folder = held()
    void saves.send('folder', 'default', '/media', () => folder.promise)
    saves.clear()
    expect(saves.getSnapshot().size).toBe(0)
    await expect(saves.send('folder', 'default', '/media', () => Promise.resolve())).resolves.toMatchObject({ taken: false })
    expect(sheet.settled).not.toHaveBeenCalled()
  })
})
