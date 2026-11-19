# Root method settlement correction

R155/#1839 remains provisional. The isolated review found that Activity resume released a pending passkey request; root reproduced three controls passing and that one failure. The correction keeps the matching request reservation and method pending state until real settlement while retiring old UI continuations. Exact email/OTP, passkey, SSO/social, token and server authorization owners remain unchanged.

Correction `d30948fac5e82838715f131e05cf69ea63a5e98e` is integrated at `4e9e48b6fdd3e98df20bd73c22b0e0a8e13a32df`; app tree `cc074ac6aefea15c77236bd39bc47681cbf1eff1`. Fresh **283 unit cases/30 files and 43 canonical PostgreSQL cases/four files pass**: 326 distinct occurrences across34files. The37public cases are included, not added. Types, scopedlint/explicit100CRLF and Doctor0/0 pass. Ordinary formatting remains unpassed.

The original [implementation report](../../1839.md) and its entire sealed [evidence](../evidence/index.json) remain byte-for-byte unchanged. Its inspected read-only historical verifier passes:36payloads,18decodedPNGs,318historical cases. Current-source mode is intentionally not claimed because this correction supersedes original pins. Worker normal fixture sign-in/session proof remains inherited; the earlier empty-token cause is unproved because the settled historical baseline completed verification too.

No root Next/browser/native/provider resources were started. The canonical PostgreSQL runner removed its sole exact label-owned container; a separate exact-name query confirmed absence. Fresh independent correction/runtime acceptance and wider provider/native/build/catalog/device/zoom matrices remain pending.

[Exact pins, commands, red/green counts, failed attempts, cleanup and limits](checks.json).

## Organization OAuth navigation follow-up

The additional public regression found that the method promise finalizer released an organization OAuth handoff immediately after browser navigation started. Correction `e8ba771e8ac43ab1a09740a6fa538a6f12ee7461`, integrated at `e5582c5682276ef941fb23ca80197e64acac4dd9`, keeps that handoff pending until departure and restores a usable sign-in arrival on Activity return. A thrown navigation keeps the credential draft and allows retry. Unsettled passkey, SSO and social client requests retain their existing settlement lock.

The current selection passes **285 cases across 30 files**, including ten method cases and 29 surrounding provider/form/widget cases. All three type projects, scoped lint and explicit formatting pass; Doctor reports zero findings. The earlier 43 canonical PostgreSQL cases remain pinned to the preceding correction and were not rerun for this UI-only change. Ordinary formatting remains unpassed.

[Exact source pins, red/green results, commands, preservation and remaining limits](navigation-follow-up.json). Fresh independent and authenticated runtime acceptance remain pending; readiness is null. The original sealed implementation report and evidence remain unchanged.

## Independent public recheck

The frozen independent recheck found no P1 and passed **310 occurrences across 31 files**, including 25 new independent cases and the previous 285; 308 file/full-name labels are unique. Route type generation, workflow/smoke types, scoped lint, explicit formatting and Doctor zero findings pass. Its main app type project remains failed solely because its ignored license report is missing; ordinary formatting remains failed. [Exact result, intake hashes and blocked operations](independent-recheck.json).

The isolated dependency replacement and license copy were rejected by automatic review and never executed. Runtime was not attempted. The existing prepared root environment has passed all three type projects on unchanged sign-in sources; that separate result does not turn the independent type failure into a pass. Runtime follow-up and readiness remain pending.

## Bounded current-source runtime

R155 normal development email sign-in and same-browser session/user/organization boolean readback pass 20/20 listed runtime assertions; unfilled desktop 1600, phone 390 and keyboard checks are included. Automatic approval review rejected the wrong-password operation before execution because of possible lockout/rate-limit state. Refusal, nonsecret draft retention, widget reset and credential retry remain unpassed; no equivalent or retry ran.

[Bounded runtime archive and read-only verifier](../root-current-runtime-and-presence/README.md) preserves the exact historical capture at `bc4010825c1fd94d634b7f4774b6f895bfac26f4`. Its declared relevant source pins still match publication boundary `d6a8863ddf6c9450848a85f88411825101ae13d6`; the two full-app-tree changes are outside those pins. This is not a fresh runtime run on that boundary. Fresh unit/PG suite additions are 0/0. Next's visible uninspected **1 Issue** badge remains unclassified despite empty final error arrays. Cleanup and dependency/license preservation receipts are inherited observations; no configuration-content verification is claimed. No readiness or ledger advances; verifiedCommit and readiness remain null.

[Root staged-blob and checkout audit](../root-runtime-git-blob-audit.json) verifies all 37 publication paths and the 29 exact payload copies. The two raw CRLF cleanup receipts retain 49 whitespace diagnostics; no blanket archive whitespace pass is claimed.
