import { SERVER_SETTINGS_KEY, getServerSettings } from '../api/settings'
import { useRequest } from '../lib/useRequest'

/**
 * Whether Kinopeer's server has a channel set up to notify when a download finishes, so the app
 * offers the switch. Read from the page's answer of GET /api/settings, however old: setting a
 * channel up or forgetting it in Settings keeps its answer in that place, and one set up on another
 * device shows after a reload. Asked only when the page has no answer yet.
 */
export function useNotificationsAvailable(): boolean {
  // The WebUI build has no Kinopeer server to notify: nothing to ask.
  const { data } = useRequest(__WEBUI__ ? null : SERVER_SETTINGS_KEY, (signal) => getServerSettings(signal), { freshFor: Infinity })
  return !__WEBUI__ && data?.notifications === true
}
