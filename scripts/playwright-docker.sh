# Sourced by test-visual.sh and readme-screenshots.sh from the repository root: what they share to
# run Playwright in its Docker image, where the screenshots are rendered.

# The image tag must match @playwright/test in package.json and the visual job in ci.yml.
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble

# node_modules for the container lives in a Docker volume, since the host's may be built for another
# OS. Each checkout (every git worktree) gets a volume of its own, named after its folder and a
# checksum of its path, so runs in parallel worktrees don't reinstall it under each other.
checkout_name=$(printf %s "$(basename "$PWD")" | tr -c 'A-Za-z0-9_.-' '-')
checkout_sum=$(printf %s "$PWD" | cksum | cut -d ' ' -f 1)
NODE_MODULES_VOLUME="kinoseed-visual-nm-$checkout_name-$checkout_sum"

# A shell snippet for the container: npm ci only when the volume wasn't installed from this
# package-lock.json in this image, which a stamp in node_modules records once npm ci succeeds.
# Unchanged, a run skips the install, so runs in one checkout don't reinstall under each other either.
INSTALL_NODE_MODULES='stamp="'"$PLAYWRIGHT_IMAGE"' $(sha1sum package-lock.json)"
if [ "$(cat node_modules/.kinoseed-installed 2>/dev/null)" != "$stamp" ]; then
  rm -f node_modules/.kinoseed-installed &&
    npm ci --no-audit --no-fund --loglevel=error &&
    printf "%s\n" "$stamp" > node_modules/.kinoseed-installed
fi'
