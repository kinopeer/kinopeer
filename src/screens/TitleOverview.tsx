import { useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { cx } from '../lib/cx'

interface TitleOverviewProps {
  text: string
}

/**
 * The desktop hero's overview: a few lines, with "Show more" when there's more, so a long TMDB
 * overview doesn't push the hero down. The button is there only while the text is clipped,
 * measured once laid out and again when the font arrives or the width changes; in jsdom, where
 * nothing has a size, the text counts as fitting.
 */
export function TitleOverview({ text }: TitleOverviewProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [clipped, setClipped] = useState(false)
  const [element, setElement] = useState<HTMLParagraphElement | null>(null)

  useLayoutEffect(() => {
    if (!element || expanded) return
    const measure = () => setClipped(element.scrollHeight > element.clientHeight)
    measure()
    void document.fonts?.ready.then(measure)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, expanded, text])

  return (
    <section className="title-doverview" aria-labelledby="title-overview">
      <h2 id="title-overview" className="sr-only">
        {t('title.overview')}
      </h2>
      <p
        ref={setElement}
        id="title-overview-text"
        className={cx('t-body-lg c2 title-doverview-text', !expanded && 'is-clamped')}
      >
        {text}
      </p>
      {(clipped || expanded) && (
        <Button
          variant="ghost"
          size="sm"
          icon={expanded ? 'chevron-up' : 'chevron-down'}
          className="title-doverview-more"
          aria-expanded={expanded}
          aria-controls="title-overview-text"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t('title.showLess') : t('title.showMore')}
        </Button>
      )}
    </section>
  )
}
