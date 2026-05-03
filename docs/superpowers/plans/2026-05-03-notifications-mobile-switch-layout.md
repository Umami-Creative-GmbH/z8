# Notifications Mobile Channel Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent notification channel switches from overflowing the mobile viewport on `/settings/notifications` and hide external channels that are not configured for the active organization.

**Architecture:** The notification preferences server action returns org-scoped channel availability alongside the existing user-level preference matrix. The client hook exposes that availability, and `NotificationSettings` renders only available channels while stacking and wrapping visible switches on mobile.

**Tech Stack:** Next.js app router server actions, Effect runtime services, Drizzle ORM, React client component, TanStack Query, Tailwind CSS utility classes, existing shadcn-style `Card` and `Switch` components.

---

## File Structure

- Modify: `apps/webapp/src/lib/notifications/types.ts`
  - Responsibility: notification type definitions and API response shapes.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts`
  - Responsibility: fetch and update current user's notification preferences and org-scoped channel availability.
- Modify: `apps/webapp/src/hooks/use-notification-preferences.ts`
  - Responsibility: expose notification preference query data and mutations to client components.
- Modify: `apps/webapp/src/components/notifications/notification-settings.tsx`
  - Responsibility: render notification category cards, notification type labels, visible channel switch controls, and push notification states.

No schema changes are needed. Do not add environment variables. Tenant-specific channel availability must come from existing organization-scoped database configuration.

### Task 1: Add Channel Availability To Notification Preferences Response

**Files:**
- Modify: `apps/webapp/src/lib/notifications/types.ts:157-161`

- [ ] **Step 1: Extend `UserPreferencesResponse`**

Update the interface in `apps/webapp/src/lib/notifications/types.ts` from:

```ts
export interface UserPreferencesResponse {
	preferences: NotificationPreference[];
	// Matrix format for UI: type -> channel -> enabled
	matrix: Record<NotificationType, Record<NotificationChannel, boolean>>;
}
```

to:

```ts
export interface UserPreferencesResponse {
	preferences: NotificationPreference[];
	// Matrix format for UI: type -> channel -> enabled
	matrix: Record<NotificationType, Record<NotificationChannel, boolean>>;
	// Organization-scoped availability for rendering channel controls.
	availableChannels: Record<NotificationChannel, boolean>;
}
```

- [ ] **Step 2: Run a targeted type check if available**

Run from repository root:

```bash
pnpm test -- notification
```

Expected: existing notification-related tests pass or unrelated no-match output is reported by the runner. If type errors appear because the new `availableChannels` property is missing, continue to Task 2.

### Task 2: Compute Org-Scoped Channel Availability

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts:1-68`

- [ ] **Step 1: Update imports**

Change the imports at the top of `apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts` from:

```ts
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { notificationPreference } from "@/db/schema";
```

to:

```ts
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { notificationPreference, telegramBotConfig } from "@/db/schema";
```

- [ ] **Step 2: Add channel availability computation inside `getNotificationPreferences`**

In `getNotificationPreferences`, after the preference query and before building the response, add active-organization availability. The full function body should be:

```ts
export async function getNotificationPreferences(): Promise<
	ServerActionResult<UserPreferencesResponse>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const organizationId = session.session.activeOrganizationId;

		// Get all preferences for this user (user-level, not org-specific)
		const preferences = yield* _(
			dbService.query("getNotificationPreferences", async () => {
				return dbService.db
					.select()
					.from(notificationPreference)
					.where(eq(notificationPreference.userId, session.user.id));
			}),
		);

		const telegramConfig = organizationId
			? yield* _(
					dbService.query("getNotificationChannelAvailability", async () => {
						return dbService.db.query.telegramBotConfig.findFirst({
							where: and(
								eq(telegramBotConfig.organizationId, organizationId),
								eq(telegramBotConfig.setupStatus, "active"),
							),
						});
					}),
				)
			: null;

		const availableChannels: Record<NotificationChannel, boolean> = {
			in_app: true,
			push: true,
			email: true,
			teams: false,
			telegram: Boolean(telegramConfig),
			discord: false,
			slack: false,
		};

		// Build preference matrix (all types x all channels, defaulting to true)
		const matrix: Record<NotificationType, Record<NotificationChannel, boolean>> = {} as Record<
			NotificationType,
			Record<NotificationChannel, boolean>
		>;

		// Initialize all to true (default enabled)
		for (const type of NOTIFICATION_TYPES) {
			matrix[type] = {} as Record<NotificationChannel, boolean>;
			for (const channel of NOTIFICATION_CHANNELS) {
				matrix[type][channel] = true;
			}
		}

		// Override with actual preferences
		for (const pref of preferences) {
			if (matrix[pref.notificationType]) {
				matrix[pref.notificationType][pref.channel] = pref.enabled;
			}
		}

		return {
			preferences,
			matrix,
			availableChannels,
		} satisfies UserPreferencesResponse;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
```

This keeps base channels visible, shows Telegram only for the active organization when configured, and keeps Teams, Discord, and Slack unavailable by default until tenant settings pages exist.

- [ ] **Step 3: Confirm no secrets are exposed**

Inspect the added return value and confirm it only contains booleans:

```ts
availableChannels: Record<NotificationChannel, boolean>
```

Do not return Telegram bot usernames, tokens, webhook secrets, or any other tenant configuration values from this action.

### Task 3: Expose Availability From The Client Hook

**Files:**
- Modify: `apps/webapp/src/hooks/use-notification-preferences.ts:125-136`

- [ ] **Step 1: Add a safe default availability record**

Add this constant above `export function useNotificationPreferences()`:

```ts
const DEFAULT_AVAILABLE_CHANNELS: UserPreferencesResponse["availableChannels"] = {
	in_app: true,
	push: true,
	email: true,
	teams: false,
	telegram: false,
	discord: false,
	slack: false,
};
```

- [ ] **Step 2: Return `availableChannels` from the hook**

Update the return object from:

```ts
return {
	preferences: data?.preferences ?? [],
	matrix: data?.matrix ?? null,
	isLoading,
	error,
	updatePreference: updatePreference.mutate,
	updatePreferenceAsync: updatePreference.mutateAsync,
	isUpdating: updatePreference.isPending,
	bulkUpdatePreferences: bulkUpdate.mutate,
	bulkUpdatePreferencesAsync: bulkUpdate.mutateAsync,
	isBulkUpdating: bulkUpdate.isPending,
};
```

to:

```ts
return {
	preferences: data?.preferences ?? [],
	matrix: data?.matrix ?? null,
	availableChannels: data?.availableChannels ?? DEFAULT_AVAILABLE_CHANNELS,
	isLoading,
	error,
	updatePreference: updatePreference.mutate,
	updatePreferenceAsync: updatePreference.mutateAsync,
	isUpdating: updatePreference.isPending,
	bulkUpdatePreferences: bulkUpdate.mutate,
	bulkUpdatePreferencesAsync: bulkUpdate.mutateAsync,
	isBulkUpdating: bulkUpdate.isPending,
};
```

### Task 4: Render Only Available Channels And Preserve Mobile Wrapping

**Files:**
- Modify: `apps/webapp/src/components/notifications/notification-settings.tsx:199-435`

- [ ] **Step 1: Destructure channel availability**

Change:

```tsx
const { matrix, isLoading, updatePreference, isUpdating } = useNotificationPreferences();
```

to:

```tsx
const { matrix, availableChannels, isLoading, updatePreference, isUpdating } =
	useNotificationPreferences();
```

- [ ] **Step 2: Add visible channel filtering**

After the `usePushNotifications` call and before `useState`, add:

```tsx
const visibleChannels = NOTIFICATION_CHANNELS.filter((channel) => availableChannels[channel]);
```

- [ ] **Step 3: Update the channel legend to use visible channels**

Change:

```tsx
{NOTIFICATION_CHANNELS.map((channel) => {
```

to:

```tsx
{visibleChannels.map((channel) => {
```

- [ ] **Step 4: Update notification rows to stack and wrap on mobile**

Change the row wrapper from:

```tsx
<div
	key={type}
	className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
>
```

to:

```tsx
<div
	key={type}
	className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between"
>
```

- [ ] **Step 5: Update the switch container to wrap visible channels only**

Change:

```tsx
<div className="flex items-center gap-3">
	{NOTIFICATION_CHANNELS.map((channel) => {
```

to:

```tsx
<div className="flex max-w-full flex-wrap items-center gap-3">
	{visibleChannels.map((channel) => {
```

The full edited block should look like this:

```tsx
{category.types.map((type) => (
	<div
		key={type}
		className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between"
	>
		<span className="text-sm font-medium">{TYPE_LABELS[type]}</span>
		<div className="flex max-w-full flex-wrap items-center gap-3">
			{visibleChannels.map((channel) => {
				const isEnabled = matrix[type]?.[channel] ?? true;
				const toggleId = `${type}-${channel}`;
				const isPending = pendingToggle === toggleId;
				const config = CHANNEL_CONFIG[channel];

				// Disable push toggle if not subscribed
				const isDisabled =
					isPending ||
					isUpdating ||
					(channel === "push" && !isPushSubscribed && !isPushSupported);

				return (
					<div
						key={channel}
						className="flex items-center gap-1.5"
						title={config.description}
					>
						<config.icon
							className="size-3.5 text-muted-foreground"
							aria-hidden="true"
						/>
						<Switch
							checked={isEnabled}
							onCheckedChange={(checked) => handleToggle(type, channel, checked)}
							disabled={isDisabled}
							aria-label={`${config.label} notifications for ${TYPE_LABELS[type]}`}
							className="data-[state=checked]:bg-primary"
						/>
					</div>
				);
			})}
		</div>
	</div>
))}
```

### Task 5: Validate Formatting, Behavior, And Security Scope

**Files:**
- Modify: `apps/webapp/src/lib/notifications/types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts`
- Modify: `apps/webapp/src/hooks/use-notification-preferences.ts`
- Modify: `apps/webapp/src/components/notifications/notification-settings.tsx`

- [ ] **Step 1: Run formatting check for touched files**

Run from repository root:

```bash
pnpm prettier --check apps/webapp/src/lib/notifications/types.ts apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts apps/webapp/src/hooks/use-notification-preferences.ts apps/webapp/src/components/notifications/notification-settings.tsx
```

Expected: the command exits successfully. If it reports formatting issues, run:

```bash
pnpm prettier --write apps/webapp/src/lib/notifications/types.ts apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts apps/webapp/src/hooks/use-notification-preferences.ts apps/webapp/src/components/notifications/notification-settings.tsx
```

Then rerun the check command and expect success.

- [ ] **Step 2: Run notification-related tests**

Run from repository root:

```bash
pnpm test -- notification
```

Expected: matching notification-related tests pass. If failures are unrelated to the touched files, record them in the final response instead of broadening this change.

- [ ] **Step 3: Manually verify channel visibility rules**

Inspect the implementation and confirm the response builds this exact availability shape:

```ts
const availableChannels: Record<NotificationChannel, boolean> = {
	in_app: true,
	push: true,
	email: true,
	teams: false,
	telegram: Boolean(telegramConfig),
	discord: false,
	slack: false,
};
```

Confirm `NotificationSettings` maps `visibleChannels`, not `NOTIFICATION_CHANNELS`, for both the legend and row switches.

- [ ] **Step 4: Manually verify responsive class behavior**

Inspect `apps/webapp/src/components/notifications/notification-settings.tsx` and confirm:

```tsx
className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between"
```

is present on each notification type row, and:

```tsx
className="flex max-w-full flex-wrap items-center gap-3"
```

is present on the switch container.

This confirms mobile can wrap the controls and desktop keeps the previous horizontal arrangement.

- [ ] **Step 5: Security review the tenant boundary**

Confirm these statements are true before completion:

```txt
No external channel secrets are returned to the client.
Telegram availability is derived from the active organization only.
Slack, Teams, and Discord remain false because there is no tenant settings page for configuring them yet.
No environment variables are added for tenant-specific channel settings.
```

- [ ] **Step 6: Commit only if the user explicitly requests a commit**

Do not commit by default. If requested, stage only the implementation file and relevant plan/spec files intentionally requested by the user:

```bash
git add apps/webapp/src/lib/notifications/types.ts apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts apps/webapp/src/hooks/use-notification-preferences.ts apps/webapp/src/components/notifications/notification-settings.tsx docs/superpowers/specs/2026-05-03-notifications-mobile-switch-layout-design.md docs/superpowers/plans/2026-05-03-notifications-mobile-switch-layout.md
git commit -m "fix notifications mobile switch layout"
```
