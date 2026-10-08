---
status: accepted
---

# Expense officer grants replace the `TravelExpenseFinance` custom-role permission

Finance access to approved expense reports (read, export, record reimbursements and recoveries) used to come from the `TravelExpenseFinance` CASL subject, held by owners and admins and grantable to anyone else only through a custom role. Custom-role permissions carry no conditions, so that access was always organization-wide. Organizations need expense officers in the way they have payroll officers: an internal accountant for one team, or an external bookkeeper who exports but never records payouts. We decided that an **expense officer grant** is the only way to give non-admins finance access. Like a payroll access grant, it is scoped to all employees or to named employees and teams. Unlike payroll access, it carries two capabilities: export and record reimbursements. Existing custom-role holders are migrated to all-scope grants with matching capabilities, and the permission leaves the custom-role registry. Owners and admins keep full finance access implicitly.

## Considered Options

- **Keep the custom-role permission and add grants alongside it.** Rejected: two sources for the same power, one of them unscoped, so an access review has to check both and the unscoped one always wins.
- **Extend payroll access grants to cover travel expenses.** Rejected: payroll and bookkeeping are often different people. An external bookkeeper would gain salary-relevant time data.
- **Add scope conditions to custom-role permissions.** Rejected: that is a general change to the RBAC system for one subject, and payroll access already chose grants over custom roles.

## Consequences

- Approval authority still never implies finance access, and a grant never implies approval authority.
- Grants are audited on create, change, revoke and offboarding, and payroll access grants get the same treatment, because both pages share one grant editor.
