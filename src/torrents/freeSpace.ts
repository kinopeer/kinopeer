/**
 * The free space qBittorrent reports for its default save path, or undefined when it can't tell:
 * it reports 0 or less then, e.g. before its first disk check or when the path is unavailable.
 */
export function freeSpace(reported: number | undefined): number | undefined {
  return reported !== undefined && reported > 0 ? reported : undefined
}
