import { useEffect, useState, type ReactNode } from 'react'
import { MainDataContext, createMainDataStore } from './useMainData'

export interface MainDataProviderProps {
  /** qBittorrent rejected the session (expired or signed out elsewhere). */
  onUnauthorized: () => void
  children: ReactNode
}

/**
 * One /sync/maindata poll for the screens and the sidebar under it, so a drawer over Downloads or the
 * sidebar's counter doesn't poll a second time. It polls only while one of them uses `useMainData`.
 */
export function MainDataProvider({ onUnauthorized, children }: MainDataProviderProps) {
  const [store] = useState(createMainDataStore)
  useEffect(() => store.setUnauthorizedHandler(onUnauthorized), [store, onUnauthorized])
  return <MainDataContext value={store}>{children}</MainDataContext>
}
