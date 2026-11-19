import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { MIN_PASSWORD_LENGTH } from '../auth.ts'
import { AuthError, MIN_PASSWORD_LENGTH as CLIENT_MIN_PASSWORD_LENGTH, changePassword, setSignInNeed, setUpPassword, signIn, signInNeed, signOut } from '../../src/api/auth/index.ts'
import { SignInRequiredError } from '../../src/api/fetchKinopeer.ts'
import { getAppVersion } from '../../src/api/qbittorrent/client.ts'
import { getServerSettings } from '../../src/api/settings/client.ts'
import { sharedRequests } from '../../src/logic/sharedRequests.ts'
import { startKinopeer, stopKinopeer } from '../test/integration.ts'

afterEach(async () => {
  setSignInNeed(null)
  await stopKinopeer()
})

/** The login on, as beyond Umbrel. */
const loginOn = { env: { KINOPEER_AUTH: undefined } }

describe('Kinopeer’s own login through the clients', () => {
  it('asks to set a password first, then lets the browser that set it in', async () => {
    const { qbittorrent } = await startKinopeer(loginOn)
    await expect(getAppVersion()).rejects.toEqual(new SignInRequiredError('set-up'))
    expect(signInNeed()).toBe('set-up')
    expect(qbittorrent.seen).toEqual([])

    // The client asks for what the server takes.
    expect(CLIENT_MIN_PASSWORD_LENGTH).toBe(MIN_PASSWORD_LENGTH)
    await expect(setUpPassword('x'.repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toMatchObject({ status: 400, code: 'too-short' })
    await setUpPassword('correct horse')
    expect(signInNeed()).toBeNull()
    await expect(getAppVersion()).resolves.toBe('5.2.4')
    await expect(getServerSettings()).resolves.toMatchObject({ auth: { enabled: true, source: 'saved' } })
  })

  it('reaches none of the services behind it however a path is written', async () => {
    const { origin, qbittorrent, prowlarr, tmdb } = await startKinopeer(loginOn)
    await setUpPassword('correct horse')
    await signOut()
    const paths = [
      '/qbt/api/v2/app/version',
      '/qbt/api/v2/torrents/info',
      '/prowlarr/search?query=x',
      '/prowlarr/status',
      '/tmdb/movie/693134',
      '/tmdb-img/w342/poster.jpg',
      '/api/settings',
      '/api/matches',
      '/a/../qbt/api/v2/app/version',
      '//x/api/matches',
      '/%2e/qbt/api/v2/app/version',
    ]
    for (const path of paths) {
      // fetch would resolve the dots itself, so the path goes as written over a plain request.
      expect((await rawGet(origin, path)).status, path).toBe(401)
    }
    expect(qbittorrent.seen).toEqual([])
    expect(prowlarr.seen).toEqual([])
    expect(tmdb.seen).toEqual([])
  })

  it('signs in, says why it can’t, and signs out', async () => {
    await startKinopeer(loginOn)
    await setUpPassword('correct horse')
    sharedRequests.set('kept', 'answer')
    await signOut()
    expect(signInNeed()).toBe('sign-in')
    expect(sharedRequests.peek('kept', 60_000)).toBeUndefined()
    await expect(getAppVersion()).rejects.toEqual(new SignInRequiredError('sign-in'))

    const wrong = await signIn('wrong horse').catch((error: unknown) => error)
    expect(wrong).toBeInstanceOf(AuthError)
    expect(wrong).toMatchObject({ status: 422, code: 'invalid-password', retryAfterMs: undefined })
    expect(signInNeed()).toBe('sign-in')

    await signIn('correct horse')
    expect(signInNeed()).toBeNull()
    await expect(getAppVersion()).resolves.toBe('5.2.4')
  })

  it('tells how long to wait after too many wrong passwords', async () => {
    await startKinopeer(loginOn)
    await setUpPassword('correct horse')
    await signOut()
    for (let i = 0; i < 4; i++) await signIn(`wrong ${i}`).catch(() => {})
    // A quarter of an hour, less the moments the answer took.
    const quarter = expect.closeTo(15 * 60_000, -3)
    await expect(signIn('wrong 4')).rejects.toMatchObject({ code: 'invalid-password', retryAfterMs: quarter })
    await expect(signIn('correct horse')).rejects.toMatchObject({ status: 429, code: 'throttled', retryAfterMs: quarter })
  })

  it('changes the password, and refuses to when KINOPEER_PASSWORD sets it', async () => {
    await startKinopeer(loginOn)
    await setUpPassword('correct horse')
    await expect(changePassword('wrong horse', 'battery staple')).rejects.toMatchObject({ code: 'invalid-password' })
    await changePassword('correct horse', 'battery staple')
    await signOut()
    await expect(signIn('correct horse')).rejects.toMatchObject({ code: 'invalid-password' })
    await signIn('battery staple')

    await startKinopeer({ env: { KINOPEER_AUTH: 'on', KINOPEER_PASSWORD: 'from the environment' } })
    await expect(getServerSettings()).rejects.toEqual(new SignInRequiredError('sign-in'))
    await expect(setUpPassword('correct horse')).rejects.toMatchObject({ status: 409, code: 'already-set' })
    await signIn('from the environment')
    await expect(getServerSettings()).resolves.toMatchObject({ auth: { enabled: true, source: 'env' } })
    await expect(changePassword('from the environment', 'battery staple')).rejects.toMatchObject({ status: 409, code: 'env-password' })
  })

  it('stays out of the way with KINOPEER_AUTH=off', async () => {
    await startKinopeer({ env: { KINOPEER_AUTH: 'off' } })
    await expect(getAppVersion()).resolves.toBe('5.2.4')
    await expect(getServerSettings()).resolves.toMatchObject({ auth: { enabled: false } })
    await expect(signIn('anything')).rejects.toMatchObject({ status: 409, code: 'auth-off' })
    expect(signInNeed()).toBeNull()
  })
})

/** A GET with the path exactly as written, which fetch would normalize. */
function rawGet(origin: string, path: string): Promise<{ status: number }> {
  const { hostname, port } = new URL(origin)
  return new Promise((resolve, reject) => {
    const sent = request({ hostname, port, path, method: 'GET' }, (response) => {
      response.resume()
      resolve({ status: response.statusCode ?? 0 })
    })
    sent.on('error', reject)
    sent.end()
  })
}
