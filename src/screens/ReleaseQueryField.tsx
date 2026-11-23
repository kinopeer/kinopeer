import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '../components/IconButton'
import { Input } from '../components/Input'
import type { Releases } from './useReleases'

/**
 * The releases' search query, as Kinopeer built it or as the user edited it (#582): a submit searches
 * by the text, and Reset brings the built query back. It searches only on submit, since a search asks
 * every indexer. Keyed by the query shown, so a new one, Reset's or another title's, replaces the text.
 */
export function ReleaseQueryField({ releases }: { releases: Releases }) {
  return <QueryForm key={releases.query} releases={releases} />
}

function QueryForm({ releases }: { releases: Releases }) {
  const { t } = useTranslation()
  const [text, setText] = useState(releases.query)

  return (
    <form
      role="search"
      className="rel-query"
      onSubmit={(event) => {
        event.preventDefault()
        releases.searchBy(text)
        // An empty query searches by the built one, which the field shows again.
        setText(text.trim() || releases.query)
      }}
    >
      <Input
        icon="search"
        type="search"
        aria-label={t('releases.query')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        enterKeyHint="search"
        autoComplete="off"
      />
      {releases.edited && (
        <IconButton icon="close" label={t('releases.resetQuery')} iconSize={18} className="rel-query-reset" onClick={releases.resetQuery} />
      )}
    </form>
  )
}
