import type { NotifyLanguage } from '../settings/types.ts'

/**
 * Web Push to the devices where Kinopeer is installed (server/push.ts): each device's subscription
 * is kept on the server, which sends through the push service the subscription names.
 * GET    /api/push/key          → PushKey, the server's VAPID public key (made on first need)
 * PUT    /api/push/subscription PushSubscriptionBody → saves this device, answers ServerSettings
 * DELETE /api/push/subscription PushEndpointBody     → forgets this device, answers ServerSettings
 * POST   /api/push/test         PushEndpointBody     → a test notification to this device, 204
 */

export interface PushKey {
  /** For `applicationServerKey`: the uncompressed P-256 point, base64url. */
  publicKey: string
}

/** What the server knows of push in GET /api/settings. Servers before 1.1 don't send it. */
export interface PushStatus {
  /** How many devices get notifications. */
  devices: number
}

/** Body of PUT /api/push/subscription: a PushSubscription's endpoint and keys, and the language to write in. */
export interface PushSubscriptionBody {
  endpoint: string
  p256dh: string
  auth: string
  /** The interface's language; a renewed subscription keeps the one of the subscription it replaces. */
  language: NotifyLanguage
  /** The endpoint this one replaces, when the browser renewed the subscription. */
  replaces?: string
}

export interface PushEndpointBody {
  endpoint: string
}

/** What a push carries: the notification, and the page a tap opens. */
export interface PushPayload {
  title: string
  body: string
  /** A path of the app's. */
  url: string
  /** A notification with the same tag replaces the one before. */
  tag: string
}

/** Error answers of /api/push. */
export interface PushErrorBody {
  error:
    | 'bad-request'
    | 'invalid-endpoint'
    /** The server doesn't know the device (POST /api/push/test). */
    | 'unknown-device'
    /** The push service said the subscription is gone; the server forgot it. */
    | 'gone'
    /** The push service refused the push. */
    | 'refused'
    /** The push service didn't answer. */
    | 'unreachable'
    | 'not-found'
    | 'storage'
}
