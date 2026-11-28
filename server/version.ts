// The image copies package.json next to server/ (Dockerfile), so the import finds it there too.
import pkg from '../package.json' with { type: 'json' }

/**
 * Kinopeer's version as package.json has it. Edge builds' commit isn't in it; the edge worker of
 * the TMDB proxy already tells their calls apart.
 */
export const VERSION: string = pkg.version
