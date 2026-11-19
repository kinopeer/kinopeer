/**
 * What a request needs before the server answers it with Kinopeer's own login on
 * (server/auth.ts): to sign in, or to set the password first, on a server that has none yet.
 */
export type SignInNeed = 'sign-in' | 'set-up'

/** Kinopeer's own login, as GET /api/settings tells it. */
export type AuthStatus =
  /** KINOPEER_AUTH=off: a login in front of Kinopeer (Umbrel's) is the only one. */
  | { enabled: false }
  /** On, with the password from KINOPEER_PASSWORD (`env`, which the app can't change) or set in the app. */
  | { enabled: true; source: 'env' | 'saved' }

/** Body of POST /api/auth/setup and /api/auth/login. */
export interface PasswordBody {
  password: string
}

/** Body of PUT /api/auth/password. */
export interface ChangePasswordBody {
  current: string
  password: string
}

/** Error answers of /api/auth, and of every guarded route before signing in (`SignInNeed`). */
export interface AuthErrorBody {
  error:
    | SignInNeed
    | 'bad-request'
    | 'too-short'
    | 'already-set'
    | 'not-set-up'
    | 'invalid-password'
    | 'throttled'
    | 'env-password'
    | 'auth-off'
    | 'storage'
    | 'not-found'
  /** With 'throttled', and with 'invalid-password' when that try started a wait: how long, in ms. */
  retryAfterMs?: number
}
