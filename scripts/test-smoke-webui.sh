#!/bin/sh
# The WebUI's smoke journeys (docs/TESTING.md → The WebUI's smoke journeys): a real qBittorrent in
# Docker serving the WebUI build as its Alternative WebUI, and Playwright's image beside it on a
# network of their own, where it builds the WebUI and runs playwright.webui.config.ts. The same
# script runs locally and in CI's webui-smoke job. Arguments go to `playwright test`.
set -eu
cd "$(dirname "$0")/.."
. scripts/playwright-docker.sh

# qBittorrent 5.2.0, the oldest the WebUI build supports (MIN_WEBUI_QBITTORRENT_VERSION), pinned by
# the digest its tag named when it was set. Dependabot can't see it here: it moves by hand.
QBITTORRENT_IMAGE=qbittorrentofficial/qbittorrent-nox:5.2.0-1@sha256:84818ffc8006e9d67486e84042a422f7751c44d79a3e2c2df74a296789c2c2b6

# Names of this run's own, so runs in parallel worktrees don't meet.
run="kinopeer-webui-smoke-$$"
cleanup() {
  docker rm -f "$run-qbittorrent" >/dev/null 2>&1 || true
  docker network rm "$run" >/dev/null 2>&1 || true
  docker volume rm "$run-config" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

prepare_node_modules_volume
docker network create "$run" >/dev/null
# qBittorrent's profile in a volume, so it writes there as its own user; qBittorrent.conf turns the
# Alternative WebUI on at /webui and sets the login, which only a profile written beforehand can.
docker volume create "$run-config" >/dev/null
docker run --rm --entrypoint sh -v "$run-config":/config -v "$PWD/e2e/webui":/seed:ro "$QBITTORRENT_IMAGE" \
  -c 'mkdir -p /config/qBittorrent/config && cp /seed/qBittorrent.conf /config/qBittorrent/config/'
# The folder qBittorrent serves, there before the build fills its public/, which qBittorrent reads on
# each request; nothing asks for a page before the journeys do.
mkdir -p dist-webui
docker run -d --name "$run-qbittorrent" --network "$run" --network-alias qbittorrent \
  -e QBT_LEGAL_NOTICE=confirm -v "$run-config":/config -v "$PWD/dist-webui":/webui:ro "$QBITTORRENT_IMAGE" >/dev/null

# No TMDB proxy in this build (TMDB_PROXY_URL=), so the journeys never reach the real one.
status=0
docker run --rm --init --ipc=host --network "$run" \
  -v "$PWD":/work -v "$NODE_MODULES_VOLUME":/work/node_modules -w /work \
  -e CI="${CI:-}" -e PLAYWRIGHT_IMAGE \
  "$PLAYWRIGHT_IMAGE" sh -c 'scripts/install-node-modules.sh && TMDB_PROXY_URL= npm run build:webui && npx playwright test --config playwright.webui.config.ts "$@"' playwright "$@" ||
  status=$?
if [ "$status" -ne 0 ]; then docker logs "$run-qbittorrent" 2>&1 | tail -n 40 >&2; fi
exit "$status"
