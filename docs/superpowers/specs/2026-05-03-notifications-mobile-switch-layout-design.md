# Notifications Mobile Channel Layout Design

## Context

The `/settings/notifications` page renders notification categories as cards. Each notification type row currently places the type label and all channel switches in a single horizontal flex row. On mobile, the seven channel controls cannot fit in the available card width and overflow past the viewport.

The page also displays external notification channels even when the current organization has not configured them. Telegram is the only external channel with an available tenant settings page today. Slack, Teams, and Discord should not be displayed until organization-level settings exist and are configured.

## Design

Update the notification preferences server action, hook response type, and `NotificationSettings` rendering.

On mobile, each row stacks the notification type label above the channel switches. The switch container wraps channel controls within the card width. At the `sm` breakpoint and above, the row returns to the existing label-left and switches-right horizontal layout.

The base channels `in_app`, `push`, and `email` remain visible. External channels are visible only when available for the current organization. For now, Telegram is available when the active organization has an org-scoped Telegram bot config whose setup status is not `disconnected`. Slack, Teams, and Discord are unavailable by default because there is no tenant settings page for configuring them yet.

## Behavior

The notification preference toggle behavior, disabled states, labels, icons, and accessibility labels remain unchanged for visible channels. Hidden unavailable channels cannot be toggled from the UI. Channel availability must be scoped to the active organization and must not expose tenant secrets or require tenant-specific environment variables.

## Testing

Verify the server action returns base channels plus active Telegram when configured, keeps Slack/Teams/Discord unavailable by default, and keeps the component layout responsive. Manually inspect the layout classes to ensure mobile controls can wrap and desktop layout is preserved.
