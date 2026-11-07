# Security

## Supported versions

Fixes go into the latest release only. Kinopeer Edge, the builds from `main`, is the maintainer's test build and isn't supported.

## Reporting a vulnerability

Don't open a public issue. Report it privately through GitHub: [Security → Report a vulnerability](https://github.com/kinopeer/kinopeer/security/advisories/new). Describe the steps, your version (Settings → About) and where Kinopeer runs (Umbrel, the dev server). Leave out your own passwords and keys.

You'll get an answer within a week. The fix ships in a patch release, and the advisory is published after it, crediting you if you'd like.

## Scope

Kinopeer's server and client, Kinopeer's TMDB proxy on Cloudflare (`tmdb-proxy/`), the images on `ghcr.io/kinopeer`, this repository's workflows, and the Kinopeer apps in the [Homelab](https://github.com/MrShakhov/umbrel-homelab-store) and [Homelab Edge](https://github.com/MrShakhov/umbrel-homelab-edge) stores for Umbrel. Vulnerabilities in qBittorrent, Prowlarr or Umbrel themselves go to their authors.

Kinopeer has no login of its own: on Umbrel, Umbrel's login protects it. Whoever reaches Kinopeer's port past Umbrel controls it; that's by design, not a vulnerability.
