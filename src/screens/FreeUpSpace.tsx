import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Checkbox } from '../components/Checkbox'
import { IconButton } from '../components/IconButton'
import { ProgressBar } from '../components/ProgressBar'
import { Segmented } from '../components/Segmented'
import { Sheet } from '../components/Sheet'
import { SortDirectionButton } from '../components/SortDirectionButton'
import { useFormatters } from '../lib/format'
import { unreachableText } from '../lib/unreachable'
import { reversedOrder, usualOrder } from '../logic/sortOrder'
import { useSettings } from '../settings/settings'
import { FREE_UP_SORTS, FREE_UP_USUALLY_DESCENDING, countedSpace, groupForFreeUp, onDisk } from '../torrents/freeUpSpace'
import { useMainData } from '../torrents/useMainData'
import { useDeleteTorrents } from './useDeleteTorrents'
import './FreeUpSpace.css'

export interface FreeUpSpaceProps {
  /** The step is shown; while it isn't, only a delete's confirmation sent from it stays. */
  open: boolean
  /** What the download takes. */
  size: number
  /** The free space as shown: qBittorrent's figure, or the estimate after a delete. */
  free: number | undefined
  /** `free` is an estimate: qBittorrent hasn't measured since a delete. */
  estimate: boolean
  /** qBittorrent's default save path, whose disk `free` is for; undefined until it's known. */
  defaultSavePath: string | undefined
  subtitle: string
  /** After qBittorrent deleted torrents from here: what they had on disk where `free` counts. */
  onFreed: (bytes: number) => void
  onBack: () => void
}

/**
 * The add sheet's step that frees space for a download: qBittorrent's torrents with what they have
 * on disk, to pick and delete with their files. Those saved in the default save path or under it
 * come first and count toward the space needed; the rest may be on another disk (groupForFreeUp).
 * Rendered while the add sheet is, so a delete that settles after Back still reaches `onFreed`.
 */
export function FreeUpSpace({ open, size, free, estimate, defaultSavePath, subtitle, onFreed, onBack }: FreeUpSpaceProps) {
  const { t, i18n } = useTranslation()
  const elsewhereId = useId()
  const format = useFormatters()
  const { data, offline, unreachable, refresh } = useMainData()
  const [settings, updateSettings] = useSettings()
  const { freeUpSort, freeUpSortDescending } = settings
  const order = useMemo(() => ({ key: freeUpSort, descending: freeUpSortDescending }), [freeUpSort, freeUpSortDescending])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const torrents = data?.torrents
  const groups = useMemo(
    () => groupForFreeUp(Object.values(torrents ?? {}), defaultSavePath ?? '', order),
    [torrents, defaultSavePath, order],
  )
  const chosen = [...groups.counted, ...groups.elsewhere].filter((torrent) => selected.has(torrent.hash))
  const chosenSpace = countedSpace(chosen, defaultSavePath)
  const missing = free === undefined ? undefined : Math.max(0, size - free)

  const deleting = useDeleteTorrents({
    torrents,
    titleOf: (torrent) => torrent.name,
    withFiles: true,
    onDeleted: (deleted) => {
      onFreed(countedSpace(deleted, defaultSavePath))
      setSelected((current) => {
        const next = new Set(current)
        for (const torrent of deleted) next.delete(torrent.hash)
        return next
      })
    },
  })

  if (!open) return deleting.element

  const setOrder = (next: { key: (typeof FREE_UP_SORTS)[number]; descending: boolean }) =>
    updateSettings({ freeUpSort: next.key, freeUpSortDescending: next.descending })
  const toggle = (hash: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(hash)
    else next.delete(hash)
    setSelected(next)
  }

  const ratio = (value: number) => value.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const row = (torrent: Torrent) => (
    <li key={torrent.hash} className="fu-row">
      <Checkbox label={torrent.name} checked={selected.has(torrent.hash)} onChange={(on) => toggle(torrent.hash, on)} />
      <span className="fu-row-text">
        <span className="t-body ks-trunc" title={torrent.name}>
          {torrent.name}
        </span>
        <span className="t-cap ks-num c3">
          {[
            format.size(onDisk(torrent)),
            ...(torrent.added_on > 0 ? [format.age(new Date(torrent.added_on * 1000))] : []),
            t('torrent.ratioValue', { ratio: ratio(torrent.ratio) }),
          ].join(' · ')}
        </span>
      </span>
    </li>
  )

  const loading = data === null && !offline
  const none = data !== null && groups.counted.length === 0 && groups.elsewhere.length === 0
  const freeText =
    free === undefined
      ? undefined
      : t('common.freeSpace', { size: estimate ? t('common.approximately', { value: format.size(free) }) : format.size(free) })

  return (
    <>
      <Sheet
        open
        onClose={onBack}
        title={t('freeUp.title')}
        subtitle={subtitle}
        size="lg"
        leading={<IconButton icon="chevron-left" label={t('common.back')} iconSize={24} onClick={onBack} />}
        footer={
          <div className="fp-foot">
            <div className="fp-summary">
              <span className="t-label ks-num fp-count" aria-live="polite">
                {missing === undefined || missing > 0
                  ? t('freeUp.counter', {
                      selected: format.size(chosenSpace),
                      needed: format.size(missing ?? size),
                    })
                  : t('freeUp.enough')}
              </span>
              {freeText && <span className="t-cap ks-num c3">{freeText}</span>}
            </div>
            {missing !== undefined && missing > 0 && (
              <ProgressBar
                value={Math.min(1, chosenSpace / missing)}
                status={chosenSpace >= missing ? 'seeding' : 'downloading'}
                label={t('freeUp.progress')}
              />
            )}
            {chosen.length === 0 && missing === 0 ? (
              <Button variant="primary" block onClick={onBack}>
                {t('freeUp.backToAdd')}
              </Button>
            ) : (
              <Button
                variant="danger"
                block
                icon="trash"
                disabled={chosen.length === 0 || offline}
                onClick={() => deleting.open(chosen)}
              >
                {chosen.length > 0 ? t('freeUp.delete', { count: chosen.length }) : t('torrent.delete')}
              </Button>
            )}
          </div>
        }
      >
        <div className="fu-body">
          <div className="fu-sort">
            <Segmented
              label={t('common.sort')}
              options={FREE_UP_SORTS.map((key) => ({ value: key, label: t(`freeUp.sort.${key}`) }))}
              value={order.key}
              onChange={(key) => setOrder(usualOrder(key, FREE_UP_USUALLY_DESCENDING))}
            />
            <SortDirectionButton descending={order.descending} onReverse={() => setOrder(reversedOrder(order))} />
          </div>
          {offline && (
            <Banner tone="error" actionLabel={t('common.retry')} onAction={refresh}>
              {t('common.qbtFailed', { context: unreachableText(unreachable) })}
            </Banner>
          )}
          {loading && (
            <div className="fu-loading" role="status">
              <span className="ks-spin ca" />
              <span className="c2">{t('freeUp.loading')}</span>
            </div>
          )}
          {none && <p className="t-body c2">{t('freeUp.empty')}</p>}
          {groups.counted.length > 0 && <ul className="fu-list">{groups.counted.map(row)}</ul>}
          {groups.elsewhere.length > 0 && (
            <section className="fu-group" aria-labelledby={elsewhereId}>
              <div className="fu-group-head">
                <h3 id={elsewhereId} className="t-label">
                  {t('freeUp.elsewhere')}
                </h3>
                <p className="t-cap c3">{t('freeUp.elsewhereHint')}</p>
              </div>
              <ul className="fu-list">{groups.elsewhere.map(row)}</ul>
            </section>
          )}
        </div>
      </Sheet>
      {deleting.element}
    </>
  )
}
