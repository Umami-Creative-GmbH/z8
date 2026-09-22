# Desktop clock preservation — #268 (T04)

Source baseline: `19b3b09a561f8e15806f6cb34fe1d9702861f3fb`.
Contract: [#268](https://github.com/Umami-Creative-GmbH/z8/issues/268),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264),
[#263 resolution](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636),
and [#259 resolution](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Implemented preservation boundary

- `OfflineQueue::get_pending` reads every row, including malformed action JSON,
  payloads, invalid UTF-8 TEXT, BLOBs, wrong SQLite storage classes, NULL retries,
  and retry counts beyond the old `i32` reader's range. Storage classes and byte
  values survive inspection. Original fields and existing local IDs are not
  rewritten. Classification is repeatable, read-only, and uses no migration UUID.
- Malformed and exhausted records have inspectable typed review reasons.
  Every legacy record remains ownership/operation-evidence deficient. A bare
  break timestamp is recognized without assigning an inferred work location.
  Break records additionally retain possible partial-commit meaning.
- The old background submit/update/delete loop is removed. There is no active
  acknowledgment or deletion API: no server receipt/resolution protocol exists
  here that could safely authorize deletion. Stopping attempts does not remove
  evidence. There is no age/retry purge or archive pretending to cancel work.
- Enqueue checks the affected-row count and actual SQLite transaction commit.
  INSERT rejection/ignore and COMMIT failure reach the caller; no optimistic
  clock-state change or successful queue acknowledgment follows failed storage.
- `clock_command::execute` is shared by the native clock-in, clock-out and break
  commands. It returns committed work independently of current-status retrieval,
  or a retained-review reference only after successful local persistence.
  An unavailable response remains uncertain regardless of error string spelling.
- A retained record pauses subsequent desktop clock writes on this installation.
  These identity-less records have no safe dependency/context partition. A new
  login, organization or server destination does not authorize retry, retargeting
  or replacement. Native clock commands reject overlapping requests rather than
  queuing a second write behind an earlier request. The React caller also shares
  one synchronous in-flight guard across ordinary clock actions and idle breaks.
- All three successful write paths survive a failed follow-up status request.
  The React caller shows saved work separately from unavailable current status,
  refreshes status without saving again, and disables clock controls while status
  or local recovery is unavailable. Retained work gets a review message, not a
  “clocked in/out” success message. Local persistence failures remain visible.
  Typed pre-send failures can recover without treating an uncertain write as
  absent. Status caches are keyed by session generation, server and organization;
  late results update only their original scope. Native results redact work/status
  fields if the token/server context changes during the request.
- Ordinary clock-out still omits its timestamp. The stored integer seconds are
  failure-observation time, not original click time, event-local zone evidence,
  proof of noncommitment, or permission to backdate a subsequent close.
- The legacy two-request break can retain the observed acknowledged close entry
  and whether resume was attempted when an error reaches recovery, behind the
  **default-off** Cargo feature `desktop-recovery-evidence`. Enabling that feature
  requires #280 ownership/recovery and linked-cleanup gates first. Normal builds
  retain the existing break payload without this additional receipt capture.
  This is partial-result evidence, not an atomic-operation receipt. A failed
  first request/response still does not prove the close never committed.

## Inspection, ownership, and lifecycle

The authenticated native diagnostic command returns only device-local counts
of retained/malformed/exhausted records. The UI explicitly labels missing
ownership and possible partial commitment. It does not disclose event fields,
employee IDs, timestamps, raw payloads or presumed organization ownership.

The actual bytes remain inspectable through the storage module and in the
original local SQLite file. **Authenticated raw inspection/export and authorized
resolution are not activated**: old rows contain no trustworthy account,
organization, employee or server binding. Possession of today's login cannot
authorize disclosure of another context's work. This limitation is visible in
the UI and must be completed with the evidence-based recovery work in #280;
it is not claimed as a verified raw-export acceptance result for #268.

There is one existing database (`offline_queue.db`) and one existing queue table.
No second receipt store, journal, dispatcher, migration, or independent retention
lifecycle is introduced. When its feature gate is enabled, observed break-failure
details live inside their original recovery row's payload and are retained with
it. Additional capture remains disabled pending cleanup participation.
Future authorized resolution and
whole-context cleanup must handle that entire row and its embedded evidence;
they must establish ownership first. Logout, ordinary edits, status polling,
retry exhaustion and this release do not purge unresolved rows. No production
data cleanup or historical repair was performed or authorized by this delivery.

## Verification seams and evidence

The initial implementation request authorized tests and typechecking. The user
subsequently instructed **“do not verify”**; verification stopped at that point.
Existing tests use the parent-approved **client-storage and caller/HTTP-operation seams**.

`apps/desktop/src-tauri/tests/clock-core` compiles the actual `offline.rs`,
`clock.rs` and `clock_command.rs` files. It substitutes neither the queue nor
clock logic. SQLite tests use temporary files, real triggers and actual locks;
HTTP tests use controlled loopback responses at the real transport boundary.
This harness avoids Linux windowing dependencies, not storage/transport behavior.

| Scenario | Evidence |
| --- | --- |
| Malformed and exhausted rows survive repeated reopen with stable IDs/bytes | `storage_tests::malformed_and_exhausted_rows_remain_inspectable_after_restart` |
| Invalid TEXT bytes, BLOB, wrong timestamp type, NULL/large retry count | `storage_tests::malformed_sqlite_storage_classes_do_not_hide_other_records_or_change_bytes` |
| INSERT reports zero changed rows | `storage_tests::ignored_insert_is_not_reported_as_accepted_queueing` |
| INSERT can proceed but a real shared lock blocks COMMIT; rollback and reopen show no accepted row | `storage_tests::failed_commit_rolls_back_and_restart_does_not_report_a_saved_record` |
| Successful enqueue followed by process exit without destructors; restart recovers original row | `storage_tests::enqueue_survives_process_exit_without_destructors` (invokes ignored subprocess fixture explicitly) |
| HTTP response lost, then real SQLite trigger abort, through caller operation | `command_tests::actual_persistence_failure_reaches_the_clock_caller` |
| Clock-in/out/break writes acknowledged, status returns 503, no enqueue or duplicate POST | `command_tests::every_committed_command_survives_status_failure_without_queueing` |
| Legacy close still omits timestamp | Request-body assertion in the preceding caller test |
| Break close acknowledged, resume fails with non-network HTTP error, restart stops a different-context retry; additional close evidence captured only with feature enabled | `command_tests::partial_break_is_retained_with_acknowledged_close_and_blocks_resubmission_after_restart` (default-off and explicitly enabled configurations) |
| Old failure timestamp/current credentials never become replay authority | `command_tests::legacy_record_does_not_use_current_context_or_failure_timestamp_for_submission` |

Earlier check results are recorded below. These tests do not execute the
production server or native webview and do not establish PostgreSQL atomicity,
authorization, deployment coverage, or power-loss/fsync guarantees.

## Outstanding gates — no activation claim

1. **Native runtime:** the desktop Rust test build cannot complete in this
   environment: `xi` and `dbus-1` development libraries are missing. Native Tauri
   IPC/webview/tray and actual installed-client restart must be verified on a
   supported desktop host. The core harness is not a substitute for this gate.
2. **Preservation deployment (#266):** establish desktop build/version ownership
   and effective update/disable of all old destructive readers. A binary with
   the removed loop can still read/delete this unchanged SQLite table. Returning
   a server error, optional update prompts, or shipping this source is not an
   effective fence. Rollback must not restore that reader against retained data.
3. **Durable scoped command/recovery (#275/#280):** pre-send capture, stable
   business identity, original actor/org/server/target and endpoint evidence,
   authenticated exact outcome lookup/inspection/export, receipt-before-ack,
   and authorized linked resolution remain separately gated. Current failure-time
   retention does not cover a process loss before the recovery INSERT, including
   loss after remote commitment or after receipt arrival. A local storage failure
   cannot create durable evidence of itself.
4. **Atomic break (#281):** close/resume still uses the existing two-request
   transport. It is not a transaction or a durable per-substep checkpoint.
   Crash-between-substeps, exact detected-return capture, intended-period checks
   and atomic rollback require the approved completed-work operation. No legacy
   partial break may be blindly resubmitted in the meantime.
5. **Server/database and pilot (#327/#329):** PostgreSQL access, production
   diagnostics, participating-writer/configuration proof, authorized cleanup,
   repair/continuation, deployment and pilot were not available/authorized here.
   Their runtime obligations remain open. No stricter protocol or new recovery
   authority is enabled by this early corrective source change.

## Final check results

Before the user stopped verification:

- Desktop TypeScript checking passed on the then-current source during several
  implementation iterations.
- The real SQLite storage file passed: five tests plus one deliberately ignored
  fixture that its parent test explicitly invokes as a subprocess.
- The real caller/HTTP file passed: four tests, including all three committed
  write paths followed by status failure. The gated partial-break test also passed
  with `desktop-recovery-evidence` explicitly enabled.
- The initial isolated committed-clock-in/status-failure test passed.
- React Doctor identified complexity and formatter diagnostics; the formatter
  and ClockButton findings were addressed. The last scan still reported App
  complexity; subsequent extraction and review-driven changes were not rescanned.
- The native Rust build attempt was blocked by missing `xi` and `dbus-1`
  development libraries.

**No further verification or full-suite run was performed after the user's stop
instruction. Final review-driven edits are unverified.** Earlier passing checks
are not a claim that the final source, native application or release gates pass.

## Two-axis code review

The requested review ran against the staged work from the baseline above before
the stop instruction. Source review supplied no additional runtime evidence.

### Standards

- P1: late clock results could publish another session/server context's status.
  Added native result redaction and scope-keyed React caches.
- P3, optional smell: repeated supported work-location strings in recovery
  classification. Left as a small follow-up rather than broadening the patch.

### Spec

- P1: added break-receipt capture lacked an executable cleanup-readiness gate.
  Added default-off `desktop-recovery-evidence` in the production/test manifests.
- P2: the idle-break caller could enqueue another request during an ordinary
  clock mutation. Added the shared synchronous UI guard, pending-state control
  gating, and rejection of overlapping native commands.
- P2: all command errors permanently paused the UI, including conclusively
  pre-send errors. Added typed pre-send versus uncertain-persistence failures;
  refresh can clear pre-send errors while uncertain writes remain held.
- Authenticated raw inspection/export and authorized release of legacy holds,
  native/deployed-client verification and the other activation obligations above
  remain incomplete and explicitly blocked.

These changes address the review findings in source; they were not re-reviewed
or verified after the user's instruction to stop verification.
