# Dashboard scheduling and absence delivery

Issue [#1458](https://github.com/Umami-Creative-GmbH/z8/issues/1458), part of
[#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

Upcoming Shifts, Covering For, Who's Out Today and Upcoming Time Off now use the
Dashboard server slots and scoped GET refresh interface. Visible regions start
independently after saved layout resolution. A failed read remains a local error
with retry; it cannot turn into invented empty data. Legitimate empty cover duties
retain the existing hidden-card behavior. Disabled shifts remain hidden.

The render uses its trusted employee identity, while every GET resolves fresh
authorization and verifies expected user/organization scope. The existing deputy
viewer reader now shares its membership and manager-link calculation with trusted
server callers, without reacquiring the employee/session. No client-supplied actor
or permission field authorizes a read. Shift reads retain the original employee,
organization, published-status, ordering and organization-local date/window logic.

Cover duties retain the original absent-employee timezone, fourteen-day window
and category visibility rules. Their DTO records the role used to produce the
display projection. A client role change immediately masks old privileged category
labels; the permitted deputy names/dates remain. Subsequent requests recompute the
viewer and manager links. No shared cross-request cache was added to these reads.

The two organization-wide absence readers select approved current-roster absences
using the organization's calendar day, with explicit Temporal zone conversion.
Approved start/end calendar dates are delivered unchanged as strings. The Who's
Out calculation retains employee deduplication, name order, work-policy schedule,
holiday and future-absence return-date behavior. Its moved holiday expansion uses
Temporal calendar dates and explicit UTC database boundaries, including recurring
February 29 across a non-leap year. The existing return-date helper remains shared.

Upcoming Time Off now obtains displayed absence days from the existing read-time
resolver, using each day's applicable policy, assigned holidays and half-day
coverage. The old client used an inclusive calendar-day subtraction. No absence
total is stored, and approved dates are not rewritten. Relative day markers use
the absent employee's timezone, with the organization fallback, and decimal day
totals follow the UI locale. The DTO explicitly projects only displayed employee
and category fields, so nested database Date objects do not cross the JSON boundary.

Live employee clock-status overlays retain their existing query behavior and are
not added to server snapshots. Dataset refresh retains the shared hook's single
router/RSC global owner and scoped GET local retry. Saved Dashboard layout and
customization remain under the existing provider.

## Verification evidence

- Before migration, the initial real-widget render failed because delivered
  snapshots were ignored. The passing render shows all four regions with no
  initial dataset GET, preserving shift links/night-shift labels, deputy privacy,
  return dates and a half-day total.
- Actual widgets with a real QueryClient/fetch boundary hold and fail each
  widget's local retry while all three completed siblings remain usable. A second
  local retry restores its content; only the selected widget's two explicit GETs
  occur. Scope replacement hides every old-organization delivery.
- A role-reduction regression failed with a privileged cover category still
  visible. It passes after immediate category masking.
- Real React server-stream cases release either member of each new widget pair
  while the other remains pending. GET cases cover fresh authorization, missing
  eligible access and independent requests for all four new IDs.
- PostgreSQL snapshots reuse the trusted actor without a session, retain
  organization-midnight published shift filtering, and preserve category privacy
  and absent-employee day boundaries. An organization-local absence case differs
  deliberately from the UTC date. JSON responses round-trip without Date drift.
- A worked absence spanning a policy change and assigned holiday, with half-day
  endpoints, resolves to 0.5 days. Its Los Angeles employee-local marker is three
  days while the organization calendar is already on the next day. A recurring
  leap-day holiday still delays a 2028 return to March 1.
- Immediately following reads observe schedule status, disabled shifts, absence
  status and deputy reassignment changes, without a shared cache delay. The
  existing PostgreSQL scheduling, deputy and absence-day suites also pass.

The parent owns production builds, authenticated browser manager/restricted-role
journeys, clock controls under held/failed reads, saved-layout/drag/scroll checks,
and cold/warm readiness/request/byte measurements through the authorized local
replica/proxy fixture. No browser latency improvement or production deployment
evidence is claimed from these caller and PostgreSQL tests. Ticket #1458 remains
open until the spec-level gates and final review finish.
