import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { failureText } from './failureText'

const t = i18n.t.bind(i18n)

describe('failureText', () => {
  it('says what to check for each cause, naming the service', () => {
    expect(failureText(t, 'prowlarr', 'name')).toBe('Kinopeer’s server can’t find this host. Check the name, or use the IP address.')
    expect(failureText(t, 'prowlarr', 'refused')).toBe(
      'Nothing listens on this port: check it, and that Prowlarr takes connections from the network, not only from 127.0.0.1.',
    )
    expect(failureText(t, 'prowlarr', 'timeout')).toBe('Nothing answered in time: a firewall may be in the way, or the host is wrong.')
    expect(failureText(t, 'qbittorrent', 'http')).toBe('qBittorrent answers here without HTTPS: start the address with http://.')
    expect(failureText(t, 'prowlarr', 'certificate')).toBe('Kinopeer’s server doesn’t trust Prowlarr’s certificate. Use its http:// address.')
    expect(failureText(t, 'qbittorrent', 'closed')).toBe(
      'The connection closed without an answer: check the port, and http:// or https:// at the start.',
    )
  })

  it('names qBittorrent’s Web UI where nothing listens, since its port answers only while that’s on', () => {
    expect(failureText(t, 'qbittorrent', 'refused')).toBe(
      'Nothing listens on this port: check it, and that qBittorrent’s Web UI is on and takes connections from the network, not only from 127.0.0.1.',
    )
  })

  it('says nothing when the server couldn’t tell why', () => {
    expect(failureText(t, 'qbittorrent', undefined)).toBeUndefined()
  })
})
