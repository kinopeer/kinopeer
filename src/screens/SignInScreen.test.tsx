import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as auth from '../api/auth'
import { AuthError } from '../api/auth'
import { saying } from '../test/render'
import { SignInScreen } from './SignInScreen'

vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof auth>()),
  setUpPassword: vi.fn(),
  signIn: vi.fn(),
}))

const setUpPassword = vi.mocked(auth.setUpPassword)
const signIn = vi.mocked(auth.signIn)

beforeEach(() => {
  setUpPassword.mockResolvedValue()
  signIn.mockResolvedValue()
})

/** The screen as the app renders it: for whatever the page needs now. */
function Current() {
  return <SignInScreen need={auth.signInNeed() ?? 'sign-in'} />
}

describe('SignInScreen, setting the password', () => {
  async function setUp(password: string, repeat = password) {
    await userEvent.type(screen.getByLabelText('New password'), password)
    await userEvent.type(screen.getByLabelText('Repeat the password'), repeat)
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
  }

  it('sets the password typed twice', async () => {
    render(<SignInScreen need="set-up" />)
    expect(screen.getByRole('heading', { name: 'Set a password' })).toBeInTheDocument()
    expect(screen.getByText('Anyone on your network can open Kinopeer, and through it control qBittorrent and Prowlarr. Set a password to keep them out: each device asks for it once.')).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription('At least 8 characters')
    await setUp('correct horse')
    expect(setUpPassword).toHaveBeenCalledExactlyOnceWith('correct horse')
  })

  it('asks for 8 characters and the same password twice before sending it', async () => {
    render(<SignInScreen need="set-up" />)
    await setUp('short')
    const password = screen.getByLabelText('New password')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription('At least 8 characters')

    await userEvent.type(password, ' horse')
    expect(password).not.toHaveAttribute('aria-invalid')
    await userEvent.type(screen.getByLabelText('Repeat the password'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(screen.getByLabelText('Repeat the password')).toHaveAccessibleDescription('The passwords don’t match')
    expect(setUpPassword).not.toHaveBeenCalled()
  })

  it('asks to sign in when someone else set the password first', async () => {
    auth.setSignInNeed('set-up')
    setUpPassword.mockImplementation(async () => {
      throw new AuthError(409, 'already-set')
    })
    const { rerender } = render(<Current />)
    await setUp('correct horse')
    rerender(<Current />)
    expect(screen.getByRole('heading', { name: 'Sign in to Kinopeer' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: saying('Someone has just set Kinopeer’s password. Sign in with it.') })).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('says the server couldn’t keep it', async () => {
    setUpPassword.mockRejectedValue(new AuthError(500, 'storage'))
    render(<SignInScreen need="set-up" />)
    await setUp('correct horse')
    expect(screen.getByRole('alert', { name: saying(/couldn’t save the change/) })).toBeInTheDocument()
  })
})

describe('SignInScreen, signing in', () => {
  async function signInWith(password: string) {
    await userEvent.type(screen.getByLabelText('Password'), password)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('signs in with the password, which a password manager can fill', async () => {
    render(<SignInScreen need="sign-in" />)
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByText('Enter Kinopeer’s password. It keeps everyone else on your network out of Kinopeer and the qBittorrent and Prowlarr behind it.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Repeat the password')).not.toBeInTheDocument()
    expect(document.querySelector('input[autocomplete="username"]')).toHaveValue('Kinopeer')
    await signInWith('correct horse')
    expect(signIn).toHaveBeenCalledExactlyOnceWith('correct horse')
  })

  it('shows a wrong password on the field, and how long to wait once it’s the last try', async () => {
    signIn.mockRejectedValueOnce(new AuthError(422, 'invalid-password'))
    render(<SignInScreen need="sign-in" />)
    await signInWith('wrong')
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAccessibleDescription('Wrong password')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveAttribute('aria-busy')

    signIn.mockRejectedValueOnce(new AuthError(422, 'invalid-password', 15 * 60_000))
    await signInWith('x')
    expect(screen.getByRole('alert', { name: saying('Too many wrong passwords. Try again in 15 minutes.') })).toBeInTheDocument()
  })

  it('says how long to wait while the server holds tries back', async () => {
    signIn.mockRejectedValue(new AuthError(429, 'throttled', 3 * 60 * 60_000))
    render(<SignInScreen need="sign-in" />)
    await signInWith('correct horse')
    expect(screen.getByRole('alert', { name: saying('Too many wrong passwords. Try again in 3 hours.') })).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid')
  })

  it('says Kinopeer didn’t answer', async () => {
    signIn.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<SignInScreen need="sign-in" />)
    await signInWith('correct horse')
    expect(screen.getByRole('alert', { name: saying('Couldn’t reach Kinopeer. Try again.') })).toBeInTheDocument()
  })
})
