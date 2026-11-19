import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as auth from '../api/auth'
import { AuthError } from '../api/auth'
import { saying } from '../test/render'
import { ChangePasswordForm } from './ChangePasswordForm'

vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof auth>()),
  changePassword: vi.fn(),
}))

const changePassword = vi.mocked(auth.changePassword)

beforeEach(() => {
  changePassword.mockResolvedValue()
})

async function change(current: string, password: string, repeat = password) {
  if (current) await userEvent.type(screen.getByLabelText('Current password'), current)
  await userEvent.type(screen.getByLabelText('New password'), password)
  await userEvent.type(screen.getByLabelText('Repeat the password'), repeat)
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
}

describe('ChangePasswordForm', () => {
  it('changes the password and says so', async () => {
    const onChanged = vi.fn()
    render(<ChangePasswordForm onChanged={onChanged} />)
    await change('correct horse', 'battery staple')
    expect(changePassword).toHaveBeenCalledExactlyOnceWith('correct horse', 'battery staple')
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('starts with no error and nothing being sent', () => {
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    for (const label of ['Current password', 'New password', 'Repeat the password']) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute('aria-invalid')
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change password' })).not.toHaveAttribute('aria-busy')
  })

  it('asks for 8 characters and the same new password twice before sending it', async () => {
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    await change('correct horse', 'short')
    const password = screen.getByLabelText('New password')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(password, ' and long')
    expect(password).not.toHaveAttribute('aria-invalid')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    const repeat = screen.getByLabelText('Repeat the password')
    expect(repeat).toHaveAccessibleDescription('The passwords don’t match')
    expect(changePassword).not.toHaveBeenCalled()
    await userEvent.type(repeat, 'x')
    expect(repeat).not.toHaveAttribute('aria-invalid')
  })

  it('takes a new password of exactly 8 characters', async () => {
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    await change('correct horse', '8 chars!')
    expect(changePassword).toHaveBeenCalledExactlyOnceWith('correct horse', '8 chars!')
  })

  it('shows on the field that the server found the new password too short', async () => {
    changePassword.mockRejectedValue(new AuthError(400, 'too-short'))
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    await change('correct horse', 'battery staple')
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sends once while busy, without the last error, and takes over the form’s submit', async () => {
    changePassword.mockRejectedValueOnce(new AuthError(500, 'storage'))
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    await change('correct horse', 'battery staple')
    expect(screen.getByRole('alert', { name: saying(/couldn’t save the change/) })).toBeInTheDocument()
    // Typing doesn't take back an error that isn't a field's.
    await userEvent.type(screen.getByLabelText('Current password'), 'x')
    expect(screen.getByRole('alert', { name: saying(/couldn’t save the change/) })).toBeInTheDocument()

    let finish = () => {}
    changePassword.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))
    const button = screen.getByRole('button', { name: 'Change password' })
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Enter pressed again while it's on its way.
    expect(fireEvent.submit(button.closest('form')!)).toBe(false)
    expect(changePassword).toHaveBeenCalledTimes(2)
    await act(async () => finish())
  })

  it('shows a wrong current password on its field', async () => {
    changePassword.mockRejectedValue(new AuthError(422, 'invalid-password'))
    const onChanged = vi.fn()
    render(<ChangePasswordForm onChanged={onChanged} />)
    await change('wrong horse', 'battery staple')
    const current = screen.getByLabelText('Current password')
    expect(current).toHaveAccessibleDescription('Wrong password')
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.type(current, 'x')
    expect(current).not.toHaveAttribute('aria-invalid')

    // The last try before the wait: the wait goes once the field is typed in again.
    changePassword.mockRejectedValue(new AuthError(422, 'invalid-password', 15 * 60_000))
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByRole('alert', { name: saying('Too many wrong passwords. Try again in 15 minutes.') })).toBeInTheDocument()
    await userEvent.type(current, 'y')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    [new AuthError(429, 'throttled', 20 * 60_000), 'Too many wrong passwords. Try again in 20 minutes.'],
    [new AuthError(500, 'storage'), /couldn’t save the change/],
    [new AuthError(409, 'env-password'), 'Couldn’t change the password. Try again.'],
    [new TypeError('Failed to fetch'), 'Couldn’t change the password. Try again.'],
  ])('says why it couldn’t: %s', async (error, message) => {
    changePassword.mockRejectedValue(error)
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    await change('correct horse', 'battery staple')
    expect(screen.getByRole('alert', { name: saying(message) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change password' })).not.toHaveAttribute('aria-busy')
  })
})
