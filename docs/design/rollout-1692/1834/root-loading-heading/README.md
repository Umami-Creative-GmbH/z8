# Root work-schedule loading correction

The pending session and access check now keep the task heading while editable work fields stay hidden. Two permanent page regressions fail on the incoming client and pass after correction `1230f617`. Source `cc2c415d` also includes the separately committed Payroll focus follow-up `4ba74f991`.

Final verification: **178 unique files / 1,900 cases**, full application/workflow/smoke types, five-file explicit CRLF formatting/lint, and Doctor zero errors with two retained work-schedule warnings. Counts deduplicate physical filenames, full test names and repeated-name occurrence. [Quality and qualifications](quality.json), [preservation](preservation.json), [literal commands](compatibility-command.json), and [read-only verifier](verify-evidence.mjs).

The before comparison overlays only the exact historical client onto current fields/actions/service, using a stopped/restarted Next process. It is not a complete historical application execution. Six before checks and 14 final after checks hold real session/access requests and release unchanged responses. Real Save, Skip and member auto-skip persist progress, with organization policy counts unchanged. This legacy step does not save hours or classification to a policy.

Twelve accepted captures cover pending session, pending admission and ready form at desktop and phone sizes. Twelve additional images belong to two failed action harness attempts and remain qualified. [Before admission phone](runtime-before/before-admission-pending-phone.png), [after admission phone](runtime-after-final/after-admission-pending-phone.png), [accepted runtime](runtime-after-final/runtime-after.json). Existing development/Pets overlays remain visible.

Native settled `WorkScheduleForm`/`WorkScheduleHeading` inspection passes. Two native SPA pending-gate attempts time out and remain unpassed; the settled tree does not substitute for them. [Native result](native-ready/native-result.json).

Payroll's new public regression covers focus lost between refusal settlement and the enabled commit. The old guard fails; the narrow follow-up passes all 73 Payroll cases while retaining the deliberate-focus-move control. The initial uncontrolled test pass and failed broad run are preserved. Live Payroll dismissal/focus remains unpassed from its earlier fixture limitation.

No fresh standalone PostgreSQL suite is claimed. Browser actions use the real server and disposable database; earlier integration-suite counts remain tied to their recorded snapshots. Full production generation, remote Tolgee, providers, physical devices, true zoom and broader transition acceptance remain open. All owned browsers, Next processes, port61505 and three labeled fixture services are cleaned. Issues stay OPEN; no dev merge or deployment.
