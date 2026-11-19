import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Folders } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { FoldersSheet } from './FoldersSheet'
import { findToastOnPage, saying } from '../test/render'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getFolders: vi.fn(),
  prepareFolder: vi.fn(),
  setDefaultSavePath: vi.fn(),
  setCategoryFolder: vi.fn(),
}))

const getFolders = vi.mocked(api.getFolders)
const prepareFolder = vi.mocked(api.prepareFolder)
const setDefaultSavePath = vi.mocked(api.setDefaultSavePath)
const setCategoryFolder = vi.mocked(api.setCategoryFolder)

const MOVIES = { name: 'Movies', savePath: '/media/movies', download_path: '/downloads/incomplete' }
const TV = { name: 'TV', savePath: '' }
const FOLDERS: Folders = {
  defaultPath: '/downloads',
  categories: [MOVIES, TV],
  categoryPaths: true,
  subcategories: true,
  relocateOnCategoryChange: true,
  downloadPath: false,
  relocateOnDefaultPathChange: false,
  relocateOnCategoryPathChange: false,
}

/** Settings' row and the sheet it opens. */
function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Folders
      </button>
      <FoldersSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}

async function openSheet() {
  render(<Harness />, { wrapper: ToastProvider })
  await userEvent.click(screen.getByRole('button', { name: 'Folders' }))
  return screen.getByRole('dialog', { name: 'qBittorrent folders' })
}

async function edit(sheet: HTMLElement, row: RegExp) {
  await userEvent.click(await within(sheet).findByRole('button', { name: row }))
  return within(sheet).getByRole('textbox', { name: 'Folder' })
}

async function type(field: HTMLElement, folder: string) {
  await userEvent.clear(field)
  await userEvent.type(field, folder)
}

beforeEach(() => {
  vi.resetAllMocks()
  getFolders.mockResolvedValue(FOLDERS)
  prepareFolder.mockResolvedValue()
  setDefaultSavePath.mockResolvedValue()
  setCategoryFolder.mockResolvedValue()
})

describe('FoldersSheet', () => {
  it('asks for the folders only when it opens, and lists the default one and each category’s, as qBittorrent places them', async () => {
    render(<Harness />, { wrapper: ToastProvider })
    expect(getFolders).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Folders' }))
    const sheet = screen.getByRole('dialog', { name: 'qBittorrent folders' })

    const rows = await within(sheet).findAllByRole('button', { name: /^(Default folder|Movies|TV)/ })
    expect(rows.map((row) => row.textContent)).toEqual(['Default folder/downloads', 'Movies/media/movies', 'TV/downloads/TV'])
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says it’s loading until the folders come', async () => {
    let answer!: (folders: Folders) => void
    getFolders.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const sheet = await openSheet()
    expect(within(sheet).getByRole('status', { name: 'Loading folders' })).toBeInTheDocument()

    answer(FOLDERS)
    expect(await within(sheet).findByRole('button', { name: /^Default folder/ })).toBeInTheDocument()
    expect(within(sheet).queryByRole('status', { name: 'Loading folders' })).not.toBeInTheDocument()
  })

  it('says when qBittorrent didn’t send its folders, and asks again on Try again', async () => {
    getFolders.mockRejectedValueOnce(new api.QbittorrentError('qBittorrent responded 500', 500))
    const sheet = await openSheet()

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('qBittorrent didn’t send its folders. Try again.')
    expect(within(sheet).queryByRole('status', { name: 'Loading folders' })).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    expect(await within(sheet).findByRole('button', { name: /^Default folder/ })).toBeInTheDocument()
  })

  it('has qBittorrent create the default folder, then saves it, and shows the folders again as they are now', async () => {
    const sheet = await openSheet()
    const field = await edit(sheet, /^Default folder/)
    expect(field).toHaveValue('/downloads')
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()

    getFolders.mockResolvedValue({ ...FOLDERS, defaultPath: '/media/downloads' })
    await type(field, '/media/downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(prepareFolder).toHaveBeenCalledWith('/media/downloads')
    expect(setDefaultSavePath).toHaveBeenCalledWith('/media/downloads')
    expect(prepareFolder.mock.invocationCallOrder[0]).toBeLessThan(setDefaultSavePath.mock.invocationCallOrder[0])
    expect(setCategoryFolder).not.toHaveBeenCalled()
    expect(await screen.findByRole('status', { name: saying('Folder saved') })).toBeInTheDocument()
    expect(await within(sheet).findByRole('button', { name: 'Default folder/media/downloads' })).toBeInTheDocument()
    expect(getFolders).toHaveBeenCalledTimes(2)
  })

  it('saves nothing but a full path', async () => {
    const sheet = await openSheet()
    const field = await edit(sheet, /^Default folder/)

    await type(field, 'media/downloads')
    expect(within(sheet).getByText(/Type the full path/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()

    // Spaces around a full path are no part of it.
    await type(field, ' /media/downloads ')
    expect(within(sheet).queryByText(/Type the full path/)).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(prepareFolder).toHaveBeenCalledWith('/media/downloads')
    expect(setDefaultSavePath).toHaveBeenCalledWith('/media/downloads')
  })

  it('keeps the page where it is when the folder is sent with Enter', async () => {
    const sheet = await openSheet()
    await type(await edit(sheet, /^Default folder/), '/media/downloads')
    const submit = createEvent.submit(within(sheet).getByRole('textbox', { name: 'Folder' }).closest('form')!)
    fireEvent(within(sheet).getByRole('textbox', { name: 'Folder' }).closest('form')!, submit)

    expect(submit.defaultPrevented).toBe(true)
    expect(prepareFolder).toHaveBeenCalledWith('/media/downloads')
  })

  it('holds the folder while it’s sent', async () => {
    prepareFolder.mockReturnValue(new Promise(() => {}))
    const sheet = await openSheet()
    const field = await edit(sheet, /^Movies/)
    await type(field, '/media/films')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(field).toHaveAttribute('readonly')
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: 'Use the default' })).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: '/downloads' })).toBeDisabled()
  })

  it('offers the folders qBittorrent knows', async () => {
    const sheet = await openSheet()
    const field = await edit(sheet, /^Default folder/)

    expect(within(sheet).getByRole('button', { name: '/downloads' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(sheet).getByRole('button', { name: '/media/movies' }))
    expect(field).toHaveValue('/media/movies')
    expect(within(sheet).getByRole('button', { name: '/media/movies' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(sheet).getByRole('button', { name: '/downloads' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('says in the sheet when qBittorrent can’t create the folder, saves nothing, and takes the failure back on another try', async () => {
    prepareFolder.mockRejectedValueOnce(new api.QbittorrentError('qBittorrent responded 409', 409))
    const sheet = await openSheet()
    await type(await edit(sheet, /^Default folder/), '/root/downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('qBittorrent couldn’t create that folder.')
    expect(screen.queryByRole('status', { name: saying('qBittorrent couldn’t create that folder.') })).not.toBeInTheDocument()
    expect(setDefaultSavePath).not.toHaveBeenCalled()
    expect(within(sheet).getByRole('textbox', { name: 'Folder' })).toHaveValue('/root/downloads')

    prepareFolder.mockReturnValue(new Promise(() => {}))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says when qBittorrent didn’t take the folder', async () => {
    setDefaultSavePath.mockRejectedValue(new api.QbittorrentError('qBittorrent responded 500', 500))
    const sheet = await openSheet()
    await type(await edit(sheet, /^Default folder/), '/media/downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Couldn’t reach qBittorrent. Try again.')
    // Free to try again.
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(within(sheet).getByRole('textbox', { name: 'Folder' })).not.toHaveAttribute('readonly')
  })

  it('says a failure in a toast once the sheet has closed', async () => {
    let fail!: (error: unknown) => void
    prepareFolder.mockReturnValue(new Promise((_resolve, reject) => (fail = reject)))
    const sheet = await openSheet()
    await type(await edit(sheet, /^Default folder/), '/root/downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }))

    fail(new api.QbittorrentError('qBittorrent responded 409', 409))
    expect(await findToastOnPage('qBittorrent couldn’t create that folder.')).toBeInTheDocument()
  })

  it('opens on the list again after it was closed on a folder', async () => {
    const sheet = await openSheet()
    await edit(sheet, /^Movies/)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Folders' }))

    expect(await screen.findByRole('dialog', { name: 'qBittorrent folders' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Folder' })).not.toBeInTheDocument()
  })

  it('names a subcategory’s default folder under its parent’s own', async () => {
    getFolders.mockResolvedValue({ ...FOLDERS, categories: [MOVIES, { name: 'Movies/4K', savePath: '/media/4k' }] })
    const sheet = await openSheet()
    await edit(sheet, /^Movies\/4K/)
    expect(within(sheet).getByText('Without a folder of its own, the category keeps its torrents in /media/movies/4K.')).toBeInTheDocument()
  })

  it('sets a category’s folder, with the category as qBittorrent sent it', async () => {
    const sheet = await openSheet()
    const field = await edit(sheet, /^Movies/)
    expect(within(sheet).getByRole('heading', { name: 'Movies' })).toBeInTheDocument()
    expect(field).toHaveValue('/media/movies')

    await type(field, '/media/films')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(prepareFolder).toHaveBeenCalledWith('/media/films')
    expect(setCategoryFolder).toHaveBeenCalledWith(MOVIES, '/media/films')
    expect(setDefaultSavePath).not.toHaveBeenCalled()
  })

  it('puts a category back in the default folder without making a folder, and says where that is', async () => {
    const sheet = await openSheet()
    await edit(sheet, /^Movies/)
    expect(within(sheet).getByText('Without a folder of its own, the category keeps its torrents in /downloads/Movies.')).toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: 'Use the default' }))
    expect(setCategoryFolder).toHaveBeenCalledWith(MOVIES, '')
    expect(prepareFolder).not.toHaveBeenCalled()
  })

  it('offers the default only to a category with a folder of its own', async () => {
    const sheet = await openSheet()
    await edit(sheet, /^TV/)
    expect(within(sheet).getByRole('button', { name: 'Use the default' })).toBeDisabled()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    await edit(sheet, /^Default folder/)
    expect(within(sheet).queryByRole('button', { name: 'Use the default' })).not.toBeInTheDocument()
  })

  it.each([
    [/^Default folder/, { relocateOnDefaultPathChange: true }, 'move the files'],
    [/^Default folder/, { relocateOnCategoryPathChange: true }, 'switch torrents'],
    [/^Movies/, { relocateOnCategoryPathChange: true }, 'move the files'],
    [/^Movies/, { relocateOnDefaultPathChange: true }, 'switch torrents'],
  ])('says what happens to the torrents in %s as qBittorrent’s settings say (%o)', async (row, settings, says) => {
    getFolders.mockResolvedValue({ ...FOLDERS, ...settings })
    const sheet = await openSheet()
    await edit(sheet, row)
    expect(within(sheet).getByText(new RegExp(`^qBittorrent will ${says}`))).toBeInTheDocument()
    expect(within(sheet).getByText('If the folder isn’t there, qBittorrent creates it.')).toBeInTheDocument()
  })
})
