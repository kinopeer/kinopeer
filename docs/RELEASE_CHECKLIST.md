# Before the public release

Things to settle before Kinoseed (the repo, the Docker image or both) goes public. Add an item whenever something comes up that can wait until then; tick it off in the PR that settles it.

- [ ] **TMDB key.** Decide whether users bring their own key (onboarding asks for it) or Kinoseed ships a default one. A key in the code, the image or the git history is public: anyone can pull it out, misuse is tied to the owner's TMDB account, and a revoked key breaks every install at once. If there is a default, register a separate key for Kinoseed (not a personal one) and keep `TMDB_API_KEY` and the Settings sheet as overrides.
- [ ] **TMDB attribution.** TMDB's API terms ask apps to show the TMDB logo and the notice "This product uses the TMDB API but is not endorsed or certified by TMDB." The app doesn't show it yet (a Settings or About section would fit).
- [ ] **License.** The repo has no `LICENSE` file yet.
- [ ] **Secrets in history.** Before the repo goes public, scan the full git history for keys, passwords and local addresses (for example with `gitleaks detect`).
- [ ] **Default qBittorrent login.** The Umbrel package tries qBittorrent's default `admin`/`adminadmin` before asking. Decide whether a public package should keep that or always ask.
- [ ] **Official Umbrel App Store.** The image (`ghcr.io/mrshakhov/kinoseed`) and the [Homelab Community App Store](https://github.com/MrShakhov/umbrel-homelab-store) are already public. Submit to getumbrel/umbrel-apps: manifest, icon, gallery screenshots, release notes, multi-arch image pinned by digest.
- [ ] **Links in the Umbrel manifest.** `website`, `repo` and `support` in the store's `homelab-kinoseed/umbrel-app.yml` point at this repository, which is private, so they 404 for anyone else.
- [ ] **HTTPS.** Service workers and installing the app need HTTPS on phones over the LAN (deferred from step 8).
- [ ] **Plain Docker setup.** Onboarding works on a clean install outside Umbrel, with qBittorrent and Prowlarr set only through the environment.
- [ ] **Deferred features.** Push notifications, the desktop layout with a details drawer, sorting, grid view and bulk actions in the downloads list, Jackett (only Prowlarr is implemented; drop it from the docs or add it).
- [ ] **Prowlarr key from another app's data.** The Umbrel package mounts Prowlarr's config folder read-only to read its API key (the folder, not the file: a file bind mount would keep pointing at the old file after Prowlarr rewrites it). Umbrel's own Prowlarr package links apps the same way (its media-app-configurator mounts other apps' data), but the official App Store review may still question it; the fallback is a Prowlarr key field in Settings, kept on the server like the TMDB key.
