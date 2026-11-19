# Security

## Supported versions

Fixes go into the latest release only. Kinopeer Edge, the builds from `main`, is the maintainer's test build and isn't supported.

## Reporting a vulnerability

Don't open a public issue. Report it privately through GitHub: [Security → Report a vulnerability](https://github.com/kinopeer/kinopeer/security/advisories/new). Describe the steps, your version (Settings → About) and where Kinopeer runs (Umbrel, Docker Compose, the dev server). Leave out your own passwords and keys.

You'll get an answer within a week. The fix ships in a patch release, and the advisory is published after it, crediting you if you'd like.

## Scope

Kinopeer's server and client, Kinopeer's TMDB proxy on Cloudflare (`tmdb-proxy/`), the images on `ghcr.io/kinopeer`, this repository's workflows, the Kinopeer app in the [Homelab store](https://github.com/MrShakhov/umbrel-homelab-store) for Umbrel, and `docker-compose.yml`, which the README's install steps use. Vulnerabilities in qBittorrent, Prowlarr or Umbrel themselves go to their authors.

Kinopeer has a login of its own, on unless `KINOPEER_AUTH=off`: a way past it to qBittorrent, Prowlarr, TMDB or the saved settings is in scope. On Umbrel the package turns it off, since Umbrel's login protects Kinopeer; there, whoever reaches Kinopeer's port past Umbrel controls it, and so does anyone where an install turned the login off without a login of its own in front. That's by design, not a vulnerability.

What the login doesn't cover, by design:

- The app's own files (the page, its scripts, icons) are served to anyone: they hold no secrets, and the sign-in screen is one of them.
- Kinopeer is served over plain HTTP unless something in front adds HTTPS, so on such a network the password and the session cookie can be read in transit.
- Browsers share cookies between the ports of one host, so another app on the same host and address, on another port, can read Kinopeer's session cookie if it's compromised.
- Wrong passwords are counted per address, in memory: a restart forgets them, and behind a reverse proxy every request comes from the proxy, so a guesser there locks everyone out for as long as they keep guessing: each lock is twice as long as the one before, up to a day, so five wrong passwords after each lock ends keep Kinopeer locked for good.
