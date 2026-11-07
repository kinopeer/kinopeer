# Sourced by test-visual.sh and readme-screenshots.sh from the repository root: what they share to
# run Playwright in its Docker image, where the screenshots are rendered. In the container they run
# scripts/install-node-modules.sh first, which needs PLAYWRIGHT_IMAGE passed in.

# The image tag must match @playwright/test in package.json and the visual job in ci.yml, and its digest
# is the one that tag named when it was set (docs/TESTING.md → Screenshot tests). Dependabot
# leaves all three alone (.github/dependabot.yml): they move together, by hand.
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
export PLAYWRIGHT_IMAGE

# node_modules for the container lives in a Docker volume, since the host's may be built for another
# OS. Each checkout (every git worktree) gets a volume of its own, named after its folder and a
# checksum of its physical path (so a symlink to it doesn't make a second one), so runs in parallel
# worktrees don't reinstall it under each other.
checkout_path=$(pwd -P)
checkout_name=$(printf %s "$(basename "$checkout_path")" | tr -c 'A-Za-z0-9_.-' '-')
checkout_sum=$(printf %s "$checkout_path" | cksum | cut -d ' ' -f 1)
NODE_MODULES_VOLUME="kinopeer-visual-nm-$checkout_name-$checkout_sum"

# Labels the checkout's volume with its path, creating it if needed, and removes the volumes whose
# checkout folder is gone (a worktree deleted after its session), since each takes about 250 MB.
# Docker refuses to remove a volume a running container uses, so a run in progress keeps its own.
# Volumes without the label (made by hand or before the label existed) are left alone.
prepare_node_modules_volume() {
  label=$(docker volume inspect -f '{{index .Labels "kinopeer.checkout"}}' "$NODE_MODULES_VOLUME" 2>/dev/null) || label=
  if [ "$label" != "$checkout_path" ]; then
    # Made before the label existed: a volume can't be relabelled, so it's made again (and
    # reinstalled once). If a run in this checkout still uses it, it stays unlabelled until next time.
    docker volume rm "$NODE_MODULES_VOLUME" >/dev/null 2>&1 || true
    docker volume create --label kinopeer.checkout="$checkout_path" "$NODE_MODULES_VOLUME" >/dev/null
  fi
  docker volume ls --filter label=kinopeer.checkout --filter name=kinopeer-visual-nm- \
    --format '{{.Name}}	{{.Label "kinopeer.checkout"}}' |
    while IFS='	' read -r volume path; do
      if [ -n "$path" ] && [ ! -d "$path" ] && docker volume rm "$volume" >/dev/null 2>&1; then
        echo "Removed $volume: its checkout $path is gone" >&2
      fi
    done
}
