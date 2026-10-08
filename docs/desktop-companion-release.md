# Windows companion release and recovery

Implementation: #780, desktop 0.2.0. Scope: [confirmed design](desktop-companion-design.md).
This is a release candidate. Local verification does not establish production adoption, signed distribution, or customer pilot acceptance.

## Local verification

From the repository root, use pnpm:

~~~powershell
pnpm --filter desktop test
pnpm --filter desktop build
pnpm --filter desktop tauri build --bundles nsis,msi
pnpm --filter webapp typecheck
pnpm --filter webapp test:integration src/app/api/desktop/open/route.integration.test.ts src/app/api/time-entries/commands/route.integration.test.ts
~~~

The integration runner creates its own disposable PostgreSQL database and migration fixtures. On Windows, use the installed Git Bash in PATH; the WSL bash shim is not a substitute.

Current evidence includes native SQLite/HTTP contract tests, Windows Credential Manager persistence and isolation, employee-zone totals across DST and midnight, German controls, update gesture/error handling, and real PostgreSQL authorization and browser handoff tests.

The isolated Windows WebView exercise verifies online clock-in, offline Start Break, disconnected process restart, restored organization and break context, End Day without another command, offline clock-in, ordered reconnect, committed close with a lost response, and Settings Escape/focus restoration. Screenshots are local QA artifacts, not production employee records.

## Repeat the isolated native exercise

Never point this fixture at an employee server or the normal application data directory. The fixture uses a fake credential, loopback port 9231, identifier `com.z8.timer.native-qa`, protocol `z8-native-qa`, a separate startup registry value, and the ignored `apps/desktop/.native-qa` directory.

1. Create `.native-qa` inside `apps/desktop` and a Tauri config `.native-qa/tauri.qa.json` overriding `identifier` and `app.appDirectoriesOverride` to that exact absolute directory. Give the main window `additionalBrowserArgs: "--remote-debugging-port=9227"`, width 400, height 540, and `visible: false`. Override `plugins.deep-link.desktop.schemes` to `["z8-native-qa"]`.
2. Set `Z8_NATIVE_QA_DIRECTORY` to that exact absolute directory. Seed only this isolated vault entry:
   `pnpm --filter desktop exec -- cargo test --manifest-path src-tauri/tests/clock-core/Cargo.toml prepare_native_qa_session -- --ignored`.
3. Run `pnpm --filter desktop exec node scripts/native-qa-server.mjs`. The fixture persists its receipts and work in `.native-qa/server-state.json`.
4. Build `pnpm --filter desktop tauri build --debug --no-bundle --config .native-qa/tauri.qa.json`, launch that debug executable, then run `pnpm --filter desktop exec node scripts/native-qa-driver.mjs`.
5. Stop that explicitly owned QA process, wait for exit, and relaunch it while the fixture is disconnected. Run the driver with `restart`, then `lost-reply`.
6. Stop the owned QA process and server. Remove the fake vault entry with the same command as step 2, substituting `remove_native_qa_session`.

This is native IPC and real WebView coverage against a protocol fixture. It does not replace installed-client OAuth, tray interaction, screen-reader, sleep/hibernate, or signed-updater acceptance. Remote debugging belongs only to the isolated QA config, never the distributed build.

## Signed candidate pipeline

`desktop-windows.yml` builds an **unsigned review artifact** on a hosted Windows runner.
`desktop-release.yml` builds signed candidates from an explicit `desktop-vVERSION` tag. It uploads candidates; it does not publish a release or change a production server.

The release owner must provision:

- Protected GitHub environment `desktop-release`, with approved maintainers.
- Isolated self-hosted Windows x64 runner labelled `z8-desktop-signing`, containing Rust stable, Visual Studio C++ tools, and the organization's hardware or managed Windows signing provider. Never run untrusted pull-request code on this signing runner.
- Environment variables `Z8_DESKTOP_UPDATE_ENDPOINT` (trusted HTTPS), `Z8_DESKTOP_UPDATE_PUBLIC_KEY`, `Z8_DESKTOP_DOWNLOAD_BASE_URL` (trusted HTTPS), `Z8_WINDOWS_SIGN_COMMAND` (provider command containing the installer `%1` placeholder), and `Z8_WINDOWS_SIGNER_THUMBPRINT`.
- Secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. These are the Tauri updater signature, separate from Windows publisher signing. Never place them in source, artifacts, tenant settings, or logs.

Package, Cargo and Tauri versions must match the tag input. Preparation fails if required release configuration is absent. Windows publisher signatures must be valid and match the configured signer. The manifest includes the updater signature and the immutable installer URL. The application checks the configured HTTPS feed, then requires the employee to explicitly install and restart. It takes a complete SQLite backup before installation; a failed backup pauses the update.

After installed acceptance, the release owner uploads the exact verified installer and signatures to immutable versioned HTTPS URLs, then publishes the matching `latest.json` to the configured feed. Keep the previous compatible candidate available. Publication and production activation are separate owner actions.

See [Tauri updater requirements](https://v2.tauri.app/plugin/updater/) and [Windows signing](https://v2.tauri.app/distribute/sign/windows/).

## Installed pilot gate

Use approved disposable records in both an eligible hosted organization and a representative customer-hosted deployment. Record build version, signer, server version, organization eligibility, date, tester, and screenshots/results for each scenario in the [design acceptance matrix](desktop-companion-design.md#release-evidence-to-obtain).

Before enrollment, the server must negotiate version 2 clock-in/out plus atomic break support with submission and lookup enabled, and the organization must pass the existing timekeeping adoption process. Identity-less legacy records block clocking until authorized evidence-based recovery. Neither the new app nor the release workflow activates adoption.

Remaining release-owner acceptance includes signed install/uninstall, browser callback from a real login, session expiry with pending work, other-device work changes, context switches, Windows tray close/reopen/Quit, launch at sign-in, topmost restoration, screen reader and both themes, real sleep/hibernate, signed update and compatible rollback with pending work. Library coverage alone does not close these gates.

## Preserve evidence and roll back safely

The application retains unresolved commands, original wire bytes, receipts and legacy records across logout, switching and updates. Manual break state is scoped to its original server/account/organization/employee. End Day only clears that local break mode.

Before an updater install, `before-update-<timestamp>.db` is created in the app data directory after SQLite integrity validation. Backups contain personal timekeeping data; treat them as employee evidence. Do not attach them to public issues.

The NSIS uninstall hook retains app data even when the installer exposes a delete-data checkbox, warns in German and English, and removes the application startup entry for a real uninstall. Update mode retains startup. MSI is expected to retain app data and must be checked in installed acceptance.

Rollback only to a verified release that understands this version-1 frozen-command store and preserves its additional break/snapshot tables. Do not roll back to an identity-less replay prototype. A newer SQLite store version is refused, not silently downgraded. Do not delete, overwrite, replay under another login, or manually transplant a queue to make clocking work. Restore or correct records only through the existing authorized recovery process with the application stopped and evidence preserved.