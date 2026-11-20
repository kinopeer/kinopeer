import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotifyTorrent } from './notifier.ts'
import { PushStore } from './push.ts'
import { pushChannel } from './pushChannel.ts'
import { closeServers } from './test/fakes.ts'
import { fakePushService } from './test/pushService.ts'
import { PushUnavailable } from './webPush.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinopeer-push-channel-'))
})

afterEach(async () => {
  await closeServers()
  await rm(dir, { recursive: true, force: true })
})

const finished: NotifyTorrent = { hash: 'abc123', name: 'Dune.2021.2160p.WEB-DL-GRPA', tags: 'kinopeer:notify', progress: 1, state: 'uploading' }

/** A push service with a device per language given, saved in the store in that order. */
async function setUp(languages: ('en' | 'ru')[], title = async (_torrent: NotifyTorrent, language: string) => (language === 'ru' ? 'Дюна (2021)' : 'Dune (2021)') as string | undefined) {
  const service = await fakePushService()
  const store = new PushStore(dir)
  const devices = languages.map((language, index) => ({ ...service.subscribe(`/send/${index}`), language, added: index }))
  for (const device of devices) await store.save(device)
  const titleOf = vi.fn(title)
  const log = vi.fn()
  return { service, store, devices, titleOf, log, channel: pushChannel({ store, title: titleOf, log }) }
}

describe('pushChannel', () => {
  it('is ready while some device gets notifications', async () => {
    const { channel, store, devices } = await setUp([])
    expect(channel.ready()).toBe(false)
    const service = await fakePushService()
    await store.save({ ...service.subscribe('/send/a'), language: 'en', added: 0 })
    expect(channel.ready()).toBe(true)
    await store.forget([store.subscriptions[0].endpoint])
    expect(channel.ready()).toBe(false)
    expect(devices).toEqual([])
  })

  it('sends each device the title in its language, the release under it, opening the torrent', async () => {
    const { channel, service, titleOf } = await setUp(['ru', 'en', 'ru'])
    expect(await channel.send(finished)).toBe('sent')
    expect(service.pushes.map(({ path, payload }) => ({ path, payload }))).toEqual([
      { path: '/send/0', payload: { title: 'Загрузка завершена', body: 'Дюна (2021)\nDune.2021.2160p.WEB-DL-GRPA', url: '/torrent/abc123', tag: 'abc123' } },
      { path: '/send/1', payload: { title: 'Download finished', body: 'Dune (2021)\nDune.2021.2160p.WEB-DL-GRPA', url: '/torrent/abc123', tag: 'abc123' } },
      { path: '/send/2', payload: { title: 'Загрузка завершена', body: 'Дюна (2021)\nDune.2021.2160p.WEB-DL-GRPA', url: '/torrent/abc123', tag: 'abc123' } },
    ])
    // Looked up once per language.
    expect(titleOf.mock.calls).toEqual([
      [finished, 'ru'],
      [finished, 'en'],
    ])
  })

  it('names the release alone when the title isn’t known, or its lookup fails', async () => {
    const { channel, service } = await setUp(['en'], async () => {
      throw new Error('TMDB down')
    })
    await channel.send(finished)
    expect(service.pushes[0].payload).toMatchObject({ title: 'Download finished', body: 'Dune.2021.2160p.WEB-DL-GRPA' })
  })

  it('forgets a device whose subscription is gone, and still says sent when another took it', async () => {
    const { channel, service, store, devices } = await setUp(['en', 'en'])
    service.answers['/send/0'] = { status: 410 }
    expect(await channel.send(finished)).toBe('sent')
    expect(store.subscriptions.map(({ endpoint }) => endpoint)).toEqual([devices[1].endpoint])
  })

  it('logs when a gone device can’t be forgotten, and still says sent', async () => {
    const { channel, service, store, log } = await setUp(['en', 'en'])
    service.answers['/send/0'] = { status: 410 }
    vi.spyOn(store, 'forget').mockRejectedValue(new Error('EACCES'))
    expect(await channel.send(finished)).toBe('sent')
    expect(log).toHaveBeenCalledWith('could not write push.json; is the data directory writable?')
  })

  it('says rejected when every device is gone or refused, and logs the refusal', async () => {
    const { channel, service, store, log } = await setUp(['en', 'en'])
    service.answers['/send/0'] = { status: 404 }
    service.answers['/send/1'] = { status: 400 }
    expect(await channel.send(finished)).toBe('rejected')
    expect(store.subscriptions).toHaveLength(1)
    expect(log).toHaveBeenCalledWith('a push service refused the notification for a finished download')
  })

  it('throws the longest wait a service asked for, and sends again only to the devices that didn’t get it', async () => {
    const { channel, service } = await setUp(['en', 'en', 'en', 'en'])
    // The longest wait in the middle, so neither the first nor the last answer is taken for it.
    service.answers['/send/1'] = { status: 503, retryAfter: '30' }
    service.answers['/send/2'] = { status: 429, retryAfter: '90' }
    service.answers['/send/3'] = { status: 503, retryAfter: '60' }
    const error = await channel.send(finished).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PushUnavailable)
    expect((error as PushUnavailable).retryAfterMs).toBe(90_000)
    expect(service.pushes.map(({ path }) => path)).toEqual(['/send/0'])

    delete service.answers['/send/1']
    delete service.answers['/send/2']
    delete service.answers['/send/3']
    expect(await channel.send(finished)).toBe('sent')
    expect(service.pushes.map(({ path }) => path)).toEqual(['/send/0', '/send/1', '/send/2', '/send/3'])

    // Done with it: a torrent tagged again is sent to every device again.
    expect(await channel.send(finished)).toBe('sent')
    expect(service.pushes).toHaveLength(8)
  })

  it('says sent when a device took it before the service of another, sent again, refused', async () => {
    const { channel, service } = await setUp(['en', 'en'])
    service.answers['/send/1'] = { status: 503 }
    await expect(channel.send(finished)).rejects.toBeInstanceOf(PushUnavailable)
    service.answers['/send/1'] = { status: 403 }
    expect(await channel.send(finished)).toBe('sent')
  })

  it('passes on an error that isn’t the push service’s', async () => {
    const store = new PushStore(dir)
    const service = await fakePushService()
    await store.save({ ...service.subscribe('/send/0'), language: 'en', added: 0 })
    await store.save({ ...service.subscribe('/send/1'), language: 'en', added: 1 })
    const send = vi.fn().mockRejectedValueOnce(new TypeError('bug')).mockRejectedValueOnce(new PushUnavailable(30_000))
    const channel = pushChannel({ store, title: async () => undefined, send })
    // At once, not taken for a service's wait when another service then doesn't answer.
    await expect(channel.send(finished)).rejects.toBeInstanceOf(TypeError)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
