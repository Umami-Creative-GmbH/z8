---
status: accepted
date: 2026-11-07
---

# Member removal and SCIM deprovisioning are deactivations, completed by a follow-up deactivation

ADR 0006 made a deactivation produce a former employee with the same consequences as a departure. Removing a member and an identity provider deprovisioning them already took the person off the current roster, but recorded no moment they left and ended nothing they held: grants, kiosk badges and fobs, equipment responsibility, shifts and approval duties stayed. Both are now deactivations, with the same consequences as one an admin confirms. Their hooks run inside transactions that already hold the removed user's guard, so they cannot take a deactivation's locks in order. They therefore switch the person off and record the moment at once, and a durable follow-up deactivation applies the consequences in its own transaction, without asking for replacement managers, as the deactivation backfill does.

## Considered Options

- **A lighter, reversible suspension.** Holdings would stay so that an identity provider re-enabling the person restores them. That makes a third meaning of "former", and grants would come back without anyone deciding it, which ADR 0006 rejected.
- **Take a deactivation's locks inline.** The approval write gates and the exclusive organization configuration guard would have to move into every removal, leave and rejection hook and into the first SCIM subject guard, ahead of the user guard. Every leave and every SCIM batch would then take an organization-wide exclusive guard.

## Consequences

- Holdings end seconds after the removal, not in the same transaction. Nothing leaks in that window, because access already depends on the membership.
- Every way back is a reactivation: approving a pending member, joining with an invite code, provisioning and an identity provider re-enabling the person. Reactivation brings back nothing that ended.
- A person who is back before the follow-up deactivation runs withdraws it, and nothing ends. A misconfigured SCIM sync that disables and re-enables people does no harm.
- Reports who would be left without a current manager keep their manager link, and the organization's admins are told about them.
- Removals and deprovisionings from before this decision are picked up by running the deactivation backfill again.
