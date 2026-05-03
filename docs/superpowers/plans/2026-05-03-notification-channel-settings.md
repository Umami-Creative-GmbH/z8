# Notification Channel Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add organization-admin notification channel settings for Telegram, Slack, Discord, and Teams while keeping `/settings/notifications` focused on user notification preferences.

**Architecture:** Settings navigation gets a new `notifications` group that contains the member preference page and org-admin channel setup pages. Channel availability is computed server-side from existing organization-scoped integration helpers, with `in_app`, `push`, and `email` always available. Slack, Discord, and Teams use a small shared admin settings component plus channel-specific server actions that update the existing integration tables.

**Tech Stack:** Next.js App Router, React, TanStack Query, Drizzle ORM, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts` computes availability for all configured third-party channels.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.test.ts` verifies baseline channels stay available and third-party availability follows org config.
- Modify: `apps/webapp/src/components/notifications/notification-settings.tsx` keeps baseline switches visible and treats push permission as browser capability, not org availability.
- Modify: `apps/webapp/src/components/notifications/notification-settings.test.tsx` verifies baseline, configured, and unconfigured channel rendering.
- Modify: `apps/webapp/src/components/settings/settings-config.ts` adds the `notifications` group and moves/adds notification entries.
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts` verifies the new group and admin-only entries.
- Modify: `apps/webapp/src/lib/settings-access.ts` adds Slack, Discord, and Teams notification settings routes to org-admin-only access.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts` verifies route access and route list alignment.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/notification-channels/actions.ts` contains shared channel action types plus Slack, Discord, and Teams read/update actions.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/notification-channels/actions.test.ts` verifies org-admin guards and scoped updates.
- Create: `apps/webapp/src/components/settings/notification-channel-settings.tsx` renders shared status and feature settings for Slack, Discord, and Teams.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/slack/page.tsx` renders Slack admin settings.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/discord/page.tsx` renders Discord admin settings.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/teams-notifications/page.tsx` renders Teams notification admin settings.

### Task 1: Channel Availability

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.test.ts`

- [ ] **Step 1: Write failing availability tests**

Add imports and mocks in `apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.test.ts`:

```ts
vi.mock("@/lib/teams", () => ({
	isTeamsEnabledForOrganization: vi.fn(async () => false),
}));

vi.mock("@/lib/discord", () => ({
	isDiscordEnabledForOrganization: vi.fn(async () => false),
}));

vi.mock("@/lib/slack", () => ({
	isSlackEnabledForOrganization: vi.fn(async () => false),
}));

const { isTelegramEnabledForOrganization } = await import("@/lib/telegram");
const { isTeamsEnabledForOrganization } = await import("@/lib/teams");
const { isDiscordEnabledForOrganization } = await import("@/lib/discord");
const { isSlackEnabledForOrganization } = await import("@/lib/slack");
const { getNotificationPreferences, updateNotificationPreference } = await import("./actions");
```

Replace the existing dynamic import line that imports only `updateNotificationPreference` with the combined import above.

Add these tests inside `describe("notification settings actions", () => { ... })`:

```ts
it("keeps baseline channels available when no organization channels are configured", async () => {
	vi.mocked(isTelegramEnabledForOrganization).mockResolvedValue(false);
	vi.mocked(isTeamsEnabledForOrganization).mockResolvedValue(false);
	vi.mocked(isDiscordEnabledForOrganization).mockResolvedValue(false);
	vi.mocked(isSlackEnabledForOrganization).mockResolvedValue(false);

	const result = await getNotificationPreferences();

	expect(result).toMatchObject({
		success: true,
		data: {
			availableChannels: {
				in_app: true,
				push: true,
				email: true,
				teams: false,
				telegram: false,
				discord: false,
				slack: false,
			},
		},
	});
});

it("marks configured organization channels as available", async () => {
	vi.mocked(isTelegramEnabledForOrganization).mockResolvedValue(true);
	vi.mocked(isTeamsEnabledForOrganization).mockResolvedValue(true);
	vi.mocked(isDiscordEnabledForOrganization).mockResolvedValue(true);
	vi.mocked(isSlackEnabledForOrganization).mockResolvedValue(true);

	const result = await getNotificationPreferences();

	expect(result).toMatchObject({
		success: true,
		data: {
			availableChannels: {
				in_app: true,
				push: true,
				email: true,
				teams: true,
				telegram: true,
				discord: true,
				slack: true,
			},
		},
	});
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.test.ts`

Expected: tests fail because `getNotificationPreferences` does not call Teams, Discord, or Slack availability helpers yet.

- [ ] **Step 3: Implement availability checks**

Modify `apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts` imports:

```ts
import { isDiscordEnabledForOrganization } from "@/lib/discord";
import { isSlackEnabledForOrganization } from "@/lib/slack";
import { isTeamsEnabledForOrganization } from "@/lib/teams";
import { isTelegramEnabledForOrganization } from "@/lib/telegram";
```

Replace the current `isTelegramAvailable` block with:

```ts
		const [isTeamsAvailable, isTelegramAvailable, isDiscordAvailable, isSlackAvailable] =
			organizationId
				? yield* _(
						dbService.query("getNotificationPreferencesChannelAvailability", async () => {
							return Promise.all([
								isTeamsEnabledForOrganization(organizationId),
								isTelegramEnabledForOrganization(organizationId),
								isDiscordEnabledForOrganization(organizationId),
								isSlackEnabledForOrganization(organizationId),
							]);
						}),
					)
				: [false, false, false, false];

		const availableChannels: Record<NotificationChannel, boolean> = {
			in_app: true,
			push: true,
			email: true,
			teams: isTeamsAvailable,
			telegram: isTelegramAvailable,
			discord: isDiscordAvailable,
			slack: isSlackAvailable,
		};
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.test.ts`

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.ts" "apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.test.ts"
git commit -m "fix: resolve notification channel availability"
```

### Task 2: Preference Matrix Channel Rendering

**Files:**
- Modify: `apps/webapp/src/components/notifications/notification-settings.tsx`
- Modify: `apps/webapp/src/components/notifications/notification-settings.test.tsx`

- [ ] **Step 1: Add component tests for baseline and configured channels**

Add this helper near the existing `matrix` constant in `notification-settings.test.tsx`:

```ts
function mockNotificationPreferences(
	availableChannels: Record<NotificationChannel, boolean>,
) {
	useNotificationPreferencesMock.mockReturnValue({
		preferences: [],
		matrix,
		availableChannels,
		isLoading: false,
		error: null,
		updatePreference: vi.fn(),
		updatePreferenceAsync: vi.fn(),
		isUpdating: false,
		bulkUpdatePreferences: vi.fn(),
		bulkUpdatePreferencesAsync: vi.fn(),
		isBulkUpdating: false,
	});
}
```

Replace the `useNotificationPreferencesMock.mockReturnValue({ ... })` in `beforeEach` with:

```ts
		mockNotificationPreferences({
			in_app: true,
			push: true,
			email: true,
			teams: false,
			telegram: false,
			discord: false,
			slack: false,
		});
```

Add tests:

```ts
it("always renders baseline channel switches", () => {
	mockNotificationPreferences({
		in_app: true,
		push: true,
		email: true,
		teams: false,
		telegram: false,
		discord: false,
		slack: false,
	});

	render(<NotificationSettings />);

	expect(screen.getByLabelText("In-App notifications for Request submitted")).toBeTruthy();
	expect(screen.getByLabelText("Push notifications for Request submitted")).toBeTruthy();
	expect(screen.getByLabelText("Email notifications for Request submitted")).toBeTruthy();
});

it("renders configured third-party channel switches", () => {
	mockNotificationPreferences({
		in_app: true,
		push: true,
		email: true,
		teams: true,
		telegram: true,
		discord: true,
		slack: true,
	});

	render(<NotificationSettings />);

	expect(screen.getByLabelText("Teams notifications for Request submitted")).toBeTruthy();
	expect(screen.getByLabelText("Telegram notifications for Request submitted")).toBeTruthy();
	expect(screen.getByLabelText("Discord notifications for Request submitted")).toBeTruthy();
	expect(screen.getByLabelText("Slack notifications for Request submitted")).toBeTruthy();
});

it("keeps push switch enabled when browser push is supported but not subscribed", () => {
	usePushNotificationsMock.mockReturnValue({
		isSupported: true,
		permission: "default",
		isSubscribed: false,
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
		isLoading: false,
		error: null,
	});

	render(<NotificationSettings />);

	expect(screen.getByLabelText("Push notifications for Request submitted")).not.toBeDisabled();
});
```

- [ ] **Step 2: Run the failing/passing tests**

Run: `pnpm --filter webapp test apps/webapp/src/components/notifications/notification-settings.test.tsx`

Expected: the push enabled test fails if the switch is disabled due to subscription state.

- [ ] **Step 3: Keep baseline switches visible and push usable**

In `notification-settings.tsx`, keep `visibleChannels` derived from `availableChannels`:

```ts
	const visibleChannels = NOTIFICATION_CHANNELS.filter((channel) => availableChannels[channel]);
```

Replace the disabled calculation with:

```ts
											const isDisabled =
												isPending ||
												isUpdating ||
												(channel === "push" && !isPushSupported);
```

- [ ] **Step 4: Run the component tests**

Run: `pnpm --filter webapp test apps/webapp/src/components/notifications/notification-settings.test.tsx`

Expected: all notification settings component tests pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/webapp/src/components/notifications/notification-settings.tsx" "apps/webapp/src/components/notifications/notification-settings.test.tsx"
git commit -m "fix: keep baseline notification switches available"
```

### Task 3: Settings Navigation And Route Access

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`
- Modify: `apps/webapp/src/lib/settings-access.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

- [ ] **Step 1: Write navigation and route-access tests**

In `settings-config.test.ts`, update the member visible IDs expectation to:

```ts
	expect(entries.map((entry) => entry.id)).toEqual([
		"profile",
		"security",
		"notifications",
		"wellness",
	]);
```

Add this test:

```ts
it("groups notification preferences and channel configuration together", () => {
	const entries = getVisibleSettings("orgAdmin", true);
	const notificationEntries = entries.filter((entry) => entry.group === "notifications");

	expect(notificationEntries.map((entry) => entry.id)).toEqual([
		"notifications",
		"telegram",
		"slack",
		"discord",
		"teams-notifications",
	]);
	expect(notificationEntries.find((entry) => entry.id === "notifications")).toMatchObject({
		minimumTier: "member",
		href: "/settings/notifications",
	});
	expect(notificationEntries.find((entry) => entry.id === "telegram")).toMatchObject({
		minimumTier: "orgAdmin",
		href: "/settings/telegram",
	});
});
```

Update the group expectation in `derives visible groups from the remaining visible entries` to include `notifications` after `account`:

```ts
	expect(groups.map((group) => group.id)).toEqual([
		"account",
		"notifications",
		"organization",
		"administration",
		"enterprise",
		"data",
	]);
```

In `settings-route-access.test.ts`, add route files to `ORG_ADMIN_ROUTE_FILES`:

```ts
	"slack/page.tsx",
	"discord/page.tsx",
	"teams-notifications/page.tsx",
```

Update the route list expectation to include:

```ts
			"/settings/slack",
			"/settings/discord",
			"/settings/teams-notifications",
```

Add manager access assertions:

```ts
		expect(canResolvedTierAccessRoute(managerTier, "/settings/slack")).toBe(false);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/discord")).toBe(false);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/teams-notifications")).toBe(false);
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm --filter webapp test apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

Expected: tests fail because the new group, entries, and route access list are not implemented.

- [ ] **Step 3: Implement settings group and entries**

In `settings-config.ts`, add `"notifications"` to `SettingsGroup`:

```ts
export type SettingsGroup =
	| "account"
	| "notifications"
	| "organization"
	| "administration"
	| "enterprise"
	| "data";
```

Add icons to `SettingsIconName`:

```ts
	| "brand-discord"
	| "brand-slack"
	| "brand-teams"
```

Add the group after `account` in `SETTINGS_GROUPS`:

```ts
	{
		id: "notifications",
		labelKey: "settings.group.notifications",
		labelDefault: "Notifications",
	},
```

Move the existing `notifications` entry to `group: "notifications"`.

Move Telegram to `group: "notifications"` and keep `minimumTier: "orgAdmin"`.

Add these entries after Telegram:

```ts
	{
		id: "slack",
		titleKey: "settings.slack.title",
		titleDefault: "Slack",
		descriptionKey: "settings.slack.description",
		descriptionDefault: "Configure Slack notifications for your organization",
		href: "/settings/slack",
		icon: "brand-slack",
		minimumTier: "orgAdmin",
		group: "notifications",
	},
	{
		id: "discord",
		titleKey: "settings.discord.title",
		titleDefault: "Discord",
		descriptionKey: "settings.discord.description",
		descriptionDefault: "Configure Discord notifications for your organization",
		href: "/settings/discord",
		icon: "brand-discord",
		minimumTier: "orgAdmin",
		group: "notifications",
	},
	{
		id: "teams-notifications",
		titleKey: "settings.teamsNotifications.title",
		titleDefault: "Microsoft Teams",
		descriptionKey: "settings.teamsNotifications.description",
		descriptionDefault: "Configure Microsoft Teams notifications for your organization",
		href: "/settings/teams-notifications",
		icon: "brand-teams",
		minimumTier: "orgAdmin",
		group: "notifications",
	},
```

- [ ] **Step 4: Add org-admin route access**

In `settings-access.ts`, add routes after `/settings/telegram`:

```ts
	"/settings/slack",
	"/settings/discord",
	"/settings/teams-notifications",
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter webapp test apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

Expected: settings config tests pass; route access tests may still fail because route files do not exist yet. That failure is resolved in Task 5.

- [ ] **Step 6: Commit**

```bash
git add "apps/webapp/src/components/settings/settings-config.ts" "apps/webapp/src/components/settings/settings-config.test.ts" "apps/webapp/src/lib/settings-access.ts" "apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts"
git commit -m "feat: add notification settings group"
```

### Task 4: Shared Channel Admin Actions

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/notification-channels/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/notification-channels/actions.test.ts`

- [ ] **Step 1: Write action tests**

Create `actions.test.ts` with mocks for `requireOrgAdminSettingsAccess`, `db`, and `revalidatePath`. The core tests should call `updateSlackNotificationChannelSettings`, `updateDiscordNotificationChannelSettings`, and `updateTeamsNotificationChannelSettings` with this payload:

```ts
const settings = {
	enableApprovals: true,
	enableCommands: false,
	enableDailyDigest: true,
	enableEscalations: false,
	digestTime: "09:30",
	digestTimezone: "Europe/Berlin",
	escalationTimeoutHours: 12,
};
```

Each test asserts the relevant table update uses the authenticated `organizationId` returned by `requireOrgAdminSettingsAccess`, not a caller-provided organization ID. Add one validation test that passes `digestTime: "9:30"` and expects `{ success: false, error: "Digest time must use HH:mm format" }`.

- [ ] **Step 2: Run failing action tests**

Run: `pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/settings/notification-channels/actions.test.ts`

Expected: fails because the actions file does not exist.

- [ ] **Step 3: Implement shared actions**

Create `actions.ts` with:

```ts
"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { discordBotConfig, slackWorkspaceConfig, teamsTenantConfig } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export interface NotificationChannelSettingsFormValues {
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

export interface NotificationChannelConfig {
	setupStatus: string;
	displayName: string | null;
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

type ActionResult<T = void> =
	| { success: true; data: T }
	| { success: false; error: string };

function validateSettings(settings: NotificationChannelSettingsFormValues): string | null {
	if (!/^\d{2}:\d{2}$/.test(settings.digestTime)) return "Digest time must use HH:mm format";
	if (!settings.digestTimezone.trim()) return "Digest timezone is required";
	if (!Number.isInteger(settings.escalationTimeoutHours) || settings.escalationTimeoutHours < 1) {
		return "Escalation timeout must be at least 1 hour";
	}
	return null;
}

export async function getSlackNotificationChannelConfig(): Promise<ActionResult<NotificationChannelConfig | null>> {
	try {
		const { organizationId } = await requireOrgAdminSettingsAccess();
		const config = await db.query.slackWorkspaceConfig.findFirst({
			where: eq(slackWorkspaceConfig.organizationId, organizationId),
		});
		return {
			success: true,
			data: config
				? {
						setupStatus: config.setupStatus,
						displayName: config.slackTeamName,
						enableApprovals: config.enableApprovals,
						enableCommands: config.enableCommands,
						enableDailyDigest: config.enableDailyDigest,
						enableEscalations: config.enableEscalations,
						digestTime: config.digestTime,
						digestTimezone: config.digestTimezone,
						escalationTimeoutHours: config.escalationTimeoutHours,
					}
				: null,
		};
	} catch {
		return { success: false, error: "Failed to fetch Slack notification settings" };
	}
}

export async function getDiscordNotificationChannelConfig(): Promise<ActionResult<NotificationChannelConfig | null>> {
	try {
		const { organizationId } = await requireOrgAdminSettingsAccess();
		const config = await db.query.discordBotConfig.findFirst({
			where: eq(discordBotConfig.organizationId, organizationId),
		});
		return {
			success: true,
			data: config
				? {
						setupStatus: config.setupStatus,
						displayName: config.applicationId,
						enableApprovals: config.enableApprovals,
						enableCommands: config.enableCommands,
						enableDailyDigest: config.enableDailyDigest,
						enableEscalations: config.enableEscalations,
						digestTime: config.digestTime,
						digestTimezone: config.digestTimezone,
						escalationTimeoutHours: config.escalationTimeoutHours,
					}
				: null,
		};
	} catch {
		return { success: false, error: "Failed to fetch Discord notification settings" };
	}
}

export async function getTeamsNotificationChannelConfig(): Promise<ActionResult<NotificationChannelConfig | null>> {
	try {
		const { organizationId } = await requireOrgAdminSettingsAccess();
		const config = await db.query.teamsTenantConfig.findFirst({
			where: eq(teamsTenantConfig.organizationId, organizationId),
		});
		return {
			success: true,
			data: config
				? {
						setupStatus: config.setupStatus,
						displayName: config.tenantName,
						enableApprovals: config.enableApprovals,
						enableCommands: config.enableCommands,
						enableDailyDigest: config.enableDailyDigest,
						enableEscalations: config.enableEscalations,
						digestTime: config.digestTime,
						digestTimezone: config.digestTimezone,
						escalationTimeoutHours: config.escalationTimeoutHours,
					}
				: null,
		};
	} catch {
		return { success: false, error: "Failed to fetch Teams notification settings" };
	}
}
```

Add update actions in the same file:

```ts
async function updateChannelSettings(
	settings: NotificationChannelSettingsFormValues,
	table: typeof slackWorkspaceConfig | typeof discordBotConfig | typeof teamsTenantConfig,
	path: string,
): Promise<ActionResult> {
	try {
		const validationError = validateSettings(settings);
		if (validationError) return { success: false, error: validationError };

		const { organizationId } = await requireOrgAdminSettingsAccess();
		await db
			.update(table)
			.set({
				enableApprovals: settings.enableApprovals,
				enableCommands: settings.enableCommands,
				enableDailyDigest: settings.enableDailyDigest,
				enableEscalations: settings.enableEscalations,
				digestTime: settings.digestTime,
				digestTimezone: settings.digestTimezone,
				escalationTimeoutHours: settings.escalationTimeoutHours,
			})
			.where(eq(table.organizationId, organizationId));
		revalidatePath(path);
		return { success: true, data: undefined };
	} catch {
		return { success: false, error: "Failed to update notification channel settings" };
	}
}

export function updateSlackNotificationChannelSettings(settings: NotificationChannelSettingsFormValues) {
	return updateChannelSettings(settings, slackWorkspaceConfig, "/settings/slack");
}

export function updateDiscordNotificationChannelSettings(settings: NotificationChannelSettingsFormValues) {
	return updateChannelSettings(settings, discordBotConfig, "/settings/discord");
}

export function updateTeamsNotificationChannelSettings(settings: NotificationChannelSettingsFormValues) {
	return updateChannelSettings(settings, teamsTenantConfig, "/settings/teams-notifications");
}
```

- [ ] **Step 4: Run action tests**

Run: `pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/settings/notification-channels/actions.test.ts`

Expected: all notification channel action tests pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/settings/notification-channels/actions.ts" "apps/webapp/src/app/[locale]/(app)/settings/notification-channels/actions.test.ts"
git commit -m "feat: add notification channel admin actions"
```

### Task 5: Shared Channel Admin UI And Pages

**Files:**
- Create: `apps/webapp/src/components/settings/notification-channel-settings.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/slack/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/discord/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/teams-notifications/page.tsx`

- [ ] **Step 1: Create shared component**

Create `notification-channel-settings.tsx`:

```tsx
"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { toast } from "sonner";
import type {
	NotificationChannelConfig,
	NotificationChannelSettingsFormValues,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimeInput } from "@/components/ui/time-input";

interface NotificationChannelSettingsProps {
	channelName: string;
	description: string;
	config: NotificationChannelConfig | null;
	onUpdate: (settings: NotificationChannelSettingsFormValues) => Promise<{ success: true; data: void } | { success: false; error: string }>;
}

export function NotificationChannelSettings({
	channelName,
	description,
	config,
	onUpdate,
}: NotificationChannelSettingsProps) {
	const updateMutation = useMutation({
		mutationFn: onUpdate,
		onSuccess: (result) => {
			if (result.success) toast.success(`${channelName} settings updated`);
			else toast.error(result.error);
		},
		onError: () => toast.error(`Failed to update ${channelName} settings`),
	});

	const form = useForm({
		defaultValues: {
			enableApprovals: config?.enableApprovals ?? true,
			enableCommands: config?.enableCommands ?? true,
			enableDailyDigest: config?.enableDailyDigest ?? true,
			enableEscalations: config?.enableEscalations ?? true,
			digestTime: config?.digestTime ?? "08:00",
			digestTimezone: config?.digestTimezone ?? "UTC",
			escalationTimeoutHours: config?.escalationTimeoutHours ?? 24,
		} satisfies NotificationChannelSettingsFormValues,
		onSubmit: ({ value }) => updateMutation.mutateAsync(value),
	});

	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
	const isActive = config?.setupStatus === "active";

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>{channelName}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent className="flex items-center justify-between gap-4 rounded-lg border p-4">
					<div>
						<p className="font-medium">{config?.displayName ?? `${channelName} is not connected`}</p>
						<p className="text-sm text-muted-foreground">
							{isActive ? "Notifications can be delivered through this channel." : "Connect this integration before users can enable it in notification preferences."}
						</p>
					</div>
					<Badge variant={isActive ? "default" : "outline"}>{config?.setupStatus ?? "not configured"}</Badge>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Channel Features</CardTitle>
					<CardDescription>Control which organization notification workflows use {channelName}.</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							form.handleSubmit();
						}}
						className="space-y-5"
					>
						<form.Field name="enableApprovals">
							{(field) => (
								<div className="flex items-center justify-between gap-4">
									<Label htmlFor={field.name}>Approval notifications</Label>
									<Switch id={field.name} checked={field.state.value} onCheckedChange={field.handleChange} disabled={!config} />
								</div>
							)}
						</form.Field>
						<form.Field name="enableCommands">
							{(field) => (
								<div className="flex items-center justify-between gap-4">
									<Label htmlFor={field.name}>Commands</Label>
									<Switch id={field.name} checked={field.state.value} onCheckedChange={field.handleChange} disabled={!config} />
								</div>
							)}
						</form.Field>
						<form.Field name="enableDailyDigest">
							{(field) => (
								<div className="flex items-center justify-between gap-4">
									<Label htmlFor={field.name}>Daily digest</Label>
									<Switch id={field.name} checked={field.state.value} onCheckedChange={field.handleChange} disabled={!config} />
								</div>
							)}
						</form.Field>
						<form.Field name="enableEscalations">
							{(field) => (
								<div className="flex items-center justify-between gap-4">
									<Label htmlFor={field.name}>Escalations</Label>
									<Switch id={field.name} checked={field.state.value} onCheckedChange={field.handleChange} disabled={!config} />
								</div>
							)}
						</form.Field>
						<div className="grid gap-4 sm:grid-cols-3">
							<form.Field name="digestTime">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={field.name}>Digest time</Label>
										<TimeInput id={field.name} value={field.state.value} onChange={field.handleChange} disabled={!config} />
									</div>
								)}
							</form.Field>
							<form.Field name="digestTimezone">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={field.name}>Timezone</Label>
										<Input id={field.name} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} disabled={!config} />
									</div>
								)}
							</form.Field>
							<form.Field name="escalationTimeoutHours">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={field.name}>Escalation hours</Label>
										<Input id={field.name} type="number" min={1} value={field.state.value} onChange={(event) => field.handleChange(Number(event.target.value))} disabled={!config} />
									</div>
								)}
							</form.Field>
						</div>
						<Button type="submit" disabled={!config || isSubmitting || updateMutation.isPending}>
							{(isSubmitting || updateMutation.isPending) && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
							Save settings
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 2: Create Slack page**

Create `apps/webapp/src/app/[locale]/(app)/settings/slack/page.tsx`:

```tsx
import {
	getSlackNotificationChannelConfig,
	updateSlackNotificationChannelSettings,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export default async function SlackNotificationSettingsPage() {
	await requireOrgAdminSettingsAccess();
	const result = await getSlackNotificationChannelConfig();
	const config = result.success ? result.data : null;

	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">Slack</h1>
					<p className="text-muted-foreground">Configure Slack notifications for your organization.</p>
				</div>
				<NotificationChannelSettings
					channelName="Slack"
					description="Manage Slack notification delivery and workflow features."
					config={config}
					onUpdate={updateSlackNotificationChannelSettings}
				/>
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Create Discord page**

Create `apps/webapp/src/app/[locale]/(app)/settings/discord/page.tsx`:

```tsx
import {
	getDiscordNotificationChannelConfig,
	updateDiscordNotificationChannelSettings,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export default async function DiscordNotificationSettingsPage() {
	await requireOrgAdminSettingsAccess();
	const result = await getDiscordNotificationChannelConfig();
	const config = result.success ? result.data : null;

	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">Discord</h1>
					<p className="text-muted-foreground">Configure Discord notifications for your organization.</p>
				</div>
				<NotificationChannelSettings
					channelName="Discord"
					description="Manage Discord notification delivery and workflow features."
					config={config}
					onUpdate={updateDiscordNotificationChannelSettings}
				/>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Create Teams notification page**

Create `apps/webapp/src/app/[locale]/(app)/settings/teams-notifications/page.tsx`:

```tsx
import {
	getTeamsNotificationChannelConfig,
	updateTeamsNotificationChannelSettings,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export default async function TeamsNotificationSettingsPage() {
	await requireOrgAdminSettingsAccess();
	const result = await getTeamsNotificationChannelConfig();
	const config = result.success ? result.data : null;

	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">Microsoft Teams</h1>
					<p className="text-muted-foreground">Configure Microsoft Teams notifications for your organization.</p>
				</div>
				<NotificationChannelSettings
					channelName="Microsoft Teams"
					description="Manage Teams notification delivery and workflow features."
					config={config}
					onUpdate={updateTeamsNotificationChannelSettings}
				/>
			</div>
		</div>
	);
}
```

- [ ] **Step 5: Run route access tests**

Run: `pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

Expected: route access tests pass because route files exist and are guarded by `requireOrgAdminSettingsAccess`.

- [ ] **Step 6: Commit**

```bash
git add "apps/webapp/src/components/settings/notification-channel-settings.tsx" "apps/webapp/src/app/[locale]/(app)/settings/slack/page.tsx" "apps/webapp/src/app/[locale]/(app)/settings/discord/page.tsx" "apps/webapp/src/app/[locale]/(app)/settings/teams-notifications/page.tsx"
git commit -m "feat: add notification channel settings pages"
```

### Task 6: Final Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/settings/notifications/actions.test.ts apps/webapp/src/components/notifications/notification-settings.test.tsx apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/app/[locale]/(app)/settings/notification-channels/actions.test.ts`

Expected: all focused tests pass.

- [ ] **Step 2: Run lint/type verification used by this repo**

Run: `pnpm --filter webapp build`

Expected: build completes without TypeScript or Next.js errors. If the build requires unavailable system secrets, stop the build and report the skipped verification with the missing environment variables.

- [ ] **Step 3: Review final diff**

Run: `git diff --stat` and `git diff --check`

Expected: diff only includes notification channel settings changes; `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Commit final fixes if needed**

If verification required small fixes, commit them:

```bash
git add "apps/webapp/src/app/[locale]/(app)/settings" "apps/webapp/src/components/notifications" "apps/webapp/src/components/settings" "apps/webapp/src/lib/settings-access.ts"
git commit -m "test: verify notification channel settings"
```

If no files changed after verification, do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers the new settings group, Telegram relocation, new Slack/Discord/Teams admin entries, org-admin access control, user-only preference switches, organization-scoped channel availability, baseline channel availability, and tests.
- Placeholder scan: The plan contains no red-flag placeholders and no references to undefined task outputs.
- Type consistency: `NotificationChannelSettingsFormValues`, `NotificationChannelConfig`, and update action names are defined in Task 4 before use in Task 5.
