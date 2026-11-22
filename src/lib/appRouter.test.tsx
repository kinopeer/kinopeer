import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Link, useLocation } from 'react-router'
import { ROUTER_OPTIONS } from './routerOptions'

/** The router of the build `__WEBUI__` names: the module reads it as it loads, so it's loaded again. */
async function routerOf(webui: boolean) {
  vi.stubGlobal('__WEBUI__', webui)
  vi.resetModules()
  return (await import('./appRouter')).AppRouter
}

function Shown() {
  const { pathname, search } = useLocation()
  return (
    <>
      <output aria-label="Route">{`${pathname}${search}`}</output>
      <Link to="/search?q=dune">Search</Link>
    </>
  )
}

async function renderAt(address: string, webui: boolean) {
  window.history.replaceState(null, '', address)
  const AppRouter = await routerOf(webui)
  render(
    <AppRouter {...ROUTER_OPTIONS}>
      <Shown />
    </AppRouter>,
  )
}

const route = () => screen.getByRole('status', { name: 'Route' }).textContent
const address = () => `${window.location.pathname}${window.location.search}${window.location.hash}`

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('AppRouter', () => {
  // Kinopeer's server answers every app path with index.html (server/static.ts).
  it('routes by the path in the server’s build', async () => {
    await renderAt('/title/movie/1?tab=cast', false)
    expect(route()).toBe('/title/movie/1?tab=cast')
    await userEvent.click(screen.getByRole('link', { name: 'Search' }))
    expect(address()).toBe('/search?q=dune')
    expect(route()).toBe('/search?q=dune')
  })

  // qBittorrent serves only the build's own files, so the page is always its index.html at `/`.
  it('routes after the # in the WebUI build, the same routes as the server’s', async () => {
    await renderAt('/#/title/movie/1?tab=cast', true)
    expect(route()).toBe('/title/movie/1?tab=cast')
    await userEvent.click(screen.getByRole('link', { name: 'Search' }))
    expect(address()).toBe('/#/search?q=dune')
    expect(route()).toBe('/search?q=dune')
  })
})
