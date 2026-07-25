# Payroll Access Error Classification

## Problem

The payroll workspace loads its initial summary through
`getPayrollWorkspaceSummaryAction`. The canonical time-record cutover guard can
reject that load when payroll data is not ready. The action wrapper currently
converts that operational failure into a `ValidationError`, and the payroll page
renders every failed action result as “No payroll access.”

As a result, a user with an active, organization-scoped payroll access grant is
shown an authorization denial even though authorization succeeded.

## Design

Keep the canonical cutover guard fail-closed so payroll never displays totals
from an incomplete canonical dataset.

Classify failures at the server-action boundary according to their actual
meaning:

- Authentication and authorization failures retain their existing tagged error
  codes.
- Canonical payroll data-readiness failures become a distinct, safe
  operational result rather than a `ValidationError`.
- Unexpected failures remain non-authorization failures and do not expose
  sensitive internal details to the client.

At the payroll page boundary:

- Render the existing “No payroll access” state only for authentication and
  authorization result codes.
- Render a separate “Payroll temporarily unavailable” state for data-readiness
  and other operational failures.
- Do not render payroll totals or the workspace when the canonical dataset is
  incomplete.

The payroll access grant lookup and employee scope resolution remain unchanged.
They already enforce the active organization and active grant.

## Error Flow

1. The assigned payroll officer requests the payroll workspace.
2. Existing organization-scoped grant resolution authorizes the officer and
   resolves allowed employee IDs.
3. The summary service checks canonical cutover readiness.
4. If ready, the payroll workspace renders normally.
5. If not ready, the action returns an operational/data-readiness code and the
   page renders the temporary-unavailability state.
6. Only actual authentication or authorization failures render “No payroll
   access.”

## Security and Data Integrity

- Authorization remains fail-closed and organization-scoped.
- The change does not broaden payroll access or bypass employee scope.
- Incomplete canonical payroll totals remain blocked.
- Client-facing messages remain generic; detailed causes stay in server logs.

## Testing

Add focused regression coverage proving:

- A canonical data-readiness failure is not returned as `ValidationError`.
- Authentication and authorization failures retain access-denied
  classification.
- The payroll page renders access denied only for auth failures.
- The payroll page renders temporary unavailability for operational failures.

Run the focused payroll action/page tests, relevant payroll access tests, and
the webapp type/lint checks appropriate to the touched files.
