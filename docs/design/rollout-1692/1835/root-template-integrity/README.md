# Work-template integrity correction

Corrected source: `cda10d3e2e42fee034ab9ad1df2bc4eafda091e8`, based on provisional merge `3782c6ad3af0eff2800f39253b9a601edf7def17`. The merge was not a verified handoff: independent review reproduced two submission races and eight persistence/admission failures. [Original observations](merger/manifest.json) remain separate from the corrected checks.

Save reserves its command at the initiating event, before TanStack validation. Retired Activity/session/account/organization arrivals cannot dispatch it; Skip cannot race the reservation. Both actions pass the initiating actor/organization expectation to the existing server owner. This optional compatibility input compares against fresh server-selected authority; it never selects a tenant or grants permission. The original one-argument action carried no draft-arrival information. The server cannot infer an unseen draft's origin.

The existing user-settings writer accepts an optional transaction callback after its existing exclusive user guard. The work-template owner uses that transaction for canonical settings admission, schema validation, policy, schedule, day rows, optional assignment and onboarding progress. Default conflicts and database failures roll back the whole graph. An existing default produces useful inline refusal and is not replaced. Empty/duplicate-day and decimal distribution semantics remain unchanged. A schema-valid 168-hour single-day input still reaches the database range constraint, but leaves no partial graph and shows a safe message.

The work-policy writer remains outside organization-configuration protection under Time Tracking ADR0003. No organization guard, replacement/history/upsert/idempotency semantics or simultaneous revocation guarantee was introduced. Canonical facts are checked inside the existing user transaction; this is not live concurrent revocation proof. The narrow Drizzle reader adapter remains local; the global database interface and other onboarding writers are preserved.

## Current automated evidence

| Check | Current result |
| --- | --- |
| Unit | **383 cases / 30 physical files**, no failures/skips. Includes the compatibility selection, eight permanent arrival/reservation/message cases and writer/guard coverage. [Results](unit.json), [command/pins](unit-command.json). |
| Real PostgreSQL | **13 cases / one physical file**, no failures/skips. Public actions cover atomic default/range refusal, invalid schema, former/member refusal, explicitly bound organization arrival, owner success and decimal/empty/duplicate days. [Results](pg-all.json), [command](pg-all-command.json). |
| Unique total | **396 cases / 31 physical files**. Focused/red/green reruns overlap and are not added. Original merger's383 cases describe its earlier source. |
| Types | Next route generation and all application/workflow-contract/smoke projects pass. [Command](types-command.json), [log](types.log). |
| Lint/format | Nine-file lint/assist and seven-file explicit100-column CRLF formatting pass. Whole `onboarding.service.ts` formatting remains unpassed; unrelated service/test formatting was preserved. [Lint](lint-command.json), [format](format-command.json), [service qualification](service-format-command.json). |
| React Doctor | Installed0.9.22, seven scanned changed files, **zero errors / zero warnings**, bounded against verified `90a7e5b`. This is not a full-tree/nine-file scan. Two inherited set-state-in-effect directives remain; no new suppression. [JSON](doctor.json), [command](doctor-command.json). |

[Nine canonical source hashes](source-pins.json) match the committed correction and each final command's captured subset. Commands ran while HEAD named provisional `3782c6ad`; exact hashes identify the tested correction, not bare-commit execution. Original independent red probes, root atomicity red/green and message-clause-only red/green remain archived. The latter substitutes only the old message clause, not a historical application.

Some intermediate filenames were reused and overwritten: earlier callback-mock failures, a temporary database-type cast failure and earlier Doctor warnings. Original independent failures, retained red controls, final commands and source pins remain; a complete raw history of every intermediate run is not claimed.

## Actual local recovery and readback

Canonical comparison uses isolated Chromium, normal development sign-in, denied notifications and the same owned disposable organization. Before changes only `onboarding.service.ts` to its exact provisional blob; other corrected sources remain current. The server stops between substitutions; byte-exact restoration is checked. This is a partial-application comparison. Random shell artwork and Pets/Next developer overlays remain visible. The harness waits for toast removal and the Next compilation indicator; recorded theme classes still include `bprogress-busy` on some captures. “Settled” names describe those bounded waits, not complete global-transition settlement or a performance measurement.

| Settled observation | Policy / schedule / day / assignment counts |
| --- | --- |
| Before initial | `3 / 3 / 14 / 1` |
| Before refused default | `4 / 4 / 21 / 1`: actual partial graph |
| Corrected initial and refused default | `4 / 4 / 21 / 1`: whole graph unchanged |
| Corrected pointer retry as non-default | `5 / 5 / 28 / 1`: exactly one complete graph |

Earlier probe-created rows remain in this disposable database. The correction prevents new partial writes prospectively; it does not repair old rows. Both settled phases pass two recorded checks. Three actual Save POSTs complete HTTP200 bodies: one historical refusal, one corrected refusal and one retry. Four separate setup requests are excluded from Save counts. Readback preserves the existing default, time-entry rows and unrelated preferences. The new schedule has37.5 cycle hours, five7.5-hour days and two zero-hour days. Initial progress was already `wellness`: retry observes it retained and real navigation to `notifications`, not a newly demonstrated progress transition. The existing progress/destination contract is preserved.

- [Settled before](runtime-before-settled/work-template-runtime-before.json): two PNGs,17 application pins and four byte-hashed harness snapshots.
- [Settled current](runtime-after-settled/work-template-runtime-after.json): four PNGs, same pin/harness checks, no browser exceptions/blocking dialogs/transient toast obstruction.
- [Actual before server refusal](before-server-refusal.json):23505/default-assignment index observed independently of counts.
- [Earlier before](runtime-before-confirmed/work-template-runtime-before.json) and [after](runtime-after/work-template-runtime-after.json): six further PNGs. Toast/compilation overlays qualify these as operational evidence, not canonical settled layouts.
- [Native current target](native/native-result.json): actual `WorkTemplateSetup`, `TemplateNameField`, `HoursPerWeekField` tree, retained default refusal and one heading. No independent native transport counter or harness snapshot; its two observations are not added automated cases.

Connected Next metadata/compile/error probes are clear for each captured session. Before/native identify `/en/onboarding/work-templates`; after identifies the post-success `/en/onboarding/notifications`. A notifications probe is not a template-route probe and does not erase retained global/settings findings. Public assembled and PostgreSQL arrival tests do not claim live browser account/organization or concurrent revocation coverage.

## Preservation, cleanup and remaining acceptance

[Preservation](preservation.json) checks all50 verified ancestors,14,824 unchanged base paths,96 original #1835 artifact paths and211 prior #1737 paths. Only nine application source/test paths differ. Static153-page/19-alias inventory sources are unchanged. All158 local links and six config hashes match the [dependency proof](dependency-proof.json); no borrowed dependencies/config overlay.

[Cleanup](cleanup.json) verifies exactly three label-owned services removed and absent. Own browser contexts closed; path/PID/creation/listener checks stopped each own Next tree; final62642 closed. Private generated manifests remain ignored, with no cookie/session transfer/provider requests. [Sensitive exclusion](sensitive-exclusion.json) checks secret values in memory before copying. Failed selector/CJS readback setup attempts happened before Save; private raw errors remain local.

Full production generation, remote Tolgee/all locales, providers, physical devices, true zoom, performance, exhaustive accessibility and global transitions remain unpassed. No new saved18px/device certification. Original broader presentation evidence remains inherited and qualified. Issue stays **OPEN** for final review; PR remains draft, unmerged and undeployed.

The [read-only verifier](verify-evidence.mjs) validates retained bytes, pins, cases, readback and cleanup without services or evidence writes. Optional current-source checks may legitimately fail after coordinated later changes; archived verification remains commit-pinned.
