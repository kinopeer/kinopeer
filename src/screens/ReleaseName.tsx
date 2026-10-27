import { useState } from 'react'
import { useIsDesktop } from '../lib/useIsDesktop'

interface ReleaseNameProps {
  name: string
}

/**
 * A release's name, clipped to two lines. On desktop the whole name is a tooltip on hover (the
 * browser's own, so it shows after its usual short delay); on a phone, where there's no hover, the
 * name is a button that shows the whole name on a tap.
 */
export function ReleaseName({ name }: ReleaseNameProps) {
  const desktop = useIsDesktop()
  const [expanded, setExpanded] = useState(false)
  if (desktop) {
    return (
      <span className="t-label rel-name ks-clamp2" title={name}>
        {name}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={expanded ? 't-label rel-name' : 't-label rel-name ks-clamp2'}
      aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}
    >
      {name}
    </button>
  )
}
