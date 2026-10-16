# Driving licence management

Confirmed on 2026-10-16 after the product-design interview (Q1–Q29).

**Status: accepted product design; implementation pending.** This reference
records the agreed behavior. It does not claim that the described screens,
permissions, reminders or storage already exist.

## Purpose and boundaries (Q1–Q3)

An organization in Germany must be able to arrange, document and repeat
original driving licence checks before allowing employees to use its vehicles.
Z8 records a personal inspection by an authorized verifier without uploading
or storing driving licence photographs, scans or copies.

The first version covers checks, reminders, evidence and the organization's
class-specific driving authorization. Full fleet management, automated
recognition of documents, automatic matching of licence classes to every
vehicle, and a live authority-register check are outside this confirmed scope.
The verifier assesses the inspected classes and restrictions against the
intended use. A class authorization does not establish suitability for every
organization vehicle.

A check describes the situation at its recorded time. Later withdrawal or a
driving ban becomes known through a report or a subsequent check; Z8 does not
claim to detect it automatically.

Organization owns this model. Its terminology is in
[the Organization context](../../apps/webapp/src/lib/organization/CONTEXT.md).
The boundary decision is in
[Organization ADR 0004](../../apps/webapp/src/lib/organization/docs/adr/0004-driving-authorization-and-check-evidence-have-their-own-lifecycle.md).

## Participants, verifiers and access (Q4, Q10, Q20, Q23, Q26)

The organization selects the employees who are intended to drive its vehicles
and therefore need checks. On enrollment, an employee has no driving
authorization and is shown as not yet checked. An existing assigned-driver
suggestion or vehicle selection creates no authorization.

The organization explicitly grants verifier rights for all its employees or
selected employees and teams. Verifiers may inspect only within their scope.
No one confirms their own check, including an owner or administrator. Managing
settings or verifier assignments does not itself make someone a verifier.

Employees can see their own check records. Verifiers see records within their
assigned scope. Other separately authorized operational roles, such as shift
planners, see only the required authorization status, authorized classes and
necessary driving restrictions; those roles receive no general access to
inspection details or personal background.

When no responsible verifier is available for an employee, organization admins
receive an assignment task. This grants no inspection access or verifier right
and does not extend a deadline.

All settings, participants, grants, checks, authorizations, histories, tasks,
queries and exports are scoped to the organization.

## The check and its evidence (Q2, Q13, Q16, Q18, Q24)

The verifier inspects the original document in person and confirms that it
belongs to the employee. The check identifies the classes actually inspected,
the outcome and relevant driving restrictions. It records the employee's
confirmation that no known driving ban, withdrawal or other impediment prevents
the intended driving, and that applicable restrictions are being met.

Keep only the necessary evidence:

- The employee's identity and the verifier's identity.
- The control time and its result.
- The explicitly inspected classes and their individual results.
- The document's issue date and expiry date, and applicable class expiry dates.
- Required driving-related restrictions, without medical explanations.
- The employee's declaration and the verifier's confirmation.

Do not collect the licence number, address, medical background or images and
copies of the document. A restriction is recorded only to the extent needed
to assess the intended driving. There is no general-purpose field for
collecting the personal background of an impediment.

A completed check record stays unchanged until its permitted deletion.
Corrections are attributable, dated supplements linked to the original;
they do not overwrite the original confirmation or conceal its history.

## Authorization and suspension (Q6, Q7, Q12, Q14, Q17, Q19)

Driving authorization is class-specific. A successful check can grant or renew
only the classes it explicitly covers. An unsuccessful or inconclusive check
immediately suspends the affected authorization. For example, an unconfirmed
class cannot be approved merely because the employee has a different class.

An overdue periodic check suspends the affected authorization automatically.
The status says that the check is overdue; it does not claim that the legal
driving entitlement was withdrawn.

An expired document suspends all authorizations based on it. Expiry of one
class affects the authorizations that depend on that class; independently
verified, still-valid classes can remain authorized. A person-wide or
document-wide impediment overrides every class authorization. A partial
check cannot silently lift such an impediment.

Employees can report at any time that they are currently unable to drive.
The affected authorization is suspended immediately. Personal reasons are
not mandatory.

Reinstatement always requires a new check and the verifier's explicit
reinstatement. When an impediment was reported, the verifier must additionally
establish and confirm that it has been resolved. Merely seeing the card again
does not universally establish that fact. Necessary supporting evidence is
examined outside Z8 without uploading it.

Neither an entered end date for a driving ban nor a longer check interval
reactivates a suspended authorization automatically.

## Intervals, deadlines and changes (Q5, Q17, Q22, Q27, Q28)

Each organization chooses one common interval for routine checks. The starting
point for a class is the last successful check **of that class**. A partial
check renews only the deadlines of classes explicitly and successfully checked.

For each class, the earliest applicable limit governs authorization:

1. The next routine-check deadline.
2. The document's expiry.
3. The relevant class's expiry.

Date-only limits include the whole indicated day in an explicitly fixed
organization timezone. For example, valid through 31 October means through
the end of that day in that zone. The viewer's location does not change the
deadline. A later timezone-setting change must not silently reinterpret an
already established deadline.

Changing the interval recalculates the next routine deadlines of existing
authorizations from their applicable successful checks. Before saving, show
the affected employees and authorizations, especially checks that would become
overdue immediately. A shorter interval can suspend a now-overdue authorization;
an extension never reinstates one already suspended. Document and class
expiries remain independent limits.

The historical check and the policy change remain distinguishable. Changing
an interval does not rewrite what a verifier previously confirmed.

For implementation, actual events use canonical UTC instants and date-only
limits retain their explicit zone context. New date/time business logic uses
Temporal and follows the [date reference](./dates.md) and
[timekeeping reference](./timekeeping.md).

## Reminders and responsibility (Q8–Q10, Q15, Q23)

Each organization configures reminder lead times. The editable initial
suggestion is 30 and 7 days before the relevant deadline, with an additional
notification when authorization is suspended. Document and class expiry are
relevant deadlines as well as the next routine check.

Reminders go to the employee and the verifiers responsible for that employee.
For recipients with their own Z8 access, the in-app reminder is mandatory and
cannot be disabled through personal channel preferences. Additional email
delivery follows the recipient's personal notification settings. Creating or
sending a notification is not evidence that it was read.

For employees who only clock through a shared terminal and have no personal
notification route, the responsible verifier additionally receives a task to
remind the employee in person. Z8 explicitly shows that no direct employee
notification was possible; forwarding a task is not labeled as direct
delivery to that employee.

If a responsible verifier is missing or unavailable, notify organization
admins to arrange responsibility. No reminder, assignment problem or delivery
failure extends a deadline or creates an authorization.

## Retention, departure and export (Q16, Q21, Q25, Q29)

Before activation, the organization must define and justify a retention period
for check records. No universal statutory three-year period or indefinite
retention is assumed.

A record's retention period starts once it no longer supports an active
authorization. Where one check covers several classes, it still supports an
active authorization while any of those active class authorizations relies
on it. At the end of the configured retention period, delete it automatically.
A documented hold for a specific legal case can postpone deletion while that
case requires preservation.

Unchanged historical evidence and finite retention are compatible: supplements
preserve the history while records are retained; they do not require keeping
personal data forever. Generic audit-log cleanup must not prematurely remove
the inspection evidence or the supplements needed to understand it.

At effective employee departure, all the employee's driving authorizations and
verifier grants end. Records continue under their own retention rules.
Rehire restores neither permission nor verifier grants automatically: driving
requires a new check, and verifier rights require a fresh grant.

Employees can export their own evidence as PDF. Verifiers can export evidence
within their current scope. A chosen-period export includes checks,
confirmations, corrections and the authorization history. Inspection exports
also observe organization boundaries. These PDFs supplement the existing
personal-data export contract; they do not remove check records from it.
The [existing Organization export decision](../../apps/webapp/src/lib/organization/docs/adr/0003-only-an-admin-export-is-the-complete-personal-data-export.md)
continues to apply, including its route for former employees.

## Relationship to recorded vehicle use (Q11)

Z8 clearly displays an absent or suspended driving authorization. That status
does not block recording working time or truthful recording and correction of
a vehicle actually used. A recorded trip creates no permission, and permission
does not establish that a trip happened.

This preserves [Time Tracking ADR 0009](../../apps/webapp/src/lib/time-tracking/docs/adr/0009-vehicle-use-is-amendable-work-attribution-not-evidence.md):
vehicle use remains amendable work attribution and clock commands are not
refused or delayed because of vehicle details.

## Examples of the confirmed rules

| Situation | Result |
| --- | --- |
| An employee is already an assigned driver when enrolled. | Not yet checked; no initial authorization is inferred. |
| A check successfully covers B and C; C later expires. | C-related authorization ends; an independent, still-valid B authorization may remain. |
| Only C is successfully rechecked. | Only the C check deadline is renewed. |
| The document expires while the periodic deadline is still in the future. | All authorizations based on that document are suspended. |
| A new interval makes a previously current check overdue. | The impact is shown before saving; the affected authorization is suspended when the new rule takes effect. |
| A longer interval would put a suspended authorization within the date limit again. | It stays suspended until a new check and explicit reinstatement. |
| The employee reports a driving impediment despite a recent check. | The affected authorization is suspended immediately. |
| Someone records a vehicle actually driven during suspension. | The facts remain recordable; recording them grants no authorization. |
| A verifier leaves and no replacement covers an employee. | Their grant ends; admins receive a reassignment task; the employee's deadline is not extended. |

## Legal grounding and product-policy limits

The product decisions above are the confirmed organizational workflow. The
following sources explain its legal background; they do not turn a configurable
interval or retention period into a universally sufficient legal rule.

- [Section 21 StVG](https://www.gesetze-im-internet.de/stvg/__21.html) addresses allowing driving without the required entitlement, during a driving ban, and relevant document seizure. It does not specify one fixed periodic inspection interval.
- [Section 23 FeV](https://www.gesetze-im-internet.de/fev_2010/__23.html) and [section 24a FeV](https://www.gesetze-im-internet.de/fev_2010/__24a.html) distinguish entitlement/class validity from document validity.
- [Section 3 StVG](https://www.gesetze-im-internet.de/stvg/__3.html), [section 20 FeV](https://www.gesetze-im-internet.de/fev_2010/__20.html) and [section 25 StVG](https://www.gesetze-im-internet.de/stvg/__25.html) explain why withdrawal, renewed entitlement and the end of a ban require different verification.
- The [Hessian data protection authority's 53rd activity report, section I.7.5, pages 116–118](https://starweb.hessen.de/cache/hessen/datenschutzbericht2025%2853%29.pdf) supports necessary checks and minimal evidence rather than document copies. It names identity, class, issue date and confirmation among the evidence and discusses data minimization and storage limitation.
- [Sections 195](https://www.gesetze-im-internet.de/bgb/__195.html) and [199 BGB](https://www.gesetze-im-internet.de/bgb/__199.html) concern civil limitation periods; they are not by themselves a fixed retention rule for every inspection record.

## Operating evidence retention and legal-case holds

Organization administrators manage retention under **Settings → Driving licence
control → Evidence retention and legal-case holds**. The list identifies retained
records and their inactivity/deletion times, without giving administrators the
inspection declarations, outcomes or document details. Reading that evidence still
requires the employee's own access or a current scoped verifier grant.

A record is protected while any active class authorization relies on it. Its
retention age begins only when the last such support ends, using the actual
expiry or transition instant rather than the time a delayed worker notices it.
Months follow the explicitly configured organization calendar zone. Changing
settings or releasing a hold does not restart inactivity age. If a fresh record
is explicitly reinstated and supports active authorization, it becomes protected
again; its next inactivity period starts when that support ends.

To preserve a record for a specific legal case, choose the record, enter the
case reference and explain why that case currently requires preservation. Record
only the necessary case reference and preservation purpose, without medical or
personal background. Review the continuing need for each hold through the
organization's case process. When preservation is no longer required, enter the
release reason and release the hold. Placement and release retain the acting
administrator and UTC time until the associated evidence is lawfully deleted.
A released record that was already due becomes eligible for the next cleanup;
release does not add another full retention period.

The registered `cron:driving-licence-retention` job runs daily at 02:15 in the
scheduler's timezone. Administrators can also run due cleanup from the same
panel. Recent results show the time, actor (or scheduled processing), and counts
of deleted, held and active-protected records. Cleanup continues under the saved
retention policy when licence control is disabled. The job rechecks protection
and holds under the same organization lock used for check, suspension and
reinstatement commands. It deletes due originals together with their personal
supplements and linked evidence events; generic audit cleanup does not control
this evidence's lifetime. Current suspension or unresolved impediment state
remains operational and cannot turn deletion into new driving permission.

**Deletion is irreversible through the application.** A cleanup result contains
aggregate counts, not a replacement archive of deleted evidence. Set the finite
period and documented preservation holds before records become due; restoring a
previous application version cannot restore deleted records. The configured
period expresses the organization's justified policy and is no universal legal
retention guarantee.
