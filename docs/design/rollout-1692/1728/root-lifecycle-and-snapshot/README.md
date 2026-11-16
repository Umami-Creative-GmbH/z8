# Personnel-file directory integration verification

Correction source: `abe51cc17fb89f20af185ea0ce12431e4e450cdb`, following provisional merge `80ca442bd36692f0b9a87c4f94d106a3d81492de`. The provisional merge preserved both histories but was not a verified handoff: a controlled-clock PostgreSQL probe found a directory status that disagreed with canonical access at the departure cutoff. [Original merger observations](merger/manifest.json) remain separate from the final checks.

## Corrected behavior

`listManagedEmployees` now projects its existing `isActive` display field through `employeeHasOrganizationAccess`. Former employees remain in the managed directory; their status follows the live cutoff before deferred execution updates the stored flag. The optional internal `now` argument lets a caller share the same captured instant with expiry reads. The directory page does so. No lifecycle command, cutoff calculation, access grant, document privacy rule or data schema changed.

The permanent regression uses real schedule, cutoff, execution and rehire commands. Before cutoff the file is current; at the cutoff the stored flag is still true and departure pending, while the retained file is marked former, expiry rows disappear and canonical access refuses. After execution it remains former; after rehire it becomes current and expiry rows return. Deactivated, own-file and foreign-organization controls remain. This is controlled-clock database proof, not a live browser cutoff observation. Its clock-out port returns `not_running`; actual time closure, provider and billing completion are not claimed.

The workspace also refuses a retired server-read identity after a displayed organization/account round trip or a later pending-session interruption. A new completed, canonically admitted server read supplies a fresh nonce; local Retry requests that read. Wrong or retired scope retains a safe task heading and recovery. Initial session hydration can settle without permanently discarding its first read. The shared organization provider and server admission remain unchanged. The twelve assembled workspace cases include a batched session-atom round trip and actual same-scope Activity hide/show; they do not claim fresh reads on Activity return or queued mutation/late-toast retirement in shared dialogs.

One existing payslip test previously counted every queued cleanup object in a reused disposable database. It now selects its exact staged cleanup record and restricts the public cleanup call to that record, then to its own deleted document. This isolates the test; production cleanup behavior is unchanged. Earlier seed, cleanup-count and incorrect cleanup-ID harness failures remain under [controls](controls/).

## Fresh checks

| Check | Result |
| --- | --- |
| Unit | **327 pass / one known baseline guard failure**, 328 cases across 26 physical files. All 12 workspace cases pass. [Results](acceptance/unit.json), [command](acceptance/unit-command.json). |
| PostgreSQL | **149/149 pass**, 11 physical files, no skips. Includes lifecycle, category/officer/document/request, canonical roster/access, payslip and work-template compatibility. [Results](acceptance/pg-all.json), [command](acceptance/pg-all-command.json). |
| Unique combined | **477 cases / 37 physical files:476 pass, one failure**. Earlier worker, red/green and payslip-only selections overlap and are not added. |
| Types | Next route generation plus application/workflow-contract/smoke projects pass. [Command](acceptance/types-command.json), [log](acceptance/types.log). |
| Lint / Doctor | Twelve-file lint and bounded Doctor against verified `16443982` pass; Doctor reports 0 errors/0 warnings. Exact source pins accompany commands. [Lint](acceptance/lint-command.json), [Doctor](acceptance/doctor.json). |
| Formatting | Read-only explicit CRLF profile fails five paths: expiry component/test, route metadata/test and access-store. No blanket formatting pass or unrelated rewrite. [Command](acceptance/format-command.json), [output](acceptance/format.log). |

The failing broad current-roster guard reports raw-active expressions in four payroll/approval/test-helper files. Their entire Git blobs are identical at the correction, provisional merge and previous verified baseline. The guard and its baseline were not relaxed. [Exact classification](controls/roster-guard-baseline.json). This remains an unresolved broad guard finding; the full unit selection is not green.

[Final verification manifest](acceptance/verification-manifest.json) seals 19 application source hashes, command results, runtime and cleanup. Commands run on the committed correction, not merely a dirty provisional revision. The original 109-artifact index remains byte-identical. **108 indexed artifacts are public**; the private PostgreSQL log remains local and only its existing size/hash is listed in [publication exclusions](publication-exclusions.json). No private log is needed to run the public verifier.

## Actual local journeys

Fresh isolated Chromium uses normal development sign-in and public settings actions; credentials stay private. No saved/copied/restored/minted authentication state, SQL authority changes, provider/customer requests or borrowed runtime is used.

- [Runtime01](acceptance/runtime-01.json) proves actual owned expiry-query cancellation, an unavailable expiry section with directory records retained, and real pointer Retry recovery. Later grant-picker harness failure does not invalidate those completed read-recovery observations. The reverse directory failure remains assembled-only: no selective runtime seam was induced.
- [Runtime08](acceptance/runtime-08.json) is the accepted officer/draft proof. A real public certificate-only, one-target grant matches scoped readback. The officer sees exactly the target certificate, no other category/self/unsupported destination; own file and an independent nonofficer are refused. A separate administrator publicly revokes the exact grant. Actual settled Request then refuses, preserves the visible Title, note, Certificate and **Nov 20, 2026** deadline, keeps submit enabled, and leaves **zero** exact organization/employee/title request rows before and after. Reload refuses the directory. Public Large font renders 18px and survives phone reload without horizontal overflow.
- Runtime07's pixels showed the deadline but its JSON incorrectly read an empty `BUTTON.value`. It is not the accepted complete-draft record. Runtime08 records the visible button text correctly. Failed runtime01–06 grant/picker attempts and their source copies remain distinct.
- [Native03](acceptance/native-03.json) observes actual `PersonnelFilesWorkspace` and `ExpiringDocumentsCard` owners after renderer/font readiness, with normal auth and successful exact-session close. Earlier tree/close timeouts remain archived and their exact daemons were cleaned. Native launches disable notifications; its JavaScript permission probe returns `Notification is not defined`, so permission API coverage is unavailable rather than a successful permission response.

Current connected target Next compilation/config/session error arrays are empty. Runtime07 separately recorded a country-label hydration mismatch during `/settings/organization` setup; this is observed follow-up for R118/#1791, not a diagnosed cause or a target-route failure. Fresh matched target observations remain separate from that setup record and older global/settings findings.

## Matched captures and provenance

[Historical](acceptance/matched-before.json) and [current](acceptance/matched-current.json) cover 1600 desktop, 390 phone and 2400 wide/dark with the same six synthetic expiry rows. The comparison explicitly emulates light/dark and16px; it does not prove saved-theme persistence. Actual saved Large18px/reload is the separate runtime08 journey. Only three exact committed `a5c7f741` consumers are overlaid: directory page, expiry component and route metadata. The own server stops before each substitution; all bytes are restored. Other current sources, including the cutoff correction, remain current. This is a partial-application comparison, not execution of a whole historical application.

The historical main heading DOM count is two, current one; DOM visibility does not certify clipping or screen-reader behavior. Initial full-page/current captures show transition clipping and developer overlays. Final matched captures are viewport-only with bounded font/sidebar/animation/toast waits. Desktop/wide current geometry measures heading left280, main left256, sidebar right256. Persistent `bprogress-busy` and Pets/Next overlays remain visible and qualified. Some successful current capture filenames were superseded by the final viewport-only version; failed attempts remain, but not every successful intermediate image is retained. Phone top-viewport images do not show every directory row at once.

## Preservation, cleanup and remaining work

[Preservation](preservation.json) verifies 51 prior verified ancestors, 15,038 unchanged base paths and only eight root source/test changes. It preserves all 100 original #1728 artifact paths,203 #1835 paths including 107 proof-directory artifacts plus the existing report,211 #1737 paths and266 #1736 paths. All nine #1835 source pins,153-page/19-alias inventory,158 internal dependency links and six sealed configuration hashes remain unchanged. [Dependency proof](dependency-proof.json).

Cleanup verifies exact path/PID/creation/listener-owned Next trees, both task-native sessions and exactly three transferred label-owned services absent. The final process audit records zero owned runtime/native processes and a closed port 56769. Private generated manifests remain ignored. The [sensitive exclusion check](sensitive-exclusion.json) scans exact generated private values in memory before publishing.

Unpassed acceptance includes live former/cutoff rendering, browser account/organization races, reverse directory runtime failure, queued shared-command/late-toast/dismissal/ABA behavior, first Escape/focus return, full accessibility/contrast/screen-reader checks, binary document storage/download, full production generation, remote translations, physical devices, true zoom and exhaustive locale/theme/feature coverage. Earlier worker evidence remains tied to its own source and method; historical saved-auth drivers must not be rerun under the current normal-auth-only policy.

The issue remains **OPEN** for final user review. Draft PR 1854 stays unmerged and undeployed. The [read-only verifier](verify-evidence.mjs) checks archived bytes/source/cases/journeys/cleanup without launching services or rewriting evidence; optional current-source checks may legitimately fail after later coordinated changes.
