---
status: accepted
---

# Sick notes attached to absences are personnel file documents

Employees attach photos of their sick notes to sick-leave absences. A sick note is health data (GDPR Art. 9), and the personnel file already has a sick note category with category-scoped officer grants, retention and purge. So we decided that a sick note attached to an absence is an employee document in the personnel file, linked to the absence, and that the absence only knows that sick notes exist. The approver of the absence and the employee's managers see that a sick note is attached, never its content, unless they are a personnel file officer covering sick notes for that employee.

## Considered Options

- **An attachment owned by the absence**, in its own storage. Rejected: a second store of health data would need its own access rules, retention, purge and export, next to the personnel file that already has them.
- **The approver opens the sick note.** Rejected: it would undo ADR 0001 (managers get no access by managing) for the most sensitive category. The approver needs to know that a note exists, not what it says, and sick leave is auto-approved by default anyway.

## Consequences

- Sick notes can be attached only while the organization has personnel files enabled, and employees attach them only when the organization has also allowed it. That setting is off by default: many organizations rely on the electronic sick note (eAU) alone.
- Cancelling an absence deletes the sick notes linked to it. Rejecting it does not.
- An employee's own sick note is a shared document, like every employee upload, so the employee keeps seeing what they uploaded.
