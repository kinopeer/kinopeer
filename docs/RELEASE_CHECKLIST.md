# Before the public release

Things to settle before Kinoseed (the repo, the Docker image or both) goes public. Add an item whenever something comes up that can wait until then; tick it off in the PR that settles it.

- [ ] **TMDB key.** Decide whether users bring their own key (onboarding asks for it) or Kinoseed ships a default one. A key in the code, the image or the git history is public: anyone can pull it out, misuse is tied to the owner's TMDB account, and a revoked key breaks every install at once. If there is a default, register a separate key for Kinoseed (not a personal one) and keep `TMDB_API_KEY` and the Settings sheet as overrides.
- [ ] **TMDB attribution.** TMDB's API terms ask apps to show the TMDB logo and the notice "This product uses the TMDB API but is not endorsed or certified by TMDB." The app doesn't show it yet (a Settings or About section would fit).
- [ ] **License.** The repo has no `LICENSE` file yet.
- [ ] **Secrets in history.** Before the repo goes public, scan the full git history for keys, passwords and local addresses (for example with `gitleaks detect`).
