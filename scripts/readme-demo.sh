#!/bin/sh
# Records the README's demo in the Playwright Docker image, as the README screenshots are taken
# (scripts/readme-screenshots.sh): e2e/readme.demo.ts leaves test-results/demo/demo.webm and where its
# first frame worth showing is. Then, in the same image, ffmpeg (installed from Ubuntu's archive for
# the run, since the image's own build only writes WebM) cuts the start and writes docs/demo.gif for
# the README, test-results/demo/demo.mp4 for posts, which isn't committed, and a sheet of its frames
# to look the recording over (test-results/demo/sheet.png).
set -eu
cd "$(dirname "$0")/.."
. scripts/playwright-docker.sh
prepare_node_modules_volume
docker run --rm --init --ipc=host \
  -v "$PWD":/work -v "$NODE_MODULES_VOLUME":/work/node_modules -w /work \
  -e TMDB_API_KEY -e PLAYWRIGHT_IMAGE \
  "$PLAYWRIGHT_IMAGE" sh -c 'scripts/install-node-modules.sh && npx playwright test -c playwright.demo.config.ts "$@"' playwright "$@"
exec docker run --rm -v "$PWD":/work -w /work -e OWNER="$(id -u):$(id -g)" "$PLAYWRIGHT_IMAGE" sh -c '
  set -eu
  apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg >/dev/null
  start=$(node -p "require(\"./test-results/demo/start.json\").seconds")
  ffmpeg -loglevel error -y -ss "$start" -i test-results/demo/demo.webm \
    -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart test-results/demo/demo.mp4
  ffmpeg -loglevel error -y -i test-results/demo/demo.mp4 \
    -vf "fps=15,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
    docs/demo.gif
  ffmpeg -loglevel error -y -i test-results/demo/demo.mp4 -vf "fps=0.5,scale=260:-1,tile=5x2" -frames:v 1 test-results/demo/sheet.png
  chown "$OWNER" docs/demo.gif test-results/demo/*
  ls -l docs/demo.gif test-results/demo/demo.mp4'
