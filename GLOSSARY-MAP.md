# Context Map

## Contexts

- [Delivery](./.github/GLOSSARY.md): verifies proposed Z8 changes, provides desktop installers for review, and prepares releases for publication

- [Absences](./apps/webapp/src/lib/absences/CONTEXT.md): counts the working days employees take off and draws vacation from their allowance
- [Approvals](./apps/webapp/src/lib/approvals/CONTEXT.md): decides approval requests and delivers their cards while each approval kind moves from legacy requests to canonical workflows
- [Billable Time](./apps/webapp/src/lib/billable-time/CONTEXT.md): prices customer-chargeable work, reports its revenue and margin, and hands it to accounting tools as invoice drafts
- [Organization](./apps/webapp/src/lib/organization/CONTEXT.md): holds an organization's master data about its employees and customers, and the custom fields it defines on employees, projects and customers
- [Time Tracking](./apps/webapp/src/lib/time-tracking/CONTEXT.md): starts, ends and records employees' working time, and coordinates every writer of it
- [Travel Expenses](./apps/webapp/src/lib/travel-expenses/CONTEXT.md): collects employees' expense reports for trips and single expenses, and reimburses them
- [Projects](./apps/webapp/src/lib/projects/CONTEXT.md): keeps the organization's projects, the tasks inside them and the project templates new projects start from
- [Public API](./apps/webapp/src/lib/public-api/CONTEXT.md): lets an organization's own systems read its data with an API key, limited to the key's scopes
- [Personnel File](./apps/webapp/src/lib/personnel-file/CONTEXT.md): keeps each employee's documents and controls which of them the employee sees
- [Scheduling](./apps/webapp/src/lib/scheduling/CONTEXT.md): plans shifts ahead of time and helps planners staff open shifts

## Relationships

- **Time Tracking → Approvals**: time corrections and work-period submissions are approval kinds; Approvals decides them and Time Tracking applies the outcome to work records
- **Admission ≠ lifecycle mode**: a Time Tracking organization's admission (`legacy`/`append`) and an Approvals kind's lifecycle mode are independent rollouts
- **Approvals → Time Tracking**: approval decisions, corrections and cancellations that change work records run inside a Time Tracking **work transaction**, taking their approval write gate at the rank the acquisition protocol reserves for it
- **Travel Expenses → Approvals**: a submitted expense report is an approval kind; Approvals decides it and Travel Expenses reimburses what was approved
- **Time Tracking → Billable Time**: whether completed work is billable is part of its attribution, recorded and amended by Time Tracking like its project; Billable Time prices and reports it
- **"Billing" ≠ Billable Time**: Time Tracking's billing entitlement is the organization's Z8 subscription; Billable Time is about the organization charging its own customers
- **Projects → Billable Time**: a project's customer and billable default decide whether its work can be billable work; Billable Time sets rates on projects but Projects owns the project
- **Organization → Billable Time**: customers belong to Organization; Billable Time adds their rates, tax treatment and contact link
- **Time Tracking → Projects**: work is booked to a project, and optionally to one of its tasks; project eligibility is part of Time Tracking's organization configuration
- **Travel Expenses → Projects**: an expense's project attribution names the project it is charged to
- **Organization → Projects**: an organization defines project custom fields in Organization; a project holds custom field values for them, and Projects owns the project itself
- **Employee lifecycle → Time Tracking**: a departure closes live work inside a Time Tracking **work transaction**
- **Employee lifecycle → Personnel File**: a departure revokes the personnel file officer grant the employee holds and starts the **retention** clock of their documents; a rehire stops it
- **Absences → Personnel File**: a sick-leave absence can have sick notes, which are employee documents in the personnel file; the absence knows only that they exist, and personnel file access decides who sees them
- **Public API → Time Tracking**: the Public API reads work records and never writes them in v1
- **Work policy → Absences**: the schedule of an employee's work policy decides which of their days are working days; Absences reads it to count absence days and never changes it
- **Scheduling → Time Tracking**: a shift is planned work and a work period is recorded work; a staffing suggestion reads a candidate's work periods to judge compliance and never writes them
