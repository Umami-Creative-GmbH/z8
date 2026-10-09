# Context Map

## Contexts

- [Approvals](./apps/webapp/src/lib/approvals/CONTEXT.md): decides approval requests and delivers their cards while each approval kind moves from legacy requests to canonical workflows
- [Organization](./apps/webapp/src/lib/organization/CONTEXT.md): holds an organization's master data about its employees, projects and customers, including the custom fields it defines for them
- [Time Tracking](./apps/webapp/src/lib/time-tracking/CONTEXT.md): starts, ends and records employees' working time, and coordinates every writer of it
- [Travel Expenses](./apps/webapp/src/lib/travel-expenses/CONTEXT.md): collects employees' expense reports for trips and single expenses, and reimburses them
- [Projects](./apps/webapp/src/lib/projects/CONTEXT.md): keeps the organization's projects, the tasks inside them and the project templates new projects start from
- [Public API](./apps/webapp/src/lib/public-api/CONTEXT.md): lets an organization's own systems read its data with an API key, limited to the key's scopes

## Relationships

- **Time Tracking → Approvals**: time corrections and work-period submissions are approval kinds; Approvals decides them and Time Tracking applies the outcome to work records
- **Admission ≠ lifecycle mode**: a Time Tracking organization's admission (`legacy`/`append`) and an Approvals kind's lifecycle mode are independent rollouts
- **Approvals → Time Tracking**: approval decisions, corrections and cancellations that change work records run inside a Time Tracking **work transaction**, taking their approval write gate at the rank the acquisition protocol reserves for it
- **Travel Expenses → Approvals**: a submitted expense report is an approval kind; Approvals decides it and Travel Expenses reimburses what was approved
- **Time Tracking → Projects**: work is booked to a project, and optionally to one of its tasks; project eligibility is part of Time Tracking's organization configuration
- **Travel Expenses → Projects**: an expense's project attribution names the project it is charged to
- **Employee lifecycle → Time Tracking**: a departure closes live work inside a Time Tracking **work transaction**
- **Public API → Time Tracking**: the Public API reads work records and never writes them in v1
