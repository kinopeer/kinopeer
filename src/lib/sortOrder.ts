/** A sort and its direction. */
export interface SortOrder<Key extends string> {
  key: Key
  descending: boolean
}

/** Each sort's usual direction: whether a pick of it, or its column's first click, is descending. */
export type UsualDirections<Key extends string> = Record<Key, boolean>

/** `key` in its usual direction. */
export function usualOrder<Key extends string>(key: Key, usuallyDescending: UsualDirections<Key>): SortOrder<Key> {
  return { key, descending: usuallyDescending[key] }
}

/** The order after a click on `key`'s column: reversed if it's the current sort, else its usual direction. */
export function clickedOrder<Key extends string>(
  current: SortOrder<Key>,
  key: Key,
  usuallyDescending: UsualDirections<Key>,
): SortOrder<Key> {
  return current.key === key ? reversedOrder(current) : usualOrder(key, usuallyDescending)
}

/** The same sort the other way, what the direction button gives. */
export function reversedOrder<Key extends string>(current: SortOrder<Key>): SortOrder<Key> {
  return { key: current.key, descending: !current.descending }
}

/**
 * The order after a press on a control that walks through `keys`: the current sort the other way
 * while it's in its usual direction, then the next sort in its usual direction.
 */
export function cycledOrder<Key extends string>(
  current: SortOrder<Key>,
  keys: readonly Key[],
  usuallyDescending: UsualDirections<Key>,
): SortOrder<Key> {
  if (current.descending === usuallyDescending[current.key]) return reversedOrder(current)
  return usualOrder(keys[(keys.indexOf(current.key) + 1) % keys.length], usuallyDescending)
}
