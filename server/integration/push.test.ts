import { afterEach, describe, expect, it } from 'vitest'
import { PUSH_BASE, forgetPushSubscription, getPushKey, savePushSubscription, testPush } from '../../src/api/push/client.ts'
import { getServerSettings } from '../../src/api/settings/client.ts'
import { PUSH_SUBSCRIPTION_URL } from '../../src/pwa/swPush.ts'
import { testPayload } from '../push.ts'
import { startKinopeer, stopKinopeer } from '../test/integration.ts'
import { vapidPublicKey } from '../webPush.ts'

afterEach(stopKinopeer)

describe('push notifications through /api/push', () => {
  it('turns a device on, sends it a test notification, then turns it off', async () => {
    const { push, stores, responses } = await startKinopeer()
    await expect(getServerSettings()).resolves.toMatchObject({ push: { devices: 0 }, notifications: false })

    const publicKey = await getPushKey()
    const key = await stores.push.vapidKey()
    expect(publicKey).toBe(vapidPublicKey(key))

    const device = push.subscribe('/send/phone')
    await expect(savePushSubscription({ ...device, language: 'ru' })).resolves.toMatchObject({ push: { devices: 1 }, notifications: true })

    await testPush(device.endpoint)
    expect(push.pushes.map(({ path, payload }) => ({ path, payload }))).toEqual([{ path: '/send/phone', payload: testPayload('ru') }])
    // Signed with the key the device subscribed with.
    expect(push.pushes[0].headers.authorization).toContain(`k=${publicKey}`)

    await expect(forgetPushSubscription(device.endpoint)).resolves.toMatchObject({ push: { devices: 0 }, notifications: false })
    await expect(testPush(device.endpoint)).rejects.toMatchObject({ status: 404, code: 'unknown-device' })

    // The private key never reaches the browser.
    for (const response of responses) expect(await response.text()).not.toContain(key.d)
  })

  it('says the push service refused, or that the subscription is gone and forgotten', async () => {
    const { push } = await startKinopeer()
    const device = push.subscribe('/send/phone')
    await savePushSubscription({ ...device, language: 'en' })
    push.answers['/send/phone'] = { status: 403 }
    await expect(testPush(device.endpoint)).rejects.toMatchObject({ status: 502, code: 'refused' })
    push.answers['/send/phone'] = { status: 410 }
    await expect(testPush(device.endpoint)).rejects.toMatchObject({ status: 410, code: 'gone' })
    await expect(getServerSettings()).resolves.toMatchObject({ push: { devices: 0 } })
  })

  it('refuses a device whose push service the server doesn’t send to', async () => {
    const { push } = await startKinopeer()
    const device = push.subscribe('/send/phone')
    await expect(savePushSubscription({ ...device, endpoint: 'http://192.168.1.10/send', language: 'en' })).rejects.toMatchObject({
      status: 400,
      code: 'invalid-endpoint',
    })
  })

  it('takes a subscription the service worker renewed at the path it sends to', async () => {
    const { push, stores } = await startKinopeer()
    expect(PUSH_SUBSCRIPTION_URL).toBe(`${PUSH_BASE}/subscription`)
    const old = push.subscribe('/send/old')
    await savePushSubscription({ ...old, language: 'ru' })
    const renewed = push.subscribe('/send/new')
    const response = await fetch(PUSH_SUBSCRIPTION_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...renewed, language: 'en', replaces: old.endpoint }),
    })
    expect(response.status).toBe(200)
    expect(stores.push.subscriptions.map(({ endpoint, language }) => [endpoint, language])).toEqual([[renewed.endpoint, 'ru']])
  })
})
