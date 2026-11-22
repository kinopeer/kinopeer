import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ProxySignInError } from '../api/fetchKinopeer'
import { KinopeerUnreachableError } from '../api/qbittorrent'
import { TmdbError, TmdbKeyError } from '../api/tmdb'
import * as proxySignIn from '../pwa/proxySignIn'
import { controlledByServiceWorker, renderWithRouter } from '../test/render'
import { TmdbFailedState } from './TmdbFailedState'

vi.mock('../pwa/proxySignIn', async (importOriginal) => ({
  ...(await importOriginal<typeof proxySignIn>()),
  loadPastTheShell: vi.fn(),
}))

function SettingsPage() {
  return <h1>Settings page {JSON.stringify(useLocation().state)}</h1>
}

function renderState(error: unknown, onRetry = () => {}) {
  return renderWithRouter(
    <Routes>
      <Route path="/" element={<TmdbFailedState error={error} onRetry={onRetry} />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>,
  )
}

describe('TmdbFailedState', () => {
  it('says TMDB didn’t answer when the server’s bridge answered for it, and retries', async () => {
    controlledByServiceWorker()
    const onRetry = vi.fn()
    renderState(new TmdbError('TMDB responded 502', 502), onRetry)
    expect(screen.getByRole('heading', { name: 'Couldn’t load from TMDB' })).toBeInTheDocument()
    expect(screen.getByText('Check the connection and try again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open again' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('says Kinopeer isn’t answering when something in front of its server answered, without Open again', async () => {
    controlledByServiceWorker()
    const onRetry = vi.fn()
    renderState(new KinopeerUnreachableError(502), onRetry)
    expect(screen.getByRole('heading', { name: 'Kinopeer isn’t answering' })).toBeInTheDocument()
    expect(screen.getByText('Check that this device is online and Kinopeer is running on your server.')).toBeInTheDocument()
    // The way to the server works there, so a load past the service worker shows nothing new.
    expect(screen.queryByRole('button', { name: 'Open again' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it.each([
    ['the network failed', new TypeError('Failed to fetch')],
    ['a sign-in proxy redirected', new ProxySignInError()],
  ])('offers Open again when nothing answered for the server (%s) and a service worker answers the page', async (_, error) => {
    controlledByServiceWorker()
    renderState(error)
    expect(screen.getByRole('heading', { name: 'Kinopeer isn’t answering' })).toBeInTheDocument()
    expect(screen.getByText(/your browser may need to confirm its certificate again/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open again' }))
    expect(proxySignIn.loadPastTheShell).toHaveBeenCalledOnce()
  })

  it('leaves Open again out when nothing answered for the server but no service worker answers the page', () => {
    renderState(new TypeError('Failed to fetch'))
    expect(screen.getByRole('heading', { name: 'Kinopeer isn’t answering' })).toBeInTheDocument()
    expect(screen.getByText('Check that this device is online and Kinopeer is running on your server.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open again' })).not.toBeInTheDocument()
  })

  it('explains a missing TMDB key and sends the user to enter it in Settings', async () => {
    renderState(new TmdbKeyError(401))
    expect(screen.getByRole('heading', { name: 'TMDB isn’t set up' })).toBeInTheDocument()
    expect(screen.getByText(/Search needs a TMDB key/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enter key' }))
    expect(screen.getByRole('heading', { name: /^Settings page/ })).toHaveTextContent('{"editTmdbKey":true}')
  })
})
