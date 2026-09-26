# Context Map

## Contexts

- [Approvals](./apps/webapp/src/lib/approvals/CONTEXT.md): decides approval requests and delivers their cards while each approval kind moves from legacy requests to canonical workflows
- [Time Tracking](./apps/webapp/src/lib/time-tracking/CONTEXT.md): starts, ends and records employees' working time

## Relationships

- **Time Tracking → Approvals**: time corrections and work-period submissions are approval kinds; Approvals decides them and Time Tracking applies the outcome to work records
- **Admission ≠ lifecycle mode**: a Time Tracking organization's admission (`legacy`/`append`) and an Approvals kind's lifecycle mode are independent rollouts
