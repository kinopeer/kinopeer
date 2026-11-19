import { render, screen } from '@testing-library/react'
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

  it('asks for 8 characters and the same new password twice before sending it', async () => {
    render(<ChangePasswordForm onChanged={vi.fn()} />)
    await change('correct horse', 'short')
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(screen.getByLabelText('New password'), ' and long')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByLabelText('Repeat the password')).toHaveAccessibleDescription('The passwords don’t match')
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('shows a wrong current password on its field', async () => {
    changePassword.mockRejectedValue(new AuthError(422, 'invalid-password'))
    const onChanged = vi.fn()
    render(<ChangePasswordForm onChanged={onChanged} />)
    await change('wrong horse', 'battery staple')
    const current = screen.getByLabelText('Current password')
    expect(current).toHaveAccessibleDescription('Wrong password')
    expect(onChanged).not.toHaveBeenCalled()
    await userEvent.type(current, 'x')
    expect(current).not.toHaveAttribute('aria-invalid')
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
