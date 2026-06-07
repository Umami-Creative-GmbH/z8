# Recipient Language Notifications Design

## Summary

Notify users in their selected UI language for outbound notification channels. Add a shared recipient-language renderer so email, Telegram, push, Slack, Teams, and Discord can all use the same localization behavior instead of duplicating fallback logic per channel.

## Goals

- Resolve notification language per recipient, not per sender or current request.
- Use the recipient's persisted UI language when available.
- Add an organization default language as the fallback for users without a persisted UI language.
- Fall back to English when user and organization language resolution fails.
- Preserve existing notification storage and in-app rendering behavior.
- Make outbound notification localization reusable across all channels.

## Non-Goals

- Do not replace the existing notification tables.
- Do not store one localized copy of each notification per language.
- Do not localize organization-owned email template overrides in this first foundation.
- Do not require every notification type to be migrated before the shared renderer exists.
- Do not drop or delay notifications when localization fails.

## Approved Direction

Build a shared recipient-locale notification renderer first, then wire channels incrementally.

The renderer resolves a recipient locale with this fallback chain:

1. `user_settings.locale`
2. organization default language
3. English (`en`)

The notification service and channel senders keep using existing notification payloads. When a payload includes structured `metadata.i18n` keys and params, outbound delivery renders localized title and message at send time. When metadata or translations are missing, the channel sends the stored English fallback text.

## Current Context

The app already stores user UI language in `user_settings.locale`; `null` means auto-detect. The language switcher persists selected locales through `persistLocaleToDb`, so the selected UI language can be reused outside browser request context.

In-app notification localization already exists in `apps/webapp/src/lib/notifications/localized-notification.ts`. It can render notifications from structured `metadata.i18n` keys and params. Outbound channels currently receive raw `title` and `message` strings from `createNotification`, so Telegram, email, and other channel messages are often English even when the recipient uses another UI language.

The bot platform already has request-independent i18n utilities in `apps/webapp/src/lib/bot-platform/i18n.ts`, including user locale lookup and Tolgee namespace loading. The new notification renderer should reuse this pattern rather than depending on Next.js request headers.

No existing organization default language setting was found. The implementation should add one in organization-level settings and restrict updates to organization owners/admins.

## Architecture

Add a reusable notification localization module for background and outbound delivery.

The module has two responsibilities:

- Resolve recipient locale from user settings, organization default language, then English.
- Render notification title and message from structured i18n metadata using Tolgee outside a request context.

The renderer should be independent of any channel. Channels call it before formatting their channel-specific body, buttons, Markdown, or HTML.

Existing `localized-notification.ts` should remain focused on UI rendering and localized `timeAgo`. The new server-side renderer can share metadata types or parsing helpers where practical, but it should not introduce a client dependency into server delivery code.

## Components

### Recipient Locale Resolver

Add a helper that accepts `userId` and `organizationId` and returns a supported locale.

Resolution rules:

- If `user_settings.locale` exists and is in `ALL_LANGUAGES`, use it.
- Otherwise, read the organization's default language and use it when supported.
- Otherwise, return `DEFAULT_LANGUAGE` (`en`).

Invalid or unsupported language codes are treated as missing values.

### Notification Renderer

Add a server-side renderer that accepts notification-like fields:

- `userId`
- `organizationId`
- `title`
- `message`
- `metadata`

It returns localized `title`, `message`, and the resolved `locale`.

If `metadata.i18n.titleKey` or `metadata.i18n.messageKey` is present, the renderer uses Tolgee to translate those keys with their defaults and params. If either key is missing or fails to translate, the renderer falls back independently for that field.

### Organization Default Language Setting

Add an organization-level default language field, editable by organization owners/admins. The value must be one of `ALL_LANGUAGES`.

The setting belongs in the existing organization settings surface alongside other organization defaults. Store it in application-owned schema or Better Auth extension configuration as appropriate for this codebase; do not edit the generated `src/db/auth-schema.ts` directly. Existing organizations should behave as English until an owner/admin changes the value.

### Channel Integration

Channels should call the shared renderer before sending. The first implementation can wire the renderer into the highest-value channels first while keeping the API reusable for the rest.

Channel-specific formatting remains channel-owned:

- Telegram still escapes localized text for MarkdownV2.
- Email still renders HTML templates and sends through existing organization email configuration.
- Push, Slack, Teams, and Discord can use the localized title/message when integrated.

## Data Flow

1. Application code creates a notification with canonical English fallback `title` and `message` plus optional `metadata.i18n` keys and params.
2. `createNotification` applies user channel preferences and creates the in-app notification as it does today.
3. Before an outbound channel sends, it calls the shared renderer with recipient and notification payload fields.
4. The renderer resolves the recipient locale using user settings, organization default language, then English.
5. The renderer loads the required translations outside request context.
6. The renderer returns localized title/message or stored fallback text.
7. The channel formats and sends its localized payload.
8. Delivery failures remain non-blocking and logged through existing channel error handling.

This keeps notification storage stable and makes outbound localization a delivery-time concern.

## Email Templates

Email notification subjects and default template content currently include hardcoded English strings. The foundation should make subject selection locale-aware and allow default template renderers to receive localized notification data.

Organization-owned email template overrides are out of scope for the first foundation because an override is custom organization content. If an organization supplies an English-only override, the system should not machine-translate it. The shared renderer still provides localized notification fields and locale metadata so future template work can support per-locale overrides deliberately.

## Error Handling

- Missing user settings: use organization default language.
- Invalid user locale: use organization default language.
- Missing organization default language: use English.
- Invalid organization language: use English.
- Missing translation key: use the metadata default or stored English text.
- Translation loading failure: log a warning and use stored English text.
- Channel send failure: keep existing channel-specific handling unchanged.

Localization failure must never prevent notification delivery.

## Authorization And Tenancy

Locale resolution must remain organization-scoped when reading organization defaults. The organization default language update must require organization owner/admin permissions. Regular members and managers cannot change organization-wide language defaults.

The renderer must not use a user's locale from one organization to infer any organization-specific data in another. User locale is user-level, while organization default language is organization-scoped.

## Testing

Add focused tests for:

- Recipient locale resolution uses user locale first.
- Recipient locale resolution falls back to organization default language.
- Recipient locale resolution falls back to English when both values are missing or invalid.
- Rendering from `metadata.i18n` produces non-English title/message for a supported locale.
- Missing metadata, missing keys, or translation load failures fall back to stored title/message.
- At least one channel integration receives localized text rather than raw English.
- Organization owners/admins can update the organization default language.
- Unauthorized users cannot update the organization default language.

## Implementation Boundaries

The first implementation should prioritize the reusable foundation and one or two representative channel integrations. Email and Telegram are the natural first consumers because they are explicitly user-facing outbound channels and already surfaced in the problem statement.

Other channels should adopt the same renderer without new locale resolution logic.
