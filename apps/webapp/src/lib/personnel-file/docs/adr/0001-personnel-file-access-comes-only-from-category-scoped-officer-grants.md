---
status: accepted
---

# Personnel file access comes only from category-scoped officer grants

A personnel file mixes records with very different audiences: contracts, payslips, certificates and health data in sick notes. Z8 has no HR role, and the obvious stand-ins each see too much or too little. We decided that, besides owners and admins, only a **personnel file officer** sees other employees' documents. The officer grant is scoped like payroll access and expense officer grants (all employees, or named employees and teams) and additionally names the **document categories** it covers, so an external payroll bureau can upload payslips without reading contracts, and few people see sick notes. Managers get no access by managing, payroll access never implies payslips, and a former employee loses access to their own file at the departure cutoff like every other access.

## Considered Options

- **Managers see their reports' files.** Rejected: payslips and contracts are not a line manager's business, and approval authority never implies data access elsewhere in Z8.
- **Payroll access includes payslips.** Rejected: payroll officers export time data; whoever handles payslips may be someone else, and coupling the two would widen both.
- **A custom-role permission.** Rejected for the same reason as ADR 0001 in Travel Expenses: custom-role permissions cannot be scoped.
- **Former employees keep read access to shared documents.** Rejected for now: it needs a new kind of sign-in after membership ends. Officers hand documents over with the personnel file ZIP download instead.

## Consequences

- Category scope is part of every personnel file query and download check, not only of the officer pages.
- A departure revokes the officer grant the departed person holds; grants that name the departed employee stay, so their file can still be managed and purged.
