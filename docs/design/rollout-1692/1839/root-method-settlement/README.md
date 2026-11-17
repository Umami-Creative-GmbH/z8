# Root method settlement correction

R155/#1839 remains provisional. The isolated review found that Activity resume released a pending passkey request; root reproduced three controls passing and that one failure. The correction keeps the matching request reservation and method pending state until real settlement while retiring old UI continuations. Exact email/OTP, passkey, SSO/social, token and server authorization owners remain unchanged.

Correction `d30948fac5e82838715f131e05cf69ea63a5e98e` is integrated at `4e9e48b6fdd3e98df20bd73c22b0e0a8e13a32df`; app tree `cc074ac6aefea15c77236bd39bc47681cbf1eff1`. Fresh **283 unit cases/30 files and 43 canonical PostgreSQL cases/four files pass**: 326 distinct occurrences across34files. The37public cases are included, not added. Types, scopedlint/explicit100CRLF and Doctor0/0 pass. Ordinary formatting remains unpassed.

The original [implementation report](../../1839.md) and its entire sealed [evidence](../evidence/index.json) remain byte-for-byte unchanged. Its inspected read-only historical verifier passes:36payloads,18decodedPNGs,318historical cases. Current-source mode is intentionally not claimed because this correction supersedes original pins. Worker normal fixture sign-in/session proof remains inherited; the earlier empty-token cause is unproved because the settled historical baseline completed verification too.

No root Next/browser/native/provider resources were started. The canonical PostgreSQL runner removed its sole exact label-owned container; a separate exact-name query confirmed absence. Fresh independent correction/runtime acceptance and wider provider/native/build/catalog/device/zoom matrices remain pending.

[Exact pins, commands, red/green counts, failed attempts, cleanup and limits](checks.json).
