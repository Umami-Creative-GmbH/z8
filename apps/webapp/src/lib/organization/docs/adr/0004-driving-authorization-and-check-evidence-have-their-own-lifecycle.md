---
status: accepted
date: 2026-10-16
---

# Driving authorization and check evidence have their own lifecycle

The organization needs to control who may drive its vehicles and show when an original driving licence was checked, without retaining licence images. We decided that Organization owns class-specific **driving authorization** and structured **driving licence check records** with scoped verifier access and organization-defined retention. Their lifecycle is separate from an assigned-driver suggestion, recorded vehicle use, a Scheduling skill and a Personnel File document: those concepts answer different questions and carry different access and correction rules.

The product rules were confirmed after Q1–Q29 on 2026-10-16 and are recorded in the [driving licence management reference](../../../../../../../docs/refs/driving-licence-management.md). This is an accepted design decision; feature implementation is pending.

## Considered Options

- **Treat vehicle assignment or vehicle selection as authorization.** Those describe usual or actual vehicle use, not whether the employee was checked for the intended classes. Coupling them would also make truthful retrospective recording depend on current permission.
- **Use an ordinary employee skill and certificate.** A skill's planning warnings and document-oriented certificate access do not establish the required suspension, personal original inspection, verifier scope or evidence lifecycle.
- **Keep the proof only in the generic audit log.** Its general cleanup policy cannot define the organization's retention period for inspection evidence. Evidence must remain understandable, including its corrections, for the configured period.
- **Keep a photograph or copy as the evidence.** The confirmed privacy constraint excludes that collection; a minimal structured record documents the inspection instead.

## Consequences

- [Time Tracking ADR 0009](../../../time-tracking/docs/adr/0009-vehicle-use-is-amendable-work-attribution-not-evidence.md) remains valid: suspension never blocks clocking or truthful vehicle attribution.
- A completed check is supplemented rather than overwritten. Its eventual permitted deletion follows its own retention policy.
- Document expiry and person-wide impediments override class clearances. Partial checks renew only the successfully checked classes and cannot silently reinstate a global suspension.
- Verifier grants are separate from line management and personnel file access; their scope also limits inspection PDFs. The existing [personal data export contract](./0003-only-an-admin-export-is-the-complete-personal-data-export.md) remains applicable.
