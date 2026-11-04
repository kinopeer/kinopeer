import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { SaveLocations, Torrent } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { torrent } from '../test/fixtures'
import { saying } from '../test/render'
import { CategorySheet } from './CategorySheet'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getSaveLocations: vi.fn(),
}))

const getSaveLocations = vi.mocked(api.getSaveLocations)

const LOCATIONS: SaveLocations = {
  defaultPath: '/downloads',
  categories: [
    { name: 'Movies', savePath: '/downloads/movies' },
    { name: 'TV Shows', savePath: '' },
  ],
  categoryPaths: true,
  subcategories: false,
  relocateOnCategoryChange: true,
  downloadPath: false,
}
const AUTO = torrent('dune', { name: 'Dune.Part.Two', category: 'Movies', save_path: '/downloads/movies', auto_tmm: true })

function renderSheet(fields: Partial<Torrent> = {}, props: { offline?: boolean; pending?: string; failed?: boolean } = {}) {
  const onSave = vi.fn()
  render(
    <CategorySheet torrent={{ ...AUTO, ...fields }} offline={false} failed={false} onSave={onSave} onClose={vi.fn()} {...props} />,
    { wrapper: ToastProvider },
  )
  return { sheet: screen.getByRole('dialog', { name: 'Category' }), onSave }
}

beforeEach(() => {
  vi.resetAllMocks()
  getSaveLocations.mockResolvedValue(LOCATIONS)
})

describe('CategorySheet', () => {
  it('lists no category and qBittorrent’s, with the torrent’s picked and Save off until another is', async () => {
    const { sheet } = renderSheet()
    await within(sheet).findByRole('radio', { name: 'TV Shows' })
    const options = within(sheet).getAllByRole('radio')
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['', 'Movies', 'TV Shows'])
    expect(within(sheet).getByRole('radio', { name: 'No category' })).not.toBeChecked()
    expect(within(sheet).getByRole('radio', { name: 'Movies' })).toBeChecked()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.click(within(sheet).getByRole('radio', { name: 'TV Shows' }))
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('keeps a category qBittorrent no longer has among the choices, as the torrent’s', async () => {
    const { sheet } = renderSheet({ category: 'Old' })
    expect(await within(sheet).findByRole('radio', { name: 'Old' })).toBeChecked()
  })

  it('shows where each category would move the files of a torrent under automatic management', async () => {
    const { sheet } = renderSheet()
    expect(await within(sheet).findByRole('radio', { name: 'TV Shows' })).toHaveAccessibleDescription('/downloads/TV Shows')
    expect(within(sheet).getByRole('radio', { name: 'No category' })).toHaveAccessibleDescription('/downloads')
  })

  it.each<[string, Partial<Torrent>, Partial<SaveLocations>]>([
    ['in manual mode', { auto_tmm: false }, {}],
    ['qBittorrent switches to manual mode', {}, { relocateOnCategoryChange: false }],
  ])('shows no folders where the files don’t move (%s)', async (_case, fields, locations) => {
    getSaveLocations.mockResolvedValue({ ...LOCATIONS, ...locations })
    const { sheet } = renderSheet(fields)
    expect(await within(sheet).findByRole('radio', { name: 'TV Shows' })).not.toHaveAccessibleDescription()
  })

  it.each<[string, Partial<Torrent>, Partial<SaveLocations>, string, string]>([
    ['moves the files', {}, {}, 'TV Shows', 'qBittorrent will move the files to /downloads/TV Shows.'],
    ['moves them where it can’t name the folder', {}, { defaultPath: '' }, 'TV Shows', 'qBittorrent will move the files to the category’s folder.'],
    [
      'leaves them in the new category’s folder',
      { category: 'Old' },
      {},
      'Movies',
      'The files are in this category’s folder already: /downloads/movies.',
    ],
    [
      'switches to manual mode',
      {},
      { relocateOnCategoryChange: false },
      'TV Shows',
      'qBittorrent will switch the torrent to manual mode, as its settings say, and the files stay in /downloads/movies.',
    ],
    ['leaves the files of a torrent in manual mode', { auto_tmm: false }, {}, 'TV Shows', 'The torrent is in manual mode, so the files stay in /downloads/movies.'],
  ])('says when the change %s', async (_case, fields, locations, pick, note) => {
    getSaveLocations.mockResolvedValue({ ...LOCATIONS, ...locations })
    const { sheet, onSave } = renderSheet(fields)
    await userEvent.click(await within(sheet).findByRole('radio', { name: pick }))
    expect(within(sheet).getByText(note)).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(pick, expect.objectContaining({ kind: expect.any(String) }))
  })

  it('says nothing about the files until another category is picked', async () => {
    const { sheet } = renderSheet()
    await within(sheet).findByRole('radio', { name: 'TV Shows' })
    // No note of any kind: for its own category the files would "stay", which isn't news.
    expect(within(sheet).queryByText(/files/)).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('radio', { name: 'TV Shows' }))
    expect(within(sheet).getByText(/files/)).toBeInTheDocument()
  })

  it('hands Save what the change does, for the state the torrent shows meanwhile', async () => {
    const { sheet, onSave } = renderSheet()
    await userEvent.click(await within(sheet).findByRole('radio', { name: 'No category' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('', { kind: 'move', folder: '/downloads' })
  })

  it('can’t save before qBittorrent said where its categories are', async () => {
    getSaveLocations.mockReturnValue(new Promise(() => {}))
    const { sheet } = renderSheet()
    // Only the torrent's own and none until then.
    await userEvent.click(within(sheet).getByRole('radio', { name: 'No category' }))
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('starts from the category being sent, and keeps it while it is', async () => {
    const { sheet } = renderSheet({}, { pending: 'TV Shows' })
    expect(await within(sheet).findByRole('radio', { name: 'TV Shows' })).toBeChecked()
    expect(within(sheet).getByRole('radio', { name: 'Movies' })).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('says the last change failed', async () => {
    const { sheet } = renderSheet({}, { failed: true })
    expect(within(sheet).getByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
  })
})
