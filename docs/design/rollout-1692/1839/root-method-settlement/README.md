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
