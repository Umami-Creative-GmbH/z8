# Context Map

## Contexts

- [Approvals](./apps/webapp/src/lib/approvals/CONTEXT.md): decides approval requests and delivers their cards while each approval kind moves from legacy requests to canonical workflows
- [Time Tracking](./apps/webapp/src/lib/time-tracking/CONTEXT.md): starts, ends and records employees' working time, and coordinates every writer of it

## Relationships

- **Time Tracking → Approvals**: time corrections and work-period submissions are approval kinds; Approvals decides them and Time Tracking applies the outcome to work records
- **Admission ≠ lifecycle mode**: a Time Tracking organization's admission (`legacy`/`append`) and an Approvals kind's lifecycle mode are independent rollouts
- **Approvals → Time Tracking**: approval decisions, corrections and cancellations that change work records run inside a Time Tracking **work transaction**, taking their approval write gate at the rank the acquisition protocol reserves for it
- **Employee lifecycle → Time Tracking**: a departure closes live work inside a Time Tracking **work transaction**
