# Sourced by test-visual.sh and readme-screenshots.sh from the repository root: what they share to
# run Playwright in its Docker image, where the screenshots are rendered. In the container they run
# scripts/install-node-modules.sh first, which needs PLAYWRIGHT_IMAGE passed in.

# The image tag must match @playwright/test in package.json and the visual job in ci.yml.
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble
export PLAYWRIGHT_IMAGE

# node_modules for the container lives in a Docker volume, since the host's may be built for another
# OS. Each checkout (every git worktree) gets a volume of its own, named after its folder and a
# checksum of its physical path (so a symlink to it doesn't make a second one), so runs in parallel
# worktrees don't reinstall it under each other.
checkout_path=$(pwd -P)
checkout_name=$(printf %s "$(basename "$checkout_path")" | tr -c 'A-Za-z0-9_.-' '-')
checkout_sum=$(printf %s "$checkout_path" | cksum | cut -d ' ' -f 1)
NODE_MODULES_VOLUME="kinoseed-visual-nm-$checkout_name-$checkout_sum"
