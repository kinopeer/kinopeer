/** A filter value's chip by its label, whatever count it shows after it (#583). */
export const counted = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`)

/** A filter value chip's label, without the count after it. */
export const labelOf = (chip: HTMLElement) => chip.textContent?.replace(/ \d+$/, '')
