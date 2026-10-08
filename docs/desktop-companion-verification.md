# Desktop companion verification

Candidate: desktop 0.2.0, issue [#780](https://github.com/Umami-Creative-GmbH/z8/issues/780), branch `ai/780-windows-clock-companion`. Verified on Windows x64 on 2026-10-08 against the [confirmed design](desktop-companion-design.md).

This record covers implementation and local release-candidate evidence. Signed distribution, production adoption and installed customer acceptance remain open under the [release runbook](desktop-companion-release.md).

## Execution evidence

| Check | Result |
| --- | --- |
| Native Rust, SQLite, HTTP and Windows credential suites | 81 passed. Four ignored cases are subprocess helpers or explicit isolated QA setup/cleanup. |
| React behavior tests | 12 passed. |
| Accessibility script | 1 passed. |
| Desktop TypeScript and Vite production build | Passed. |
| Native Windows debug build | Passed; exercised through real Windows WebView and native IPC. |
| Windows release packaging | NSIS and MSI passed. Both local installers are unsigned review artifacts. |
| Webapp TypeScript contracts | All three projects passed. |
| Disposable PostgreSQL integration tests | 25 command tests and 6 desktop context/browser handoff tests passed. Migration recovery, retry and fresh-chain checks also passed. |
| Organization SSO unit test | Passed. |
| Changed-source formatting and whitespace | Biome checks and `git diff --check` passed. |
| React Doctor | 91/100. One remaining maintainability warning concerns the complexity of the main Companion component. |
| Independent Standards and Spec reviews | All reported findings resolved; reports below. |

The release build produced `src-tauri/target/release/bundle/nsis/z8 Timer_0.2.0_x64-setup.exe` (3,133,502 bytes) and `src-tauri/target/release/bundle/msi/z8 Timer_0.2.0_x64_en-US.msi` (4,190,208 bytes), relative to `apps/desktop`. These are local build outputs, not published releases.

## Native Windows exercise

The isolated fixture used identifier `com.z8.timer.native-qa`, a fake credential in a separate Windows vault namespace, a loopback server and a separate app-data directory. It did not access production employee records.

The real debug application passed these flows:

- Fresh online startup and clock-in after capability negotiation.
- Disconnected Start Break, durable close persistence and an actual disconnected process restart.
- Restored organization and break mode; End Day cleared break mode without adding a clock command.
- Disconnected clock-in followed by ordered reconciliation after reconnect.
- Server-committed clock-out with a lost response: receipt lookup confirmed one work write.
- Settings Escape and focus restoration, German controls, explicit dark theme and automatic system dark theme.

Screenshots remain in the ignored local `apps/desktop/.native-qa` directory. The tracked fixture scripts and the release runbook describe how to repeat this exercise.

This fixture does not establish installed-client OAuth, screen-reader behavior, tray/startup interaction, real Windows sleep/hibernate, signed installation, signed updates or compatible rollback.

## Standards

The review compared the candidate against baseline `830f70e50bbf607470960e873c84947030abb0f4` and the repository standards.

Three original findings were resolved:

- Idle monitoring now resets its baseline when work identity changes, clears stale pending evidence and has a transition regression.
- Clock-in, clock-out and Start Break check the native device timezone and offer continue once, cancel, or a verified browser handoff to saved preferences.
- Duplicate context invalidation was removed. Extracted header, attribution and feedback components preserve behavior.

The follow-up review found no new hard standards or correctness problems. It was read-only and did not independently rerun tests.

Standards: 3 original findings, worst priority P2; all resolved, 0 outstanding.

## Spec

The review used issue #780 and the confirmed desktop companion design.

Three original findings were resolved:

- Idle evidence starts from the current work period rather than earlier clocked-out activity.
- Another device's confirmed work period wins over a pending manual close without retargeting or altering its original command.
- The same reconciliation rule covers an unresolved atomic idle break. The regression verifies that the confirmed period's actual start time wins while preserving original bytes when lookup is unavailable.

The follow-up review reported no remaining spec findings. Signing, production adoption and installed pilot acceptance remain explicit release gates.

Spec: 3 original findings, worst priority P2; all resolved, 0 outstanding.

## Remaining owner gates

Issue #780 stays open until the release owner records signed Windows install/update/rollback evidence and installed acceptance in both an eligible hosted organization and a representative customer-hosted deployment.

Production Next.js build, deployment and live pilot checks requiring Phase-managed system configuration were skipped: those environment variables are unavailable to agents. No production organization was activated and no release was published.