---
status: accepted
---

# Settings actions authorize by settings access, not CASL

Settings server actions each built their own guard, and the codebase ended up with seven definitions of "org admin". They disagreed on whether an unapproved member or a deactivated owner counts, and some trusted an `organizationId` sent by the client (#1592). We decided that every settings action goes through one organization action. It authorizes by **settings access**: it requires org member, scoped manager, org admin or owner, and a higher level also qualifies. Actions do not authorize with CASL `{subject, action}` pairs. CASL has no settings subjects for a scoped manager, only four settings files used it, and its org-level grants survive deactivation.

## Considered Options

- **CASL abilities for settings.** Rejected: scoped-manager settings would need new subjects with conditions. It would also contradict `project-conventions.md`'s "prefer CASL" only in one place instead of making the rule simpler. CASL stays for object-level checks inside handlers, such as whether this manager may edit this employee.
- **Keep per-folder guards and share helpers.** Rejected: the helpers already existed (`requireActiveOrganizationActionActor`), and copies kept appearing beside them.

## Consequences

- The organization is always the session's active organization. Actions take no `organizationId` for authorization. A row named by ID is loaded by ID and organization together, so a row from another organization is simply not found.
- One rule decides who counts:
  - An approved membership is required.
  - A former employee has no settings access at any level, owners included.
  - An owner or admin with no employee record is an org admin.
  - A scoped manager must be on the current roster.
- An employee whose role is admin, without an org-admin membership, is a workforce admin: a scoped manager over the whole organization. This matches the workforce rights CASL already gives them.
- Every refusal comes back as one `ServerActionResult` shape. The client maps it in one place.
- Actions that run before someone is a member, such as redeeming an invite code, do not live under settings.
- Account actions, such as changing the password, picture or name, belong to no organization. They are the only settings actions outside the module, and each one is listed as an exemption with its reason.
- An action whose required level depends on its input declares the lower level. Its handler steps up to owner after the input is validated, so authorization still runs before validation.
- Moving an action onto the module keeps the level it requires today. Changes to which level an action requires are made separately.
