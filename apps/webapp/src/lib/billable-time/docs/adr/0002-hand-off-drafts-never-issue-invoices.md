---
status: accepted
---

# Hand off drafts, never issue invoices, never block corrections

Z8 does not issue invoices. It creates invoice drafts in the organization's own accounting tool (Lexware Office, sevdesk), where the accountant finalizes them, and it never creates contacts there: a customer must be linked to an existing contact first. Invoicing also never blocks a correction. Invoiced work whose times, project or billability are corrected keeps its invoiced state and is marked as changed after invoicing until an admin clears the mark. Z8's working-time record has to match what actually happened (ArbZG, GoBD), so it wins over keeping the work consistent with an invoice that has already gone out (#768).

## Considered Options

- **A native invoice engine** (numbering, PDFs, payment status, taxes). Rejected: DACH customers already keep their books in an accounting tool, and issuing invoices would make Z8 responsible for invoicing compliance it has no reason to own.
- **Lock invoiced work against corrections.** Rejected: it would make the time record wrong whenever an invoice preceded a correction, and the fix belongs in the accounting tool (a credit note) anyway.
- **Create missing contacts in the accounting tool on first hand-off.** Rejected: it risks duplicate contacts in the customer's books.

## Consequences

- An invoice draft deleted in the accounting tool stays invoiced in Z8 until an admin releases it.
- Tax decisions such as reverse charge are made by choosing a tax treatment and checked by the accountant on the draft. Z8 does not determine them itself.
