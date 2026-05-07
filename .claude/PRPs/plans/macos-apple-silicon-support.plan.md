# Plan: Full macOS Apple Silicon Support

## Summary
Ship ClaudeTerminal as a first-class macOS Apple Silicon app distributed via a Homebrew Cask hosted in this same repo (URL-form tap). No Apple notarization (no Developer ID); Gatekeeper bypass via `xattr -cr` driven by the cask's `postflight`. Most code-side surfaces are already cross-platform — this plan covers the *verification, first-release dry-run, and post-release validation* needed to actually ship.

## User Story
As a macOS Apple Silicon developer using Claude Code, I want to install ClaudeTerminal in two commands (`brew tap … && brew install --cask …`), launch it without Gatekeeper friction, and have a clear in-app choice between Homebrew-managed updates and the in-app updater.

## Problem → Solution
**Current:** Repo is positioned as Windows-only despite the build matrix and Tauri config already targeting macOS. No published macOS release exists; cask file doesn't exist; no smoke testing has happened on darwin.
**Desired:** A green CI release build produces a working `.dmg`, the `update-homebrew-cask` job auto-commits `Casks/claude-terminal.rb` to master, and Mac users can install + auto-update cleanly.

## Metadata
- **Complexity**: Medium — code already mostly in place; remaining work is verification + a first-release dry run, with one or two probable adjustments after observing real Tauri output.
- **Source PRD**: N/A (free-form planning request)
- **PRD Phase**: N/A
- **Estimated Files**: 0 net-new (all code edits in flight); CI may produce 1 new file (`Casks/claude-terminal.rb`) on first release.
- **In-flight diff** (already on disk, uncommitted): `.github/workflows/release.yml`, `CLAUDE.md`, `README.md`, `src-tauri/src/commands.rs`, `src-tauri/tauri.conf.json`, `src/components/AutoUpdater.tsx`, `src/components/SettingsModal.tsx`, `src/store/appStore.ts`.

---

## UX Design

### Before — App Updates panel (macOS, hypothetical, no platform branching)
```
┌──────────────────────────────────────────────┐
│ App Updates                                  │
│ ┌──────────────────────────────────────────┐ │
│ │ ClaudeTerminal v1.20.7                   │ │
│ │                       [Check for Updates]│ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```
A click on "Check for Updates" hits a Windows-only updater path, may succeed once, then re-trigger Gatekeeper quarantine on the new `.app`.

### After — App Updates panel on macOS with source toggle
```
┌──────────────────────────────────────────────┐
│ App Updates                                  │
│ ┌──────────────────────────────────────────┐ │
│ │ Update source                            │ │
│ │ Homebrew tap — recommended  [Homebrew|In-app]│
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │ ClaudeTerminal v1.20.7                   │ │
│ │ Run this in your terminal to update:     │ │
│ │ [ brew upgrade --cask claude-terminal ]Copy│ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```
On Windows the toggle is hidden and the panel renders the original "Check for Updates" button as before.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Settings → App Updates (macOS) | In-app updater button only | Segmented Homebrew/In-app toggle, default Homebrew | Persisted in `appStore.macUpdateSource` |
| Settings → App Updates (Windows) | In-app updater button | Unchanged | `isMac` gate hides the toggle |
| First launch from `.dmg` (manual) | macOS shows "unidentified developer" alert | Documented `xattr -cr` step in README | Required because no notarization |
| First launch from Homebrew | n/a (no cask before) | Cask `postflight` runs `xattr -cr`, app opens cleanly | Standard for unsigned tap apps |
| In-app updater on macOS, source=Homebrew | n/a | No-op (early return); banner never shows | Avoids re-quarantine churn |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `.github/workflows/release.yml` | full | Build matrix, single Apple Silicon target, cask-bump job, `[skip ci]` push-back |
| P0 | `src-tauri/tauri.conf.json` | 32-70 | Bundle targets (`dmg`, `app`), `macOSPrivateApi`, updater endpoint |
| P0 | `src-tauri/src/terminal.rs` | 110-160 | `cfg(target_os)` PTY branches, SHELL allowlist (already includes Homebrew + zsh paths) |
| P1 | `src-tauri/src/commands.rs` | 332-365, 412-445 | `shell_command()` helper + new `install_claude_code` EACCES path |
| P1 | `src/components/AutoUpdater.tsx` | full | Gating logic on `macUpdateSource === 'homebrew'` |
| P1 | `src/components/SettingsModal.tsx` | 30-50, 130-260 | Source toggle + Homebrew-managed UI panel |
| P1 | `src/store/appStore.ts` | full | `macUpdateSource` state + persist partialize |
| P2 | `src/components/TitleBar.tsx` | 159-177, 317-341 | Existing `isMac` traffic-light branch (no change needed) |
| P2 | `src-tauri/src/commands.rs` | 1497-1503, 1786-1790, 2081-2085 | Three `USERPROFILE`/`HOME` switches (already cross-platform) |
| P2 | `docs/CODEBASE_MAP.md` | full | Architecture overview from cartographer |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Tauri 2 macOS bundling | https://v2.tauri.app/distribute/dmg/ | Dmg filename: `${productName}_${version}_${arch}.dmg`. Apple Silicon arch tag: `aarch64`. |
| Tauri 2 updater artifacts | https://v2.tauri.app/plugin/updater/ | When `createUpdaterArtifacts: true`, also emits `<productName>.app.tar.gz` + `.sig` for in-app updater (used only when user opts into in-app). |
| Homebrew tap URL-form | `man brew` (`brew tap [user/repo] [URL]`) | URL-form lets a tap live in a non-`homebrew-*` repo. After tap, `brew install --cask <user>/<repo>/<cask-name>` works and `brew upgrade` tracks updates. |
| Gatekeeper quarantine bypass | Apple TN2206 + community knowledge | `xattr -cr <path>` clears the `com.apple.quarantine` extended attribute. Cask `postflight` block can run it without sudo. |

---

## Patterns to Mirror

### CROSS_PLATFORM_GUARD (Rust)
```rust
// SOURCE: src-tauri/src/commands.rs:335
fn shell_command(program: &str, args: &[&str]) -> std::process::Command {
    if cfg!(target_os = "windows") {
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/C").arg(program);
        // ...
        cmd
    } else {
        // shell with -lc + escaping
    }
}
```
**Apply when:** Adding any new shell-out from Rust. Always branch on `cfg!(target_os = "windows")` and keep a unix path that uses `$SHELL -lc`.

### CROSS_PLATFORM_GUARD (TypeScript)
```typescript
// SOURCE: src/components/TitleBar.tsx:24
const isMac = navigator.platform.toUpperCase().includes('MAC');
```
**Apply when:** UI needs platform branching. Never feature-detect via `process.platform` (not available in renderer); use `navigator.platform` upper-cased.

### ZUSTAND_PERSISTED_FLAG
```typescript
// SOURCE: src/store/appStore.ts (added)
macUpdateSource: 'homebrew' as const,
// ...
setMacUpdateSource: (source) => set({ macUpdateSource: source }),
// In partialize:
macUpdateSource: state.macUpdateSource,
```
**Apply when:** Adding any persisted user preference. Always (a) declare in the `AppState` interface, (b) provide an action, (c) include in `partialize` so it survives reload.

### CASK_POSTFLIGHT_QUARANTINE_STRIP
```ruby
# SOURCE: .github/workflows/release.yml (cask body)
postflight do
  system_command "/usr/bin/xattr",
                 args: ["-cr", "#{appdir}/ClaudeTerminal.app"],
                 sudo: false
end
```
**Apply when:** Any future unsigned-mac asset shipped via Homebrew Cask in this repo.

### CI_PUSH_BACK_WITHOUT_LOOP
```yaml
# SOURCE: .github/workflows/release.yml (update-homebrew-cask)
git commit -m "chore(cask): claude-terminal ${VERSION} [skip ci]"
git push origin master
```
**Apply when:** Any CI job that pushes back to the repo it ran in. `[skip ci]` in the message prevents the next push from re-triggering the same workflow.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| (none — all code edits already on disk) | — | The pre-pivot diff already covers Rust/TS/CI/docs. This plan is verification-and-release-focused. |
| `Casks/claude-terminal.rb` | CREATE (by CI on first release) | Auto-generated by `update-homebrew-cask` job. May need a manual seed if the first run fails (see Task 5). |
| `src-tauri/tauri.conf.json` | UPDATE *(only if Task 2 finds asset name drift)* | Bundle config alignment if Tauri produces a different `.dmg` name than the cask URL pattern assumes. |

## NOT Building

- **Apple Developer signing / notarization** — explicitly deferred (no Developer ID account). Users run `xattr` instead.
- **Intel x86_64 mac builds** — single-arch (`aarch64-apple-darwin`) only.
- **Universal binaries** — same reason as above.
- **macOS-native traffic-light controls via `titleBarStyle: "Overlay"`** — current fake traffic lights in `TitleBar.tsx` already work. Polish is a follow-up, not a blocker.
- **Sparkle / alternative updater frameworks** — Tauri's built-in updater stays for Windows; macOS uses Homebrew.
- **App Store distribution** — would require notarization + sandbox entitlements review.
- **Custom URL handlers, deep-linking, or Spotlight Suggestions integration** — out of scope.

---

## Step-by-Step Tasks

### Task 1 — Local smoke test on M-series Mac
- **ACTION**: Run `npm run tauri dev` from a fresh checkout of master with the in-flight changes applied.
- **IMPLEMENT**: Verify in dev:
  1. App window opens, fake mac traffic lights render in `TitleBar.tsx` left cluster.
  2. New Terminal → spawn `claude` shell terminal → keystrokes echo, output streams.
  3. `npm run` script terminal works (uses `create_script_terminal` cfg branch).
  4. Plain shell terminal works (uses `create_shell_terminal` cfg branch).
  5. Open Settings → App Updates → toggle visible → flip Homebrew↔In-app → close+reopen Settings → toggle persists.
  6. With toggle = Homebrew: panel shows the `brew upgrade --cask claude-terminal` button → click copies to clipboard.
  7. With toggle = In-app: panel renders existing "Check for Updates" UI.
- **MIRROR**: CROSS_PLATFORM_GUARD (TS) — confirm `isMac` derives correctly.
- **IMPORTS**: N/A
- **GOTCHA**: If `claude` is not on `$PATH` in a login shell, the SHELL allowlist may resolve to `/bin/bash` and miss user-installed paths. Verify in `terminal.rs:131`.
- **VALIDATE**: All 7 sub-checks pass; no console errors in DevTools.

### Task 2 — Verify Tauri output asset names with a local production build
- **ACTION**: Run `npm run tauri build -- --target aarch64-apple-darwin` on the M-series Mac.
- **IMPLEMENT**: After build, list contents of `src-tauri/target/aarch64-apple-darwin/release/bundle/`. Capture exact filenames of:
  - `dmg/ClaudeTerminal_<version>_<arch>.dmg` ← compare to workflow's `URL` template
  - `macos/ClaudeTerminal.app/` (the bundle)
  - `macos/ClaudeTerminal.app.tar.gz` (updater artifact, if `createUpdaterArtifacts: true` is honored locally)
- **MIRROR**: N/A
- **IMPORTS**: N/A
- **GOTCHA**: Tauri 2.x has had asset-naming changes between minor versions. The cask job assumes `ClaudeTerminal_${VERSION}_aarch64.dmg`. If the actual output uses a different separator, casing, or arch tag (`arm64` vs `aarch64`), the workflow's `curl` will 404.
- **VALIDATE**: Filename matches the pattern in `release.yml:158` (`ClaudeTerminal_${VERSION}_aarch64.dmg`). If not, update both `release.yml` and the cask `url` template.

### Task 3 — Manual install path validation (without Homebrew)
- **ACTION**: Open the locally-built `.dmg`, drag `ClaudeTerminal.app` to `/Applications`, double-click.
- **IMPLEMENT**: Confirm Gatekeeper alert appears. Run `xattr -cr /Applications/ClaudeTerminal.app`. Re-launch. Confirm app opens.
- **MIRROR**: README docs already document this; verify the docs match observed reality.
- **GOTCHA**: A locally-built debug-mode bundle doesn't get the quarantine attribute (it wasn't downloaded). To realistically test, transfer the `.dmg` via the browser or `curl` from a different machine/iCloud — that's what attaches `com.apple.quarantine`.
- **VALIDATE**: README's "Or, manually:" section steps reproduce exactly.

### Task 4 — EACCES install error messaging validation
- **ACTION**: With nodejs.org-installed Node (root-owned global prefix), launch SetupWizard fresh by removing the persisted setup-complete marker — or trigger from Settings.
- **IMPLEMENT**: Click "Install" for Claude Code without running with sudo. Should see the new actionable error from `commands.rs:install_claude_code`.
- **MIRROR**: Error message format from `install_claude_code` in `commands.rs`.
- **GOTCHA**: If user has nvm or Homebrew Node, EACCES doesn't fire — install succeeds and you can't validate the error path. Force the case by running `npm config set prefix /usr/local` temporarily, or test on a machine with system Node.
- **VALIDATE**: Error text matches the multi-line guidance string ("Recommended fixes (pick one): …").

### Task 5 — End-to-end first release dry run
- **ACTION**: Tag a test release `v1.20.8-mac-test1` (or use `workflow_dispatch` with a non-prod version) and watch CI.
- **IMPLEMENT**: Steps:
  1. `git commit -m "Release v1.20.8: macOS support"` (after committing the in-flight diff).
  2. Bump version in 4 files per `.claude/commands/publish.md`.
  3. `cargo check` to refresh `Cargo.lock`.
  4. `git tag v1.20.8 && git push origin master --tags`.
  5. Watch GitHub Actions:
     - `create-release` job creates a draft.
     - `build-tauri` matrix builds Windows + macos-latest aarch64 (only).
     - `publish-release` undrafts.
     - `update-homebrew-cask` downloads the .dmg, computes sha, writes `Casks/claude-terminal.rb`, pushes a `[skip ci]` commit to master.
  6. Confirm `Casks/claude-terminal.rb` exists on master with valid sha256.
- **MIRROR**: CI_PUSH_BACK_WITHOUT_LOOP pattern.
- **GOTCHA**:
  - The first cask file is created **after** publish-release finishes — there's a window where the release exists but no cask. Users who install in that window get an error. Mitigation: between commit and CI completion, manually pre-seed `Casks/claude-terminal.rb` with placeholders, OR communicate the install path only after CI finishes.
  - If `update-homebrew-cask` fails to download the .dmg (Task 2 asset-name mismatch), the cask file is never created. Workflow logs a clear `::error::` line.
  - If `GITHUB_TOKEN` permissions are restrictive (org policy), `git push origin master` will fail. The job has `permissions: contents: write` declared but org-level overrides take precedence.
- **VALIDATE**:
  1. GitHub Releases page shows `v1.20.8` with both Windows and Mac assets.
  2. `master` has a new commit titled `chore(cask): claude-terminal 1.20.8 [skip ci]`.
  3. `Casks/claude-terminal.rb` parses as valid Ruby (run `brew style Casks/claude-terminal.rb` locally if available).

### Task 6 — Validate Homebrew install end-to-end on a clean Mac account
- **ACTION**: Either create a new macOS user, or run on a different Mac, with Homebrew installed but no prior ClaudeTerminal data.
- **IMPLEMENT**:
  ```bash
  brew tap hemzaz/claude-terminal https://github.com/hemzaz/claude-terminal
  brew install --cask hemzaz/claude-terminal/claude-terminal
  open /Applications/ClaudeTerminal.app
  ```
- **MIRROR**: README install section verbatim.
- **GOTCHA**:
  - First-time `brew tap` clones the *whole* `claude-terminal` repo — not just the `Casks/` dir — so `brew tap` will be slower than a typical `homebrew-foo` tap. Acceptable.
  - `brew install --cask` requires the cask name as `<user>/<tap>/<cask>` since the tap isn't named `homebrew-*`. Confirm the `--cask` flag IS required in the URL-form tap, not optional.
  - The cask `postflight` runs `xattr` synchronously; on Apple Silicon with SIP, this succeeds without sudo.
- **VALIDATE**:
  1. App launches without Gatekeeper alert.
  2. SetupWizard appears or is skipped if Claude Code already installed.
  3. Spawn a terminal, confirm output streams.

### Task 7 — Update channel switch UX validation
- **ACTION**: After Task 6, open Settings → App Updates → toggle to "In-app".
- **IMPLEMENT**: Confirm panel switches from the brew-command UI to the in-app updater UI. Click "Check for Updates" — backend hits the GitHub Releases `latest.json` endpoint. Should report "Up to date" since user is on the latest tag.
- **MIRROR**: Effect deps in `AutoUpdater.tsx` and `SettingsModal.tsx` already key on `inAppDisabled` / `homebrewManaged`.
- **GOTCHA**: On the very first toggle to In-app, the `useEffect([inAppDisabled])` re-runs and triggers a fresh check. Brief network round-trip is expected.
- **VALIDATE**: Toggle persists across restarts; both panels render the right UI; no console errors.

### Task 8 — Post-release docs sync
- **ACTION**: After Task 5 succeeds, verify external-facing docs match reality.
- **IMPLEMENT**:
  1. README badges and download URLs are correct (`hemzaz/claude-terminal/...`) — already updated in this session, just spot-check after the release.
  2. `docs/CODEBASE_MAP.md` (uncommitted from prior cartographer run) — decide whether to commit alongside this work or separately. Unrelated to macOS work; recommend separate commit.
- **MIRROR**: N/A
- **GOTCHA**: None.
- **VALIDATE**: Final master CI run is fully green.

### Task 9 — Commit & push (logical groups)
- **ACTION**: Stage and commit the in-flight diff in logical chunks.
- **IMPLEMENT**: Suggested commit grouping:
  1. `feat(macos): cross-platform install_claude_code error path` (just `commands.rs`).
  2. `feat(updater): user-selectable update source on macOS (Homebrew default)` (TS files: `appStore.ts`, `AutoUpdater.tsx`, `SettingsModal.tsx`).
  3. `chore(ci): drop x86_64 macos target, switch to hemzaz repo URLs, add cask-bump job` (`release.yml`, `tauri.conf.json`).
  4. `docs(macos): add macOS install + Homebrew tap instructions` (`README.md`, `CLAUDE.md`).
- **MIRROR**: Commit message style — see `git log --oneline` recent commits, follow conventional-commits-ish format already in use.
- **GOTCHA**: Do NOT include the prior session's untracked `docs/CODEBASE_MAP.md` or `.omc/` in these macOS commits — separate concern, separate commit.
- **VALIDATE**: `git status` clean except for cartographer leftovers.

---

## Testing Strategy

### Manual / E2E (no automated tests added)

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Smoke test (Task 1) | M-series Mac, dev mode | All UI panels render, all 3 terminal types spawn | No |
| Update-source persist | Toggle, restart | Same toggle state | Restart edge |
| Manual `xattr` (Task 3) | Quarantined .dmg | App opens after `xattr -cr` | First-launch edge |
| EACCES message (Task 4) | System Node, npm i -g | Multi-line guidance, not raw stderr | Permission edge |
| Cask install (Task 6) | Clean Mac account | App opens without Gatekeeper alert | Fresh install |
| Cask upgrade | Old version cached | `brew upgrade` replaces the .app | Update edge |

### Edge Cases Checklist
- [ ] Empty `claude_args` (already handled by `terminal.rs` validation)
- [ ] Non-default `$SHELL` value not in allowlist (resolves to `/bin/bash` per `terminal.rs:131`)
- [ ] Homebrew Node + nvm Node both installed (`npm install -g` should succeed without EACCES)
- [ ] User toggles update source while updater is mid-download (in-app path) — banner state should clear cleanly
- [ ] First-time Homebrew install on a Mac that's never had ClaudeTerminal data dir
- [ ] Tauri version drift between releases — asset name pattern remains stable

---

## Validation Commands

### Static Analysis (frontend)
```bash
cd /Users/elad/PROJ/claude-terminal && npx tsc --noEmit
```
EXPECT: "TypeScript compilation completed", zero errors. (Already passing.)

### Static Analysis (backend)
```bash
cd /Users/elad/PROJ/claude-terminal/src-tauri && cargo check --target aarch64-apple-darwin
```
EXPECT: `Finished` line, no errors. (Already passing on host arch.)

### Production Build (smoke)
```bash
cd /Users/elad/PROJ/claude-terminal && npm run tauri build -- --target aarch64-apple-darwin
```
EXPECT: A `.dmg` and `.app` appear under `src-tauri/target/aarch64-apple-darwin/release/bundle/`.

### Cask File Lint (after Task 5)
```bash
brew style Casks/claude-terminal.rb
```
EXPECT: No errors. Warnings about non-notarized apps are expected and acceptable.

### Manual Validation
- [ ] All 9 tasks above completed end-to-end
- [ ] First Mac user can `brew tap … && brew install --cask …` and launch
- [ ] In-app updater toggle works both directions and persists
- [ ] No regressions on Windows (run a Windows VM build or rely on CI)

---

## Acceptance Criteria
- [ ] Tasks 1-9 completed
- [ ] CI release run produces both Windows and macOS artifacts and a master commit with the auto-generated cask
- [ ] A clean Mac can `brew install` and launch ClaudeTerminal in under 60 seconds
- [ ] No type errors, no Rust compile errors, no clippy warnings new to this branch
- [ ] Docs (README + CLAUDE.md) match observed reality

## Completion Checklist
- [ ] In-flight diff committed in logical groups (Task 9)
- [ ] First mac release tagged and published
- [ ] Cask file landed on master
- [ ] Smoke-tested on a real M-series Mac (Task 1)
- [ ] Smoke-tested on a clean Mac account via Homebrew (Task 6)
- [ ] Update channel toggle validated both directions (Task 7)
- [ ] No untracked side effects (only cartographer leftovers from prior session)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tauri `.dmg` name pattern doesn't match workflow URL template | Medium | High (cask never created) | Task 2 verifies before tagging; adjust `release.yml` if needed |
| GitHub Actions `GITHUB_TOKEN` lacks `contents: write` due to org policy | Low | High (cask push fails) | `permissions: contents: write` declared at job level; if blocked, swap to a PAT |
| `xattr -cr` requires sudo on some macOS releases | Low | Medium (cask postflight fails) | Cask uses `sudo: false` — runs at user level; documented manual `xattr` path remains |
| `transparent: true` + `decorations: false` causes visual glitches on macOS | Medium | Low | Acceptable for v1; titleBarStyle Overlay is a follow-up |
| User runs into EACCES with system Node and the new error message isn't clear enough | Low | Low | Task 4 validates messaging |
| Asset URLs in updater (`tauri.conf.json:78`) target hemzaz repo correctly | Low | High | Already updated in this session; verified in pre-commit Phase 2 |

## Notes
- The plan deliberately produces no new code beyond what's already on disk. Most "tasks" are *verification gates*. This reflects that the architecture was already cross-platform-aware; what was missing was distribution + signal that the macOS path actually works.
- The `[skip ci]` push-back commit pattern in `update-homebrew-cask` is borrowed from the standard Homebrew tap workflow. If the org enforces signed commits, `git config commit.gpgSign true` will need to be set in CI alongside a key.
- Prior session's `docs/CODEBASE_MAP.md` and `.omc/` are unrelated to macOS support and should be committed separately.
- If at any point the user *does* obtain an Apple Developer ID, Phase 4 of the original plan (signing + notarization) becomes unblocked and replaces the `xattr` workflow. The cask postflight `xattr` block can stay (no-op on signed apps).

---

> Next step: Run `/prp-implement .claude/PRPs/plans/macos-apple-silicon-support.plan.md` to execute this plan, or work through the tasks manually starting with Task 1.
