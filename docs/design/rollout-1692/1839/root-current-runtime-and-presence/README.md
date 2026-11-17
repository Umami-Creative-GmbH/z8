# Bounded sign-in and presence runtime evidence

This archive publishes a limited runtime capture at HEAD `bc4010825c1fd94d634b7f4774b6f895bfac26f4`, app tree `138aab92cde099756c13347827a90112763def68`. It is historical runtime evidence carried by 56 unchanged, explicitly declared source pins. Publication boundary `d6a8863ddf6c9450848a85f88411825101ae13d6` has app tree `f3666bb7c8ff4b752eb316a78d02cfaeb895e51f`; its two developer-access UI changes are outside those pins. Runtime was not rerun on that boundary, and the whole current app is not accepted here. Both `verifiedCommit` and `readiness` remain null.

- **R155: 20/20 listed actual assertions.** Normal development email sign-in returned 200, reached the intended presence callback, and same-browser canonical session/user/organization booleans matched. Unfilled desktop 1600, phone 390 and keyboard focus checks passed. Automatic approval review rejected the wrong-password operation before execution because of possible lockout/rate-limit state. Refusal, nonsecret draft retention, widget reset and credential retry remain unpassed; no equivalent operation or retry ran.
- **R1744: 32/32 listed actual assertions.** One public-UI-created disposable location, own assignment and new own clocking period produced one canonical matching row, employee link, state and Since text. Actual departure/return retirement, local Retry with a new authorized read, unavailable-location recovery, dark/reduced-motion/sidebar preferences and employee-link navigation passed. Live authority races and injected read-error/loading matrices remain unpassed. The streamed unavailable-location document returned 200; no HTTP 404 acceptance is claimed.
- The new own period was later closed through the public UI. Its two canonical UTC events retain Europe/Berlin browser captures at +60 minutes. All 261 historical own work periods remained unchanged under canonical readback. Assignment is not device-position evidence.
- Fresh unit and PostgreSQL suite additions are **0/0**. R155's 310 occurrences/31 files and R1744's 135 cases/14 files are inherited and overlap earlier results. Prior 43/15 PostgreSQL cases are unadded. Fixture setup is not a new suite or route case.
- Final connected Next diagnostics reported compilation/configuration/session error counts of 0, page errors 0 and one browser session. The Retry PNG visibly has a Next **1 Issue** badge; its panel was uninspected and remains unclassified. No zero request-insight/development-issue claim follows. Ancillary storage 404 and equipment-access refusal observations remain qualified.
- One diagnostic accidentally output a synthetic email username; the raw diagnostic is excluded. The curated record reports no password, token, authorization-header or session-state output/export. No private inputs are published.
- Cleanup receipts report 0 owned live resources, all 37 owned Next PIDs absent, three exact label-checked services absent and four own ports closed. These are inherited observations, not new cleanup checks by this publication. The eight dependency/license pins' preservation is also inherited; no configuration-content verification is performed here.

No root production, Tolgee, provider, native/physical device, true-zoom or full-matrix acceptance is claimed. Existing ordinary-document-formatting and archived-log-whitespace qualifications are not turned into passes. No ledger, release decision or readiness state advances here.

## Curated material

[Payload index](payload-index.json) seals **29 byte-exact payloads, 1,139,397 bytes**: 23 JSON, five PNG and one original README, all under `runtime/` to retain same-directory references. The [archive-local attributes](.gitattributes) mark only `runtime/**` as `-text`, preserving exact payload bytes through Git staging and checkout. [Input receipt](input-receipt.json) records the allowlist digest and two excluded 5,953,778-byte inventories as hash-only provenance; those inventories were not read or copied. The input allowlist declared 31 files and 13,046,953 bytes. [Source boundary](source-pins.json) reconciles only the 29 auth and 27 presence acceptance source pins; none overlap.

The copied [original README](runtime/README.md), [R155 assertions](runtime/1839-acceptance.json), [R1744 assertions](runtime/1744-acceptance.json), [qualifications and failed attempts](runtime/qualifications.json), [commands](runtime/commands.json), [domain preservation](runtime/domain-preservation-after.json) and [release receipt](runtime/RELEASE.json) retain their original capture-time wording and hashes. Their broad preservation/cleanliness statements describe that earlier frozen capture, not current publication work. Command and harness references are provenance only; unlisted harnesses/private artifacts are deliberately absent and must not be executed or followed.

[Unfilled desktop](runtime/sign-in-desktop-unfilled.png), [unfilled phone](runtime/sign-in-mobile-unfilled.png), [synthetic desktop presence](runtime/presence-desktop-synthetic.png), [synthetic dark phone presence](runtime/presence-mobile-dark-synthetic.png) and [retired/retry state](runtime/presence-retired-retry-synthetic.png) are the five SAFE images. Full pixel decoding uses the installed Windows System.Drawing library during publication; PNG structural/header checks are repeated by the verifier.

## Read-only verification

Run from the repository root using Node; no package installation or archived script is needed:

```powershell
node docs/design/rollout-1692/1839/root-current-runtime-and-presence/verify-evidence.mjs
node docs/design/rollout-1692/1839/root-current-runtime-and-presence/verify-evidence.mjs --current-source
```

Default mode verifies exact payload bytes, sizes, hashes and seal; parses all 23 payload JSON files; checks all five PNG structures/headers; and validates source-pin schema, derivation and boundaries. It executes no artifact. `--current-source` additionally hashes only the 56 declared source paths and reports the relevant full-tree drift; there are zero configuration pins. Both modes are read-only and make no runtime, suite, cleanup or readiness claim.

Archive-local attributes preserve every runtime payload without text conversion and keep generated metadata, including the attribute file itself, in LF form on checkout. This avoids a CRLF conversion invalidating the read-only verifier. No global Git attributes or configuration were changed.
