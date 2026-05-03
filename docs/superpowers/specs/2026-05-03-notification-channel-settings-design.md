# Notification Channel Settings Design

## Goal

Complete organization-level configuration for all notification channels already supported by the notification service: Telegram, Slack, Discord, and Microsoft Teams. Tenant admins and owners can configure organization integrations, while regular users can only choose which available channels they want to receive notifications through.

## Current Context

The notification service already checks and dispatches to Teams, Telegram, Discord, and Slack. `/settings/notifications` renders user preference switches from `availableChannels`, but its server action currently only marks Telegram as organization-configurable. Telegram has an admin settings page at `/settings/telegram` and is listed under the Enterprise settings group.

Slack, Discord, and Teams already have database schemas and availability helpers. They lack matching admin settings entries and settings pages. Push, in-app, and email are baseline channels and should remain visible regardless of organization integration state.

## Settings Navigation

Add a dedicated `notifications` settings group. Move the existing member-facing `/settings/notifications` entry from `account` into this group. Move Telegram from `enterprise` into this group. Add admin-only entries for Slack, Discord, and Microsoft Teams.

The Teams admin channel route should not conflict with the existing organization/team-management route at `/settings/teams`; use a channel-specific route such as `/settings/teams-notifications`.

## Access Control

Channel configuration pages are org-admin scoped. Owners and admins can access and mutate channel configuration. Members and managers cannot access channel configuration pages.

The `/settings/notifications` preference page remains available to all authenticated users. Users can toggle only their personal notification preferences and cannot configure organization channel credentials or channel-level feature settings from that page.

## Channel Availability

`getNotificationPreferences` should compute organization-scoped availability for third-party channels by calling the existing availability helpers:

- `isTeamsEnabledForOrganization`
- `isTelegramEnabledForOrganization`
- `isDiscordEnabledForOrganization`
- `isSlackEnabledForOrganization`

The baseline channels `in_app`, `push`, and `email` are always available. The preference UI hides third-party channel switches when the organization has not configured that channel. It always shows baseline switches.

## Admin Channel Pages

Telegram keeps its existing configuration behavior and route, but it appears in the new Notifications settings group.

Slack, Discord, and Teams receive lightweight admin pages that use existing tables and helper conventions. The first implementation should expose connection status and the shared channel feature settings already present in the schemas: approvals, commands, daily digest, escalations, digest time/timezone, and escalation timeout. Full OAuth/install or bot-token setup can use existing integration helpers where present; if a channel lacks safe end-to-end setup helpers, the page should clearly show the current configuration state and avoid pretending setup is complete.

## User Preference UX

The notification matrix remains the personal preference surface. It should derive visible switches from `availableChannels`, with baseline channels always present. Push can still trigger browser permission subscription when enabled. Unsupported browser push should be handled as a browser capability state, not as an organization-channel availability problem.

## Testing

Update settings visibility tests for the new group and entries. Update route access tests so Slack, Discord, Teams notification configuration pages are org-admin-only. Update notification preference action tests so third-party channel availability reflects configured organization integrations while baseline channels remain available.

Add or update component tests for `/settings/notifications` behavior: baseline channels are always rendered, configured third-party channels are rendered, and unconfigured third-party channels are hidden.
