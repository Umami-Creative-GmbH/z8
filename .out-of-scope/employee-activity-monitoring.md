# Employee activity monitoring

Z8 does not monitor what employees do while they work. That means no
periodic screenshots, no keyboard or mouse activity levels, no
"idle" detection from input devices, and no tracking or classifying of
the apps, windows or URLs an employee uses.

Z8 records working time: when work starts and ends, breaks, absences,
the project or task the time belongs to, and the corrections and
approvals around those records. It does not measure how intensively
someone works inside that time.

## Why this is out of scope

**It needs the works council's agreement.** In Germany, introducing
technical systems that are suitable for monitoring employee behaviour
or performance is subject to co-determination under § 87(1) no. 6
BetrVG. Activity monitoring is the textbook case. A customer with a
Betriebsrat cannot switch it on without a works agreement, and offering
it puts Z8 on the wrong side of every rollout conversation with one.

**It fails the GDPR proportionality test.** Under Art. 6 and Art. 88
GDPR and § 26 BDSG, processing employee data needs to be necessary
for the employment relationship. Continuous capture of screen contents,
input activity and browsing is far beyond what recording working time
requires, and it routinely captures private and third-party data
(messages, customer data, health information on screen). Data
protection authorities and labour courts in the DACH region treat
permanent, covert or blanket monitoring as unlawful in almost all
cases.

**It contradicts what Z8 sells.** Z8's positioning is compliance and
trust: an ArbZG engine that enforces limits, hash-chained time entries,
GoBD audit exports, and a works-council mode built on least privilege
and data minimisation (see
`docs/superpowers/specs/2026-05-24-works-council-mode-design.md`). A
surveillance feature would undercut that position for every customer,
including the ones who never enable it.

The 2026-10 market comparison (tracker #758) found that one competitor
sells this feature. It was deliberately not ranked as a gap.

## What is still in scope

These are not activity monitoring and are triaged on their own merits:

- **A consent-based location stamp on clock events** (#766): one
  location point at clock-in, clock-out and break start or end, with
  recorded employee consent, a per-employee or per-team switch, and
  the setting shown to the works council. No continuous route
  tracking.
- **Reminders to clock in, clock out or take a break** (#760), driven
  by shifts and work-policy schedules rather than by observed
  activity.

If a request needs data about what an employee is doing on their
device, rather than when they are working, it belongs here.

## Prior requests

- #758: "Tracker: feature gaps from the 2026-10 market comparison"
  (excluded in the tracker body, not filed as a sub-issue)
