# Notification preferences are user-level, not organization-scoped

A user's notification preferences apply across every organization they belong to, while channel availability (Slack, Teams, Discord, Telegram, webhooks) remains organization-scoped. The `notification_preference` table retains a legacy nullable `organization_id` column for backwards compatibility, but its unique key is `(user_id, notification_type, channel)` and neither onboarding nor notification settings populate `organization_id`. Organization-level checks — such as the Implementation Checklist's notifications check — therefore scope by joining through the organization's current org members (approved memberships, excluding former employees) rather than filtering `notification_preference.organization_id`.

## Considered Options

- **Migrate `notification_preference` to organization-scoped rows**: rejected. It would require a schema migration changing the unique constraint, updating every preference reader and writer across onboarding, settings, and outbound delivery, and forcing multi-organization users to reconfigure preferences per workspace.
- **Populate `organization_id` on the existing user-level rows**: rejected. Because each `(user_id, notification_type, channel)` row is unique per user, saving preferences in a second organization would overwrite `organization_id` and silently regress the first organization's checklist status.

## Consequences

- Writers in onboarding and notification settings continue storing user-level notification preferences without setting `organization_id`.
- Organization-scoped checks that detect configured notification preferences join against approved organization memberships and exclude former employees, matching the Organization context's definition of an org member.
- Organization channel availability stays separate from user notification preferences; enabling an active notification integration continues to satisfy the organization's notifications checklist item independently.
