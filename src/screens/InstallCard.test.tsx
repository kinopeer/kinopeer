import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listenForInstallPrompt, resetInstallState } from '../pwa/install'
import { InstallCard } from './InstallCard'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

listenForInstallPrompt()

function installPrompt() {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  })
  act(() => void window.dispatchEvent(event))
  return event
}

beforeEach(() => localStorage.clear())

afterEach(() => {
  resetInstallState()
})

describe('InstallCard', () => {
  // Not even the closed sheet, which would come before Downloads' desktop table (#349).
  it('renders nothing where the app can\'t be installed', () => {
    const { container } = render(<InstallCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the browser prompt', async () => {
    render(<InstallCard />)
    const event = installPrompt()
    expect(screen.getByRole('heading', { name: 'Install Kinopeer' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(event.prompt).toHaveBeenCalledOnce()
  })

  it('shows the Home Screen steps on iPhone', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE)
    render(<InstallCard />)
    expect(screen.queryByRole('button', { name: 'On iPhone?' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    const sheet = screen.getByRole('dialog', { name: 'Add to Home Screen' })
    expect(sheet).toHaveTextContent('Choose “Add to Home Screen”')
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays closed once dismissed', async () => {
    const { unmount } = render(<InstallCard />)
    installPrompt()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('heading', { name: 'Install Kinopeer' })).not.toBeInTheDocument()

    unmount()
    render(<InstallCard />)
    expect(screen.queryByRole('heading', { name: 'Install Kinopeer' })).not.toBeInTheDocument()
  })
})
