import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AUTH_BASE, AuthError, changePassword, setUpPassword, signIn, signOut } from './client'
import { setSignInNeed, signInNeed } from './signInNeed'
import { sharedRequests } from '../../logic/sharedRequests'

let fetchMock: Mock<typeof fetch>

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('the auth client', () => {
  it('sends the password as JSON and lets the app in once it’s taken', async () => {
    setSignInNeed('set-up')
    await setUpPassword('correct horse')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${AUTH_BASE}/setup`, expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"password":"correct horse"}',
      credentials: 'same-origin',
    }))
    expect(signInNeed()).toBeNull()

    setSignInNeed('sign-in')
    await signIn('correct horse')
    expect(fetchMock).toHaveBeenLastCalledWith(`${AUTH_BASE}/login`, expect.objectContaining({ method: 'POST', body: '{"password":"correct horse"}' }))
    expect(signInNeed()).toBeNull()
  })

  it('keeps the app held back when the password isn’t taken, and says why', async () => {
    setSignInNeed('sign-in')
    fetchMock.mockResolvedValueOnce(json(429, { error: 'throttled', retryAfterMs: 60_000 }))
    const throttled = signIn('wrong')
    await expect(throttled).rejects.toEqual(new AuthError(429, 'throttled', 60_000))
    await expect(throttled).rejects.toThrow('Sign-in request failed (throttled)')
    expect(signInNeed()).toBe('sign-in')

    fetchMock.mockResolvedValueOnce(json(422, { error: 'invalid-password', retryAfterMs: 'soon' }))
    await expect(signIn('wrong')).rejects.toMatchObject({ code: 'invalid-password', retryAfterMs: undefined })
    // Something in front of the server answered for it.
    fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
    const gateway = signIn('wrong')
    await expect(gateway).rejects.toMatchObject({ status: 502, code: undefined })
    await expect(gateway).rejects.toThrow('Sign-in request failed (502)')
    fetchMock.mockResolvedValueOnce(new Response('{', { status: 500, headers: { 'Content-Type': 'application/json' } }))
    await expect(signIn('wrong')).rejects.toMatchObject({ status: 500, code: undefined })
  })

  it('signs out, forgetting the answers the page kept', async () => {
    sharedRequests.set('api|settings', { kept: true })
    await signOut()
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${AUTH_BASE}/logout`, expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    }))
    expect(sharedRequests.peek('api|settings', 60_000)).toBeUndefined()
    expect(signInNeed()).toBe('sign-in')
  })

  it('keeps everything when signing out fails', async () => {
    sharedRequests.set('api|settings', { kept: true })
    fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
    await expect(signOut()).rejects.toBeInstanceOf(AuthError)
    expect(sharedRequests.peek('api|settings', 60_000)).toEqual({ data: { kept: true } })
    expect(signInNeed()).toBeNull()
  })

  it('changes the password and leaves this browser signed in', async () => {
    await changePassword('correct horse', 'battery staple')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${AUTH_BASE}/password`, expect.objectContaining({
      method: 'PUT',
      body: '{"current":"correct horse","password":"battery staple"}',
    }))
    expect(signInNeed()).toBeNull()
  })
})
