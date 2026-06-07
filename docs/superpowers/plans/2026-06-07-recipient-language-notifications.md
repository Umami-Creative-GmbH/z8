# Recipient Language Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send outbound notifications in the recipient's persisted UI language, falling back to organization default language and then English.

**Architecture:** Add an application-owned organization notification settings table for the organization default language. Add a server-side notification localization layer that resolves recipient locale and renders `metadata.i18n` content outside a request context. Wire the shared renderer into Telegram and email first, leaving the same API available for push, Slack, Teams, and Discord.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, PostgreSQL migrations, Tolgee, Vitest, React, `@tabler/icons-react`, `pnpm`.

---

## File Structure

- Create: `apps/webapp/drizzle/0049_organization_notification_settings.sql`
  Adds the organization-scoped default language table.
- Create: `apps/webapp/src/db/schema/organization-notification-settings.ts`
  Drizzle schema for organization notification settings.
- Modify: `apps/webapp/src/db/schema/index.ts`
  Re-export the new schema file.
- Modify: `apps/webapp/src/db/schema/relations.ts`
  Add the organization one-to-one relation and the settings-to-organization relation.
- Create: `apps/webapp/src/lib/notifications/recipient-locale.ts`
  Resolves recipient notification locale using user settings, organization default language, then English.
- Create: `apps/webapp/src/lib/notifications/recipient-locale.test.ts`
  Unit tests for locale fallback behavior.
- Create: `apps/webapp/src/lib/notifications/outbound-localization.ts`
  Renders notification title/message from `metadata.i18n` for server-side outbound delivery.
- Create: `apps/webapp/src/lib/notifications/outbound-localization.test.ts`
  Unit tests for metadata rendering and safe fallback behavior.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`
  Load organization notification settings and pass default language into the organization tab.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
  Add owner/admin protected update action for organization default notification language.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts`
  Add authorization and validation tests for the update action.
- Modify: `apps/webapp/src/components/organization/organization-tab.tsx`
  Pass default notification language into the new settings card.
- Create: `apps/webapp/src/components/organization/organization-language-card.tsx`
  UI card for owners/admins to edit the organization default notification language.
- Create: `apps/webapp/src/components/organization/organization-language-card.test.tsx`
  Component tests for enabled/disabled behavior and action call.
- Modify: `apps/webapp/src/lib/notifications/telegram-channel.ts`
  Localize simple Telegram notification title/message before MarkdownV2 formatting.
- Create: `apps/webapp/src/lib/notifications/telegram-channel.test.ts`
  Integration-style test proving Telegram receives localized text.
- Modify: `apps/webapp/src/lib/notifications/email-notifications.ts`
  Resolve localized notification title/message and use localized subject fallback for email notifications.
- Modify: `apps/webapp/src/lib/notifications/email-notifications.test.ts`
  Prove email subject override can come from localized notification metadata.
- Modify: `apps/webapp/messages/organization/en.json`
  Add UI copy for the organization language card.
- Modify: `apps/webapp/messages/organization/de.json`
  Add German UI copy for the organization language card.
- Modify: `apps/webapp/messages/common/en.json`
  Ensure tested notification localization keys exist for outbound rendering.
- Modify: `apps/webapp/messages/common/de.json`
  Ensure tested notification localization keys exist for outbound rendering.

## Task 1: Organization Notification Settings Schema

**Files:**
- Create: `apps/webapp/drizzle/0049_organization_notification_settings.sql`
- Create: `apps/webapp/src/db/schema/organization-notification-settings.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`

- [ ] **Step 1: Add the migration**

Create `apps/webapp/drizzle/0049_organization_notification_settings.sql`:

```sql
CREATE TABLE IF NOT EXISTS "organization_notification_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "default_language" text DEFAULT 'en' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "organization_notification_settings_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade,
  CONSTRAINT "organization_notification_settings_organization_id_unique"
    UNIQUE ("organization_id")
);

CREATE INDEX IF NOT EXISTS "organizationNotificationSettings_organizationId_idx"
  ON "organization_notification_settings" ("organization_id");
```

- [ ] **Step 2: Add the Drizzle table**

Create `apps/webapp/src/db/schema/organization-notification-settings.ts`:

```ts
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization } from "../auth-schema";

export const organizationNotificationSettings = pgTable(
	"organization_notification_settings",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),
		defaultLanguage: text("default_language").default("en").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [index("organizationNotificationSettings_organizationId_idx").on(table.organizationId)],
);
```

- [ ] **Step 3: Re-export the schema**

Modify `apps/webapp/src/db/schema/index.ts` near the existing organization export:

```ts
export * from "./organization";
export * from "./organization-notification-settings";
```

- [ ] **Step 4: Add relations**

Modify `apps/webapp/src/db/schema/relations.ts`. Add this import near the other organization-scoped imports:

```ts
import { organizationNotificationSettings } from "./organization-notification-settings";
```

Add this field to `organizationRelations` near the existing notification relations:

```ts
notificationSettings: one(organizationNotificationSettings),
```

Add this relation block near the other organization-scoped settings relations:

```ts
export const organizationNotificationSettingsRelations = relations(
	organizationNotificationSettings,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationNotificationSettings.organizationId],
			references: [organization.id],
		}),
	}),
);
```

- [ ] **Step 5: Verify schema compiles**

Run: `pnpm --filter webapp test -- src/tolgee/shared.test.ts`

Expected: PASS. This is a fast TypeScript/Vitest smoke test that catches broken schema barrel imports during module loading.

- [ ] **Step 6: Commit if explicitly approved**

If the user has explicitly approved commits in the implementation session, run:

```bash
git add apps/webapp/drizzle/0049_organization_notification_settings.sql apps/webapp/src/db/schema/organization-notification-settings.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/relations.ts
git commit -m "feat: add organization notification settings"
```

Expected: commit succeeds. If commits are not approved, leave changes unstaged.

## Task 2: Recipient Locale Resolver

**Files:**
- Create: `apps/webapp/src/lib/notifications/recipient-locale.ts`
- Create: `apps/webapp/src/lib/notifications/recipient-locale.test.ts`

- [ ] **Step 1: Write the failing fallback tests**

Create `apps/webapp/src/lib/notifications/recipient-locale.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const userSettingsFindFirstMock = vi.fn();
const orgSettingsFindFirstMock = vi.fn();

vi.mock("@/db", () => ({
	db: {
		query: {
			userSettings: { findFirst: userSettingsFindFirstMock },
			organizationNotificationSettings: { findFirst: orgSettingsFindFirstMock },
		},
	},
}));

vi.mock("@/db/schema", () => ({
	userSettings: { userId: "userSettings.userId" },
	organizationNotificationSettings: {
		organizationId: "organizationNotificationSettings.organizationId",
	},
}));

describe("resolveRecipientNotificationLocale", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		userSettingsFindFirstMock.mockResolvedValue(null);
		orgSettingsFindFirstMock.mockResolvedValue(null);
	});

	it("uses the recipient's persisted UI locale first", async () => {
		userSettingsFindFirstMock.mockResolvedValue({ locale: "de" });
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });

		const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

		await expect(
			resolveRecipientNotificationLocale({ userId: "user-1", organizationId: "org-1" }),
		).resolves.toBe("de");
	});

	it("falls back to organization default language", async () => {
		userSettingsFindFirstMock.mockResolvedValue({ locale: null });
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "fr" });

		const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

		await expect(
			resolveRecipientNotificationLocale({ userId: "user-1", organizationId: "org-1" }),
		).resolves.toBe("fr");
	});

	it("falls back to English for missing or invalid values", async () => {
		userSettingsFindFirstMock.mockResolvedValue({ locale: "xx" });
		orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "yy" });

		const { resolveRecipientNotificationLocale } = await import("./recipient-locale");

		await expect(
			resolveRecipientNotificationLocale({ userId: "user-1", organizationId: "org-1" }),
		).resolves.toBe("en");
	});
});
```

- [ ] **Step 2: Run the resolver tests to verify failure**

Run: `pnpm --filter webapp test -- src/lib/notifications/recipient-locale.test.ts`

Expected: FAIL with an import error because `./recipient-locale` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `apps/webapp/src/lib/notifications/recipient-locale.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationNotificationSettings, userSettings } from "@/db/schema";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";

interface ResolveRecipientNotificationLocaleParams {
	userId: string;
	organizationId: string;
}

function isSupportedLanguage(value: string | null | undefined): value is string {
	return typeof value === "string" && ALL_LANGUAGES.includes(value);
}

export async function resolveRecipientNotificationLocale({
	userId,
	organizationId,
}: ResolveRecipientNotificationLocaleParams): Promise<string> {
	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { locale: true },
	});

	if (isSupportedLanguage(settings?.locale)) {
		return settings.locale;
	}

	const organizationSettings = await db.query.organizationNotificationSettings.findFirst({
		where: eq(organizationNotificationSettings.organizationId, organizationId),
		columns: { defaultLanguage: true },
	});

	if (isSupportedLanguage(organizationSettings?.defaultLanguage)) {
		return organizationSettings.defaultLanguage;
	}

	return DEFAULT_LANGUAGE;
}
```

- [ ] **Step 4: Run the resolver tests to verify pass**

Run: `pnpm --filter webapp test -- src/lib/notifications/recipient-locale.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit if explicitly approved**

If the user has explicitly approved commits in the implementation session, run:

```bash
git add apps/webapp/src/lib/notifications/recipient-locale.ts apps/webapp/src/lib/notifications/recipient-locale.test.ts
git commit -m "feat: resolve recipient notification locale"
```

Expected: commit succeeds. If commits are not approved, leave changes unstaged.

## Task 3: Outbound Notification Renderer

**Files:**
- Create: `apps/webapp/src/lib/notifications/outbound-localization.ts`
- Create: `apps/webapp/src/lib/notifications/outbound-localization.test.ts`

- [ ] **Step 1: Write the failing renderer tests**

Create `apps/webapp/src/lib/notifications/outbound-localization.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveLocaleMock = vi.fn();
const loadNamespacesMock = vi.fn();
const tolgeeTMock = vi.fn();
const tolgeeRunMock = vi.fn();

vi.mock("./recipient-locale", () => ({
	resolveRecipientNotificationLocale: resolveLocaleMock,
}));

vi.mock("@/tolgee/shared", () => ({
	ALL_LANGUAGES: ["en", "de", "fr", "es", "it", "pt", "el", "pl", "tr", "gsw"],
	DEFAULT_LANGUAGE: "en",
	ALL_NAMESPACES: ["common"],
	loadNamespaces: loadNamespacesMock,
	TolgeeBase: () => ({
		init: () => ({
			run: tolgeeRunMock,
			t: tolgeeTMock,
		}),
	}),
}));

describe("localizeOutboundNotification", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		resolveLocaleMock.mockResolvedValue("de");
		loadNamespacesMock.mockResolvedValue({ de: {} });
		tolgeeRunMock.mockResolvedValue(undefined);
		tolgeeTMock.mockImplementation(({ key, defaultValue, params }) => {
			if (key === "common:notifications.content.teamMemberAdded.title") {
				return "Zum Team hinzugefügt";
			}
			if (key === "common:notifications.content.teamMemberAdded.message") {
				return `Sie wurden zum Team ${params.teamName} hinzugefügt.`;
			}
			return defaultValue;
		});
	});

	it("renders notification title and message from i18n metadata", async () => {
		const { localizeOutboundNotification } = await import("./outbound-localization");

		const localized = await localizeOutboundNotification({
			userId: "user-1",
			organizationId: "org-1",
			title: "Added to team",
			message: "You were added to Operations.",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.teamMemberAdded.title",
					titleDefault: "Added to team",
					messageKey: "common:notifications.content.teamMemberAdded.message",
					messageDefault: "You were added to {teamName}.",
					params: { teamName: "Operations" },
				},
			},
		});

		expect(localized).toEqual({
			locale: "de",
			title: "Zum Team hinzugefügt",
			message: "Sie wurden zum Team Operations hinzugefügt.",
		});
	});

	it("falls back to stored text when metadata is missing", async () => {
		const { localizeOutboundNotification } = await import("./outbound-localization");

		await expect(
			localizeOutboundNotification({
				userId: "user-1",
				organizationId: "org-1",
				title: "Stored title",
				message: "Stored message",
			}),
		).resolves.toEqual({ locale: "de", title: "Stored title", message: "Stored message" });
	});

	it("falls back to stored text when translation loading fails", async () => {
		loadNamespacesMock.mockRejectedValue(new Error("load failed"));

		const { localizeOutboundNotification } = await import("./outbound-localization");

		await expect(
			localizeOutboundNotification({
				userId: "user-1",
				organizationId: "org-1",
				title: "Stored title",
				message: "Stored message",
				metadata: {
					i18n: {
						titleKey: "common:notifications.content.teamMemberAdded.title",
						messageKey: "common:notifications.content.teamMemberAdded.message",
					},
				},
			}),
		).resolves.toEqual({ locale: "de", title: "Stored title", message: "Stored message" });
	});
});
```

- [ ] **Step 2: Run the renderer tests to verify failure**

Run: `pnpm --filter webapp test -- src/lib/notifications/outbound-localization.test.ts`

Expected: FAIL with an import error because `./outbound-localization` does not exist.

- [ ] **Step 3: Implement the renderer**

Create `apps/webapp/src/lib/notifications/outbound-localization.ts`:

```ts
import { createLogger } from "@/lib/logger";
import { ALL_NAMESPACES, loadNamespaces, TolgeeBase } from "@/tolgee/shared";
import { resolveRecipientNotificationLocale } from "./recipient-locale";

type TranslationParam = string | number | bigint | boolean | Date | null | undefined;

interface NotificationI18nMetadata {
	titleKey?: string;
	titleDefault?: string;
	messageKey?: string;
	messageDefault?: string;
	params?: Record<string, TranslationParam>;
}

interface NotificationMetadata {
	i18n?: NotificationI18nMetadata;
}

interface LocalizeOutboundNotificationParams {
	userId: string;
	organizationId: string;
	title: string;
	message: string;
	metadata?: Record<string, unknown> | string | null;
}

interface LocalizedOutboundNotification {
	locale: string;
	title: string;
	message: string;
}

const logger = createLogger("OutboundNotificationLocalization");

function parseMetadata(metadata: LocalizeOutboundNotificationParams["metadata"]): NotificationMetadata {
	if (!metadata) return {};
	if (typeof metadata === "object") return metadata as NotificationMetadata;

	try {
		return JSON.parse(metadata) as NotificationMetadata;
	} catch {
		return {};
	}
}

export async function localizeOutboundNotification({
	userId,
	organizationId,
	title,
	message,
	metadata,
}: LocalizeOutboundNotificationParams): Promise<LocalizedOutboundNotification> {
	const locale = await resolveRecipientNotificationLocale({ userId, organizationId });
	const i18n = parseMetadata(metadata).i18n;

	if (!i18n?.titleKey && !i18n?.messageKey) {
		return { locale, title, message };
	}

	try {
		const staticData = await loadNamespaces(locale, ALL_NAMESPACES);
		const tolgee = TolgeeBase().init({ language: locale, staticData });
		await tolgee.run();

		return {
			locale,
			title: i18n.titleKey
				? tolgee.t({ key: i18n.titleKey, defaultValue: i18n.titleDefault ?? title, params: i18n.params })
				: title,
			message: i18n.messageKey
				? tolgee.t({ key: i18n.messageKey, defaultValue: i18n.messageDefault ?? message, params: i18n.params })
				: message,
		};
	} catch (error) {
		logger.warn({ error, userId, organizationId, locale }, "Failed to localize outbound notification");
		return { locale, title, message };
	}
}
```

- [ ] **Step 4: Run the renderer tests to verify pass**

Run: `pnpm --filter webapp test -- src/lib/notifications/outbound-localization.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit if explicitly approved**

If the user has explicitly approved commits in the implementation session, run:

```bash
git add apps/webapp/src/lib/notifications/outbound-localization.ts apps/webapp/src/lib/notifications/outbound-localization.test.ts
git commit -m "feat: localize outbound notification content"
```

Expected: commit succeeds. If commits are not approved, leave changes unstaged.

## Task 4: Organization Default Language Action And UI

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx`
- Modify: `apps/webapp/src/components/organization/organization-tab.tsx`
- Create: `apps/webapp/src/components/organization/organization-language-card.tsx`
- Create: `apps/webapp/src/components/organization/organization-language-card.test.tsx`
- Modify: `apps/webapp/messages/organization/en.json`
- Modify: `apps/webapp/messages/organization/de.json`

- [ ] **Step 1: Add failing action tests**

Append these tests to `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts`. Also add these mocks near the existing hoisted mocks:

```ts
const organizationNotificationSettingsFindFirstMock = vi.fn();
const insertValuesMock = vi.fn();
const insertMock = vi.fn(() => ({ values: insertValuesMock }));
```

Extend the `@/db` mock with the new query and insert function:

```ts
organizationNotificationSettings: { findFirst: organizationNotificationSettingsFindFirstMock },
```

```ts
insert: insertMock,
```

Add these resets to the existing `beforeEach` blocks that prepare organization action tests:

```ts
organizationNotificationSettingsFindFirstMock.mockReset();
insertValuesMock.mockReset();
organizationNotificationSettingsFindFirstMock.mockResolvedValue({ id: "settings-1" });
insertValuesMock.mockResolvedValue([{ id: "settings-1" }]);
```

Then append the tests:

```ts
describe("organization default notification language", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSessionMock.mockResolvedValue({
			user: { id: "user-admin" },
			session: { activeOrganizationId: "org-1" },
		});
		memberFindFirstMock.mockResolvedValue({
			id: "member-admin",
			userId: "user-admin",
			organizationId: "org-1",
			role: "admin",
		});
		updateSetMock.mockReturnValue({ where: updateWhereMock });
		updateWhereMock.mockResolvedValue([{ id: "settings-1" }]);
	});

	it("allows admins to update the organization default notification language", async () => {
		const { updateOrganizationDefaultNotificationLanguage } = await import("./actions");

		const result = await updateOrganizationDefaultNotificationLanguage("org-1", "de");

		expect(result).toMatchObject({ success: true });
		expect(updateSetMock).toHaveBeenCalledWith({ defaultLanguage: "de" });
	});

	it("rejects unsupported organization default notification languages", async () => {
		const { updateOrganizationDefaultNotificationLanguage } = await import("./actions");

		const result = await updateOrganizationDefaultNotificationLanguage("org-1", "xx");

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Unsupported language",
		});
		expect(updateSetMock).not.toHaveBeenCalled();
	});

	it("rejects members changing the organization default notification language", async () => {
		memberFindFirstMock.mockResolvedValue({
			id: "member-regular",
			userId: "user-admin",
			organizationId: "org-1",
			role: "member",
		});

		const { updateOrganizationDefaultNotificationLanguage } = await import("./actions");

		const result = await updateOrganizationDefaultNotificationLanguage("org-1", "de");

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(updateSetMock).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run action tests to verify failure**

Run: `pnpm --filter webapp test -- 'src/app/[locale]/(app)/settings/organizations/actions.test.ts'`

Expected: FAIL because `updateOrganizationDefaultNotificationLanguage` is not exported.

- [ ] **Step 3: Implement the action**

Modify `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts` imports:

```ts
import { organizationNotificationSettings, employee, team } from "@/db/schema";
import { ALL_LANGUAGES } from "@/tolgee/shared";
```

Add this action near `updateOrganizationTimezone`:

```ts
export async function updateOrganizationDefaultNotificationLanguage(
	organizationId: string,
	defaultLanguage: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"updateOrganizationDefaultNotificationLanguage",
		{ attributes: { "organization.id": organizationId, defaultLanguage } },
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				if (!ALL_LANGUAGES.includes(defaultLanguage)) {
					yield* _(
						Effect.fail(new ValidationError({ message: "Unsupported language", field: "defaultLanguage" })),
					);
				}

				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
					Effect.flatMap((member) =>
						member
							? Effect.succeed(member)
							: Effect.fail(new NotFoundError({ message: "You are not a member of this organization", entityType: "member" })),
					),
				);

				if (memberRecord.role !== "admin" && memberRecord.role !== "owner") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can change organization default notification language",
								userId: session.user.id,
								resource: "organization",
								action: "update",
							}),
						),
					);
				}

				const existing = yield* _(
					dbService.query("getOrganizationNotificationSettings", async () => {
						return await db.query.organizationNotificationSettings.findFirst({
							where: eq(organizationNotificationSettings.organizationId, organizationId),
							columns: { id: true },
						});
					}),
				);

				yield* _(
					Effect.tryPromise({
						try: async () => {
							if (existing) {
								await db
									.update(organizationNotificationSettings)
									.set({ defaultLanguage })
									.where(eq(organizationNotificationSettings.organizationId, organizationId));
								return;
							}

							await db.insert(organizationNotificationSettings).values({ organizationId, defaultLanguage });
						},
						catch: (error) =>
							new ValidationError({
								message: error instanceof Error ? error.message : "Failed to update organization default notification language",
								field: "defaultLanguage",
							}),
					}),
				);

				logger.info({ organizationId, defaultLanguage }, "Organization default notification language updated");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId, defaultLanguage }, "Failed to update organization default notification language");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}
```

- [ ] **Step 4: Load default language in the page**

Modify `apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx` imports:

```ts
import { employee, organizationNotificationSettings, team } from "@/db/schema";
```

Add the settings query to the existing `Promise.all`:

```ts
const [organization, organizationNotificationSettingsRecord, invitations, currentMember, members] = await Promise.all([
	db.query.organization.findFirst({
		where: eq(authSchema.organization.id, organizationId),
	}),
	db.query.organizationNotificationSettings.findFirst({
		where: eq(organizationNotificationSettings.organizationId, organizationId),
		columns: { defaultLanguage: true },
	}),
	// existing invitation, member, and members queries stay in the same order after this new entry
]);
```

Pass this prop into `OrganizationsPageClient`:

```tsx
defaultNotificationLanguage={organizationNotificationSettingsRecord?.defaultLanguage ?? "en"}
```

Update `OrganizationsPageClient` props to accept and pass `defaultNotificationLanguage` to `OrganizationTab` if that component sits between the page and tab.

- [ ] **Step 5: Add the language card component**

Create `apps/webapp/src/components/organization/organization-language-card.tsx`:

```tsx
"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateOrganizationDefaultNotificationLanguage } from "@/app/[locale]/(app)/settings/organizations/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGE_CONFIG } from "@/lib/language-config";
import { useRouter } from "@/navigation";
import { ALL_LANGUAGES } from "@/tolgee/shared";

interface OrganizationLanguageCardProps {
	organizationId: string;
	defaultLanguage: string;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationLanguageCard({
	organizationId,
	defaultLanguage: initialDefaultLanguage,
	currentMemberRole,
}: OrganizationLanguageCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [defaultLanguage, setDefaultLanguage] = useState(initialDefaultLanguage);
	const canEdit = currentMemberRole === "owner" || currentMemberRole === "admin";

	const handleLanguageChange = async (newLanguage: string) => {
		if (!canEdit) return;
		const previousLanguage = defaultLanguage;
		setDefaultLanguage(newLanguage);

		const result = await updateOrganizationDefaultNotificationLanguage(organizationId, newLanguage);
		if (result.success) {
			toast.success(t("organization.language.updated", "Organization notification language updated"));
			startTransition(() => router.refresh());
			return;
		}

		setDefaultLanguage(previousLanguage);
		toast.error(result.error || t("organization.language.updateFailed", "Failed to update organization notification language"));
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("organization.language.title", "Notification language")}</CardTitle>
				<CardDescription>
					{t(
						"organization.language.description",
						"Set the fallback language for email, Telegram, and other outbound notifications when a user has not selected a UI language.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<Label htmlFor="organization-notification-language">
							{t("organization.language.default", "Default notification language")}
						</Label>
						{isPending && <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
					</div>
					<Select value={defaultLanguage} onValueChange={handleLanguageChange} disabled={!canEdit || isPending}>
						<SelectTrigger id="organization-notification-language">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{ALL_LANGUAGES.map((language) => (
								<SelectItem key={language} value={language}>
									{LANGUAGE_CONFIG[language]?.name ?? language}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{!canEdit && (
					<p className="text-xs text-muted-foreground">
						{t(
							"organization.language.adminOnly",
							"Only organization admins and owners can change the notification language setting.",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 6: Render the language card in the tab**

Modify `apps/webapp/src/components/organization/organization-tab.tsx`:

```tsx
import { OrganizationLanguageCard } from "./organization-language-card";

interface OrganizationTabProps {
	organization: typeof authSchema.organization.$inferSelect;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	currentMemberRole: "owner" | "admin" | "member";
	currentUserId: string;
	canCreateOrganizations: boolean;
	defaultNotificationLanguage: string;
}
```

Render it after `OrganizationTimezoneCard`:

```tsx
<OrganizationLanguageCard
	organizationId={organization.id}
	defaultLanguage={defaultNotificationLanguage}
	currentMemberRole={currentMemberRole}
/>
```

- [ ] **Step 7: Add translation keys**

Add these keys to `apps/webapp/messages/organization/en.json`:

```json
{
  "organization.language.title": "Notification language",
  "organization.language.description": "Set the fallback language for email, Telegram, and other outbound notifications when a user has not selected a UI language.",
  "organization.language.default": "Default notification language",
  "organization.language.updated": "Organization notification language updated",
  "organization.language.updateFailed": "Failed to update organization notification language",
  "organization.language.adminOnly": "Only organization admins and owners can change the notification language setting."
}
```

Add these keys to `apps/webapp/messages/organization/de.json`:

```json
{
  "organization.language.title": "Benachrichtigungssprache",
  "organization.language.description": "Legt die Ausweichsprache für E-Mail-, Telegram- und andere externe Benachrichtigungen fest, wenn ein Benutzer keine UI-Sprache ausgewählt hat.",
  "organization.language.default": "Standard-Benachrichtigungssprache",
  "organization.language.updated": "Benachrichtigungssprache der Organisation aktualisiert",
  "organization.language.updateFailed": "Benachrichtigungssprache der Organisation konnte nicht aktualisiert werden",
  "organization.language.adminOnly": "Nur Organisationsadmins und Eigentümer können die Benachrichtigungssprache ändern."
}
```

When editing JSON, merge these keys into the existing object instead of replacing existing content.

- [ ] **Step 8: Add the component test**

Create `apps/webapp/src/components/organization/organization-language-card.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateLanguageMock, refreshMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
	updateLanguageMock: vi.fn(),
	refreshMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
	},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	updateOrganizationDefaultNotificationLanguage: updateLanguageMock,
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ value, onValueChange, disabled, children }: { value: string; onValueChange(value: string): void; disabled?: boolean; children: React.ReactNode }) => (
		<div data-value={value}>
			<button type="button" disabled={disabled} onClick={() => onValueChange("de")}>
				Change language
			</button>
			{children}
		</div>
	),
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
	SelectValue: () => <span>Selected language</span>,
}));

import { OrganizationLanguageCard } from "./organization-language-card";

describe("OrganizationLanguageCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		updateLanguageMock.mockResolvedValue({ success: true, data: undefined });
	});

	it("allows admins to change the organization notification language", async () => {
		render(
			<OrganizationLanguageCard
				organizationId="org-1"
				defaultLanguage="en"
				currentMemberRole="admin"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Change language" }));

		await waitFor(() => {
			expect(updateLanguageMock).toHaveBeenCalledWith("org-1", "de");
		});
		expect(toastSuccessMock).toHaveBeenCalledWith("Organization notification language updated");
		expect(refreshMock).toHaveBeenCalledOnce();
	});

	it("disables language changes for members", () => {
		render(
			<OrganizationLanguageCard
				organizationId="org-1"
				defaultLanguage="en"
				currentMemberRole="member"
			/>,
		);

		expect(screen.getByRole("button", { name: "Change language" })).toBeDisabled();
		expect(
			screen.getByText("Only organization admins and owners can change the notification language setting."),
		).toBeTruthy();
	});
});
```

- [ ] **Step 9: Run organization tests**

Run: `pnpm --filter webapp test -- 'src/app/[locale]/(app)/settings/organizations/actions.test.ts' src/components/organization/organization-language-card.test.tsx`

Expected: PASS.

- [ ] **Step 10: Commit if explicitly approved**

If the user has explicitly approved commits in the implementation session, run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts' 'apps/webapp/src/app/[locale]/(app)/settings/organizations/page.tsx' apps/webapp/src/components/organization/organization-tab.tsx apps/webapp/src/components/organization/organization-language-card.tsx apps/webapp/src/components/organization/organization-language-card.test.tsx apps/webapp/messages/organization/en.json apps/webapp/messages/organization/de.json
git commit -m "feat: add organization notification language setting"
```

Expected: commit succeeds. If commits are not approved, leave changes unstaged.

## Task 5: Telegram Channel Localization

**Files:**
- Modify: `apps/webapp/src/lib/notifications/telegram-channel.ts`
- Create: `apps/webapp/src/lib/notifications/telegram-channel.test.ts`
- Modify: `apps/webapp/messages/common/en.json`
- Modify: `apps/webapp/messages/common/de.json`

- [ ] **Step 1: Write the failing Telegram channel test**

Create `apps/webapp/src/lib/notifications/telegram-channel.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessageMock = vi.fn();
const getChatIdForUserMock = vi.fn();
const getBotConfigByOrganizationMock = vi.fn();
const localizeOutboundNotificationMock = vi.fn();

vi.mock("@/db", () => ({
	db: { query: { approvalRequest: { findFirst: vi.fn() }, employee: { findFirst: vi.fn() } } },
}));

vi.mock("@/lib/telegram", () => ({
	getChatIdForUser: getChatIdForUserMock,
	getBotConfigByOrganization: getBotConfigByOrganizationMock,
	sendMessage: sendMessageMock,
	sendApprovalMessageToManager: vi.fn(),
	isTelegramEnabledForOrganization: vi.fn(async () => true),
}));

vi.mock("@/lib/telegram/formatters", () => ({
	escapeMarkdownV2: (value: string) => value,
}));

vi.mock("./outbound-localization", () => ({
	localizeOutboundNotification: localizeOutboundNotificationMock,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

describe("sendTelegramNotification", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		getBotConfigByOrganizationMock.mockResolvedValue({ botToken: "bot-token" });
		getChatIdForUserMock.mockResolvedValue("chat-1");
		localizeOutboundNotificationMock.mockResolvedValue({
			locale: "de",
			title: "Zum Team hinzugefügt",
			message: "Sie wurden zum Team Operations hinzugefügt.",
		});
	});

	it("sends localized simple notification text", async () => {
		const { sendTelegramNotification } = await import("./telegram-channel");

		await sendTelegramNotification({
			userId: "user-1",
			organizationId: "org-1",
			type: "team_member_added",
			title: "Added to team",
			message: "You were added to Operations.",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.teamMemberAdded.title",
					messageKey: "common:notifications.content.teamMemberAdded.message",
					params: { teamName: "Operations" },
				},
			},
		});

		expect(localizeOutboundNotificationMock).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
			title: "Added to team",
			message: "You were added to Operations.",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.teamMemberAdded.title",
					messageKey: "common:notifications.content.teamMemberAdded.message",
					params: { teamName: "Operations" },
				},
			},
		});
		expect(sendMessageMock).toHaveBeenCalledWith("bot-token", {
			chat_id: "chat-1",
			text: "*Zum Team hinzugefügt*\n\nSie wurden zum Team Operations hinzugefügt.",
			parse_mode: "MarkdownV2",
		});
	});
});
```

- [ ] **Step 2: Run the Telegram test to verify failure**

Run: `pnpm --filter webapp test -- src/lib/notifications/telegram-channel.test.ts`

Expected: FAIL because `sendTelegramNotification` still uses `params.title` and `params.message` directly.

- [ ] **Step 3: Localize simple Telegram notifications**

Modify `apps/webapp/src/lib/notifications/telegram-channel.ts` imports:

```ts
import { localizeOutboundNotification } from "./outbound-localization";
```

Replace the simple message text construction with:

```ts
const localized = await localizeOutboundNotification({
	userId: params.userId,
	organizationId: params.organizationId,
	title: params.title,
	message: params.message,
	metadata: params.metadata,
});

let text = `*${escapeMarkdownV2(localized.title)}*\n\n${escapeMarkdownV2(localized.message)}`;
```

Keep the approval-specific early return unchanged because it uses a specialized Telegram approval handler.

- [ ] **Step 4: Ensure common notification keys exist**

Add or update these keys in `apps/webapp/messages/common/en.json`:

```json
{
  "notifications.content.teamMemberAdded.title": "Added to team",
  "notifications.content.teamMemberAdded.message": "You were added to the {teamName} team.",
  "common:notifications.content.teamMemberAdded.title": "Added to team",
  "common:notifications.content.teamMemberAdded.message": "You were added to the {teamName} team."
}
```

Add or update these keys in `apps/webapp/messages/common/de.json`:

```json
{
  "notifications.content.teamMemberAdded.title": "Zum Team hinzugefügt",
  "notifications.content.teamMemberAdded.message": "Sie wurden zum Team {teamName} hinzugefügt.",
  "common:notifications.content.teamMemberAdded.title": "Zum Team hinzugefügt",
  "common:notifications.content.teamMemberAdded.message": "Sie wurden zum Team {teamName} hinzugefügt."
}
```

When editing JSON, merge keys into the existing object. Keep whichever namespace alias style current common notification keys already use.

- [ ] **Step 5: Run Telegram tests to verify pass**

Run: `pnpm --filter webapp test -- src/lib/notifications/telegram-channel.test.ts src/lib/notifications/outbound-localization.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit if explicitly approved**

If the user has explicitly approved commits in the implementation session, run:

```bash
git add apps/webapp/src/lib/notifications/telegram-channel.ts apps/webapp/src/lib/notifications/telegram-channel.test.ts apps/webapp/messages/common/en.json apps/webapp/messages/common/de.json
git commit -m "feat: localize telegram notifications"
```

Expected: commit succeeds. If commits are not approved, leave changes unstaged.

## Task 6: Email Notification Localization

**Files:**
- Modify: `apps/webapp/src/lib/notifications/email-notifications.ts`
- Modify: `apps/webapp/src/lib/notifications/email-notifications.test.ts`

- [ ] **Step 1: Write the failing email localization test**

Modify `apps/webapp/src/lib/notifications/email-notifications.test.ts` to mock `./outbound-localization`:

```ts
const localizeOutboundNotificationMock = vi.fn();

vi.mock("./outbound-localization", () => ({
	localizeOutboundNotification: localizeOutboundNotificationMock,
}));
```

Add this setup in `beforeEach`:

```ts
localizeOutboundNotificationMock.mockResolvedValue({
	locale: "en",
	title: "Original title",
	message: "Original message",
});
```

Add this test:

```ts
it("uses localized notification title as email subject override", async () => {
	localizeOutboundNotificationMock.mockResolvedValue({
		locale: "de",
		title: "Abwesenheitsanfrage genehmigt",
		message: "Ihre Abwesenheitsanfrage wurde genehmigt.",
	});

	const result = await sendEmailNotification({
		userId: "user_123",
		type: "absence_request_approved",
		title: "Absence Request Approved",
		message: "Your absence request was approved.",
		organizationId: "org_123",
		metadata: {
			approverName: "Morgan",
			startDate: "2026-05-01",
			endDate: "2026-05-02",
			absenceType: "Vacation",
			days: 2,
			i18n: {
				titleKey: "common:notifications.content.absenceRequestApproved.title",
				titleDefault: "Absence request approved",
				messageKey: "common:notifications.content.absenceRequestApproved.message",
				messageDefault: "Your absence request was approved.",
			},
		},
	});

	expect(result).toBe(true);
	expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
		expect.objectContaining({ subjectOverride: "Abwesenheitsanfrage genehmigt" }),
	);
});
```

- [ ] **Step 2: Run email tests to verify failure**

Run: `pnpm --filter webapp test -- src/lib/notifications/email-notifications.test.ts`

Expected: FAIL because `sendEmailNotification` does not call `localizeOutboundNotification`.

- [ ] **Step 3: Use localized title/message in email notifications**

Modify `apps/webapp/src/lib/notifications/email-notifications.ts` imports:

```ts
import { localizeOutboundNotification } from "./outbound-localization";
```

After `appUrl` is loaded, add:

```ts
const localized = organizationId
	? await localizeOutboundNotification({
			userId,
			organizationId,
			title: params.title,
			message: params.message,
			metadata,
		})
	: { locale: "en", title: params.title, message: params.message };
```

Initialize subject with localized title:

```ts
let subjectOverride = localized.title;
```

For switch cases that currently assign hardcoded subject strings, keep the existing template selection but prefer localized title when metadata contains `i18n.titleKey`:

```ts
const hasI18nTitle = typeof metadata?.i18n === "object" && metadata.i18n !== null;
```

Then replace hardcoded `subjectOverride = "Absence Request Approved"` style assignments with:

```ts
subjectOverride = hasI18nTitle ? localized.title : "Absence Request Approved";
```

Use the matching existing English fallback string for each case. Team dynamic subjects can stay dynamic until their notification creation metadata carries a title key for the same sentence.

- [ ] **Step 4: Run email tests to verify pass**

Run: `pnpm --filter webapp test -- src/lib/notifications/email-notifications.test.ts src/lib/notifications/outbound-localization.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit if explicitly approved**

If the user has explicitly approved commits in the implementation session, run:

```bash
git add apps/webapp/src/lib/notifications/email-notifications.ts apps/webapp/src/lib/notifications/email-notifications.test.ts
git commit -m "feat: localize email notification subjects"
```

Expected: commit succeeds. If commits are not approved, leave changes unstaged.

## Task 7: Full Verification

**Files:**
- Verify all files changed in Tasks 1-6.

- [ ] **Step 1: Run focused notification and organization tests**

Run:

```bash
pnpm --filter webapp test -- \
  src/lib/notifications/recipient-locale.test.ts \
  src/lib/notifications/outbound-localization.test.ts \
  src/lib/notifications/telegram-channel.test.ts \
  src/lib/notifications/email-notifications.test.ts \
  'src/app/[locale]/(app)/settings/organizations/actions.test.ts' \
  src/components/organization/organization-language-card.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run i18n and common notification regression tests**

Run:

```bash
pnpm --filter webapp test -- \
  src/tolgee/shared.test.ts \
  src/lib/notifications/localized-notification.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the webapp test suite if time permits**

Run: `pnpm --filter webapp test`

Expected: PASS.

- [ ] **Step 4: Run production build if implementation changed shared schema exports or Next page props**

Run: `CI=true pnpm build`

Expected: PASS.

- [ ] **Step 5: Document residual risks**

Record any skipped checks in the final implementation summary. If email template override behavior remains English because the organization override is custom content, state that this is intentional and matches the design.

- [ ] **Step 6: Commit verification adjustments if explicitly approved**

If verification required fixes and the user has explicitly approved commits in the implementation session, run:

```bash
git add apps/webapp docs/superpowers
git commit -m "test: cover recipient language notifications"
```

Expected: commit succeeds. If commits are not approved, leave changes unstaged.
