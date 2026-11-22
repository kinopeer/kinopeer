import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Folders } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { FoldersSheet } from './FoldersSheet'
import { held } from '../test/held'
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

/** Settings with the sheet open, left without closing it (the browser's Back on desktop), and opened again. */
function Leaving() {
  const [here, setHere] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setHere(!here)}>
        {here ? 'Leave' : 'Come back'}
      </button>
      {here && <FoldersSheet open onClose={() => {}} />}
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
    const answer = held<Folders>()
    getFolders.mockReturnValue(answer.promise)
    const sheet = await openSheet()
    expect(within(sheet).getByRole('status', { name: 'Loading folders' })).toBeInTheDocument()

    answer.resolve(FOLDERS)
    expect(await within(sheet).findByRole('button', { name: /^Default folder/ })).toBeInTheDocument()
    expect(within(sheet).queryByRole('status', { name: 'Loading folders' })).not.toBeInTheDocument()
  })

  it('says when qBittorrent didn’t send its folders, and asks again on Try again', async () => {
    getFolders.mockRejectedValueOnce(new api.QbittorrentError('qBittorrent responded 500', 500))
    const sheet = await openSheet()

    expect(await within(sheet).findByRole('alert', { name: saying('qBittorrent didn’t send its folders. Try again.') })).toBeInTheDocument()
    expect(within(sheet).queryByRole('status', { name: 'Loading folders' })).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    expect(await within(sheet).findByRole('button', { name: /^Default folder/ })).toBeInTheDocument()
  })

  it('has qBittorrent create the default folder, then saves it, and shows the folders again as they are now', async () => {
    const sheet = await openSheet()
    const field = await edit(sheet, /^Default folder/)
    expect(field).toHaveValue('/downloads')
    // A path is machine text: no autocorrect (iOS Safari's, #494) or spell check.
    expect(field).toHaveAttribute('autocorrect', 'off')
    expect(field).toHaveAttribute('spellcheck', 'false')
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
    // A path, not words: no spelling marks.
    expect(field).toHaveAttribute('spellcheck', 'false')

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

    expect(await within(sheet).findByRole('alert', { name: saying('qBittorrent couldn’t create that folder.') })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: saying('qBittorrent couldn’t create that folder.') })).not.toBeInTheDocument()
    expect(setDefaultSavePath).not.toHaveBeenCalled()
    expect(within(sheet).getByRole('textbox', { name: 'Folder' })).toHaveValue('/root/downloads')

    prepareFolder.mockReturnValue(new Promise(() => {}))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    // A category's step only says a category is gone.
    ['the default folder', /^Default folder/, setDefaultSavePath, 404],
    ['a category’s folder', /^Movies/, setCategoryFolder, 500],
  ])('says when qBittorrent didn’t take %s, and asks for nothing more on Back', async (_, row, call, status) => {
    call.mockRejectedValue(new api.QbittorrentError(`qBittorrent responded ${status}`, status))
    const sheet = await openSheet()
    await type(await edit(sheet, row), '/media/downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    // Free to try again.
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(within(sheet).getByRole('textbox', { name: 'Folder' })).not.toHaveAttribute('readonly')

    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    await edit(sheet, row)
    // The failure was that time's.
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
    expect(getFolders).toHaveBeenCalledTimes(1)
  })

  it('says a failure in a toast once the sheet has closed', async () => {
    const save = held()
    prepareFolder.mockReturnValue(save.promise)
    const sheet = await openSheet()
    await type(await edit(sheet, /^Default folder/), '/root/downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }))

    save.reject(new api.QbittorrentError('qBittorrent responded 409', 409))
    expect(await findToastOnPage('qBittorrent couldn’t create /root/downloads.')).toBeInTheDocument()
  })

  it('leaves another folder shown alone when a save settles after its form, and shows the list as it is now once back', async () => {
    const save = held()
    setCategoryFolder.mockReturnValueOnce(save.promise)
    const sheet = await openSheet()
    await type(await edit(sheet, /^Movies/), '/media/films')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    const field = await edit(sheet, /^TV/)
    await type(field, '/media/shows')

    getFolders.mockResolvedValue({ ...FOLDERS, categories: [{ ...MOVIES, savePath: '/media/films' }, TV] })
    save.resolve()
    expect(await screen.findByRole('status', { name: saying('Folder saved') })).toBeInTheDocument()
    expect(within(sheet).getByRole('heading', { name: 'TV' })).toBeInTheDocument()
    expect(field).toHaveValue('/media/shows')
    expect(getFolders).toHaveBeenCalledTimes(1)

    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    expect(await within(sheet).findByRole('button', { name: 'Movies/media/films' })).toBeInTheDocument()
    expect(getFolders).toHaveBeenCalledTimes(2)
    // Once.
    await edit(sheet, /^TV/)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    expect(getFolders).toHaveBeenCalledTimes(2)
  })

  it('shows the list as it is now once, when a folder saved there follows a save settled elsewhere', async () => {
    const save = held()
    setCategoryFolder.mockReturnValueOnce(save.promise)
    const sheet = await openSheet()
    await type(await edit(sheet, /^Movies/), '/media/films')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    await type(await edit(sheet, /^TV/), '/media/shows')
    await act(async () => save.resolve())

    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(sheet).findByRole('button', { name: /^Default folder/ })).toBeInTheDocument()
    expect(getFolders).toHaveBeenCalledTimes(2)
    await edit(sheet, /^TV/)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    expect(getFolders).toHaveBeenCalledTimes(2)
  })

  it('shows the list as it is now when a save settles there', async () => {
    const save = held()
    setDefaultSavePath.mockReturnValueOnce(save.promise)
    const sheet = await openSheet()
    await type(await edit(sheet, /^Default folder/), '/media/downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))

    getFolders.mockResolvedValue({ ...FOLDERS, defaultPath: '/media/downloads' })
    save.resolve()
    expect(await within(sheet).findByRole('button', { name: 'Default folder/media/downloads' })).toBeInTheDocument()
  })

  it('keeps a folder busy with what’s sent when it’s opened again before its save settles', async () => {
    prepareFolder.mockReturnValue(new Promise(() => {}))
    const sheet = await openSheet()
    await type(await edit(sheet, /^Movies/), '/media/films')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))

    expect(getFolders).toHaveBeenCalledTimes(1)
    const field = await edit(sheet, /^Movies/)
    expect(field).toHaveValue('/media/films')
    expect(field).toHaveAttribute('readonly')
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: 'Use the default' })).toBeDisabled()
    expect(prepareFolder).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['before 5.2', 409],
    ['from 5.2', 404],
  ])('says when qBittorrent no longer has the category (%s), and shows the list as it is now once back', async (_, status) => {
    setCategoryFolder.mockRejectedValue(new api.QbittorrentError(`qBittorrent responded ${status}`, status))
    const sheet = await openSheet()
    await type(await edit(sheet, /^Movies/), '/media/films')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(
      await within(sheet).findByRole('alert', { name: saying('qBittorrent no longer has this category. Go back to see the ones it has.') }),
    ).toBeInTheDocument()
    expect(prepareFolder).toHaveBeenCalledWith('/media/films')

    getFolders.mockResolvedValue({ ...FOLDERS, categories: [TV] })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    expect(await within(sheet).findByRole('button', { name: 'TV/downloads/TV' })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /^Movies/ })).not.toBeInTheDocument()
  })

  it('asks for the folders once each time it opens, whatever a save settled while it was elsewhere', async () => {
    const save = held()
    const later = held()
    setCategoryFolder.mockReturnValueOnce(save.promise)
    setCategoryFolder.mockReturnValueOnce(later.promise)
    const sheet = await openSheet()
    // Settled while another folder is shown, then closed: the next opening's load is the one.
    await type(await edit(sheet, /^Movies/), '/media/films')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    await edit(sheet, /^TV/)
    save.resolve()
    expect(await screen.findByRole('status', { name: saying('Folder saved') })).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Folders' }))
    await edit(screen.getByRole('dialog', { name: 'qBittorrent folders' }), /^TV/)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(getFolders).toHaveBeenCalledTimes(2)

    // Settled while closed: the same.
    await type(await edit(screen.getByRole('dialog', { name: 'qBittorrent folders' }), /^Movies/), '/media/other')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await act(async () => later.resolve())
    await userEvent.click(screen.getByRole('button', { name: 'Folders' }))
    await edit(screen.getByRole('dialog', { name: 'qBittorrent folders' }), /^TV/)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(getFolders).toHaveBeenCalledTimes(3)
  })

  it('says a failure in a toast once Settings has gone with the sheet open', async () => {
    const save = held()
    prepareFolder.mockReturnValue(save.promise)
    render(<Leaving />, { wrapper: ToastProvider })
    const sheet = screen.getByRole('dialog', { name: 'qBittorrent folders' })
    await type(await edit(sheet, /^Default folder/), '/root/downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Leave', hidden: true }))
    expect(screen.queryByRole('dialog', { name: 'qBittorrent folders' })).not.toBeInTheDocument()

    save.reject(new api.QbittorrentError('qBittorrent responded 409', 409))
    expect(await findToastOnPage('qBittorrent couldn’t create /root/downloads.')).toBeInTheDocument()
  })

  it('shows a folder’s save from Settings left in the sheet opened again, busy with what’s sent, and goes back to the list once it’s saved', async () => {
    const save = held()
    setCategoryFolder.mockReturnValueOnce(save.promise)
    render(<Leaving />, { wrapper: ToastProvider })
    await type(await edit(screen.getByRole('dialog', { name: 'qBittorrent folders' }), /^Movies/), '/media/films')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Leave', hidden: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Come back' }))

    const sheet = screen.getByRole('dialog', { name: 'qBittorrent folders' })
    const field = await edit(sheet, /^Movies/)
    expect(field).toHaveValue('/media/films')
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    getFolders.mockResolvedValue({ ...FOLDERS, categories: [{ ...MOVIES, savePath: '/media/films' }, TV] })
    await act(async () => save.resolve())
    expect(await within(sheet).findByRole('button', { name: 'Movies/media/films' })).toBeInTheDocument()
    expect(setCategoryFolder).toHaveBeenCalledTimes(1)
  })

  it('says a folder’s failure from Settings left in the sheet opened again on that folder, with no toast', async () => {
    const save = held()
    prepareFolder.mockReturnValueOnce(save.promise)
    render(<Leaving />, { wrapper: ToastProvider })
    await type(await edit(screen.getByRole('dialog', { name: 'qBittorrent folders' }), /^Default folder/), '/root/downloads')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Leave', hidden: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Come back' }))

    const sheet = screen.getByRole('dialog', { name: 'qBittorrent folders' })
    await edit(sheet, /^Default folder/)
    await act(async () => save.reject(new api.QbittorrentError('qBittorrent responded 409', 409)))
    expect(await within(sheet).findByRole('alert', { name: saying('qBittorrent couldn’t create that folder.') })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it.each([
    ['the folder it couldn’t create', prepareFolder, 409, 'qBittorrent couldn’t create /media/films.'],
    ['the category it no longer has', setCategoryFolder, 404, 'qBittorrent no longer has the category Movies.'],
  ])('names %s in the toast when another folder is shown', async (_, call, status, says) => {
    const save = held()
    call.mockReturnValueOnce(save.promise)
    const sheet = await openSheet()
    await type(await edit(sheet, /^Movies/), '/media/films')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    await edit(sheet, /^TV/)

    save.reject(new api.QbittorrentError(`qBittorrent responded ${status}`, status))
    expect(await screen.findByRole('status', { name: saying(says) })).toBeInTheDocument()
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says a failure its form shows only there, not in a toast too', async () => {
    prepareFolder.mockRejectedValueOnce(new api.QbittorrentError('qBittorrent responded 409', 409))
    const sheet = await openSheet()
    await type(await edit(sheet, /^Default folder/), '/root/downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(await within(sheet).findByRole('alert', { name: saying('qBittorrent couldn’t create that folder.') })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the list as it is now once back, when a category went while another folder was shown', async () => {
    const save = held()
    setCategoryFolder.mockReturnValueOnce(save.promise)
    const sheet = await openSheet()
    await type(await edit(sheet, /^Movies/), '/media/films')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    await edit(sheet, /^TV/)

    getFolders.mockResolvedValue({ ...FOLDERS, categories: [TV] })
    save.reject(new api.QbittorrentError('qBittorrent responded 404', 404))
    expect(await screen.findByRole('status', { name: saying('qBittorrent no longer has the category Movies.') })).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    expect(await within(sheet).findByRole('button', { name: 'TV/downloads/TV' })).toBeInTheDocument()
    expect(getFolders).toHaveBeenCalledTimes(2)
  })

  it('sends a folder once when its form is submitted again while the save is on its way', async () => {
    prepareFolder.mockReturnValue(new Promise(() => {}))
    const sheet = await openSheet()
    await type(await edit(sheet, /^Default folder/), '/media/downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    // Enter in the field submits the form, whatever its button.
    fireEvent.submit(within(sheet).getByRole('textbox', { name: 'Folder' }).closest('form')!)
    await act(async () => {})

    expect(prepareFolder).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says qBittorrent’s own failure in a toast when another folder is shown', async () => {
    const save = held()
    setCategoryFolder.mockReturnValueOnce(save.promise)
    const sheet = await openSheet()
    await type(await edit(sheet, /^Movies/), '/media/films')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    await edit(sheet, /^TV/)

    save.reject(new api.QbittorrentError('qBittorrent responded 500', 500))
    expect(await screen.findByRole('status', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    // Nothing gone: Back asks for nothing.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    expect(getFolders).toHaveBeenCalledTimes(1)
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
