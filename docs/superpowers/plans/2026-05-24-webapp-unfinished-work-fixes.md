# Webapp Unfinished Work Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the unfinished surcharge flag, calendar-provider placeholders, cleanup jobs, and platform-admin-customizable billing system emails.

**Architecture:** Keep small operational fixes isolated, and introduce platform system email templates as a separate global template path from organization email templates. Billing lifecycle handlers render platform system templates and send via system transport only, while webhook state changes remain primary and non-blocked by email failures.

**Tech Stack:** Next.js App Router, React, Drizzle ORM/Postgres, Effect, Stripe webhooks, Vitest, pnpm.

---

## File Map

- Modify `apps/webapp/src/components/server-app-sidebar.tsx`: read `surchargesEnabled` from the current organization.
- Modify `apps/webapp/src/components/app-sidebar.test.tsx`: add coverage for surcharge nav visibility when the feature flag is true.
- Modify `apps/webapp/src/lib/calendar-sync/providers/index.ts`: replace unsafe full registry with a partial implemented-provider registry.
- Create `apps/webapp/src/lib/calendar-sync/providers/index.test.ts`: verify implemented and unsupported provider behavior.
- Modify `apps/webapp/src/lib/cleanup.ts`: call real notification and audit-log cleanup functions.
- Create `apps/webapp/src/lib/cleanup.test.ts`: verify cleanup routing and deleted counts.
- Create `apps/webapp/src/lib/audit/cleanup.ts`: delete old `auditLog` rows by timestamp.
- Create `apps/webapp/src/lib/audit/cleanup.test.ts`: verify audit retention cutoff behavior.
- Modify `apps/webapp/src/db/schema/email-template.ts`: add platform system email template keys and table.
- Modify `apps/webapp/src/db/schema/index.ts`: export the updated schema if needed by existing barrel exports.
- Create `apps/webapp/drizzle/0030_platform_system_email_template.sql`: migration for the new global template table.
- Modify `apps/webapp/drizzle/meta/_journal.json`: add migration entry with `when` greater than `1779490000000`.
- Create `apps/webapp/src/lib/email/system-template-registry.ts`: billing system template definitions, variables, and defaults.
- Create `apps/webapp/src/lib/email/system-template-overrides.ts`: load enabled platform template overrides.
- Create `apps/webapp/src/lib/email/system-template-renderer.ts`: render platform override or default template.
- Create `apps/webapp/src/lib/email/system-template-settings.ts`: validation and shared action types for platform system templates.
- Create `apps/webapp/src/lib/billing/billing-system-email.ts`: recipient resolution and non-throwing billing mail sending.
- Modify `apps/webapp/src/lib/effect/services/billing/billing-events.service.ts`: call billing system mail sender for the five lifecycle events.
- Create `apps/webapp/src/lib/billing/billing-system-email.test.ts`: verify template key selection, recipient skip, and system transport usage.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/system-email-templates/actions.ts`: platform admin list/save/reset/test actions.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/system-email-templates/actions.test.ts`: permission and validation tests.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/system-email-templates/page.tsx`: platform admin page.
- Create `apps/webapp/src/components/platform-admin/system-email-templates/system-email-template-settings-client.tsx`: client wrapper around the existing email template editor.
- Modify `apps/webapp/src/app/[locale]/(admin)/layout.tsx`: add nav item for system email templates.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx`: add overview card/link for system email templates.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`: source-level nav/overview coverage.

## Task 1: Sidebar And Calendar Provider Fixes

**Files:**
- Modify: `apps/webapp/src/components/server-app-sidebar.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`
- Modify: `apps/webapp/src/lib/calendar-sync/providers/index.ts`
- Create: `apps/webapp/src/lib/calendar-sync/providers/index.test.ts`

- [ ] **Step 1: Write the sidebar failing test**

Add a test case to `apps/webapp/src/components/app-sidebar.test.tsx` near existing feature-flag tests. The assertion must prove surcharge navigation is visible when `featureFlags.surchargesEnabled` is true.

```tsx
it("shows surcharge settings when surcharges are enabled", () => {
	render(
		<AppSidebar
			organizations={mockOrganizations}
			currentOrganization={mockOrganizations[0]}
			employeeRole="admin"
			settingsAccessTier="orgAdmin"
			featureFlags={{
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: true,
				demoDataEnabled: false,
			}}
		/>,
	);

	expect(screen.getByText(/surcharges/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the sidebar test and verify it fails if the component still hides surcharges**

Run: `pnpm --filter webapp test -- src/components/app-sidebar.test.tsx`

Expected before implementation: the new test fails if surcharge nav is unreachable with the feature flag.

- [ ] **Step 3: Implement the sidebar fix**

Change `apps/webapp/src/components/server-app-sidebar.tsx` lines 23-28 to:

```tsx
const featureFlags = {
	shiftsEnabled: currentOrganization?.shiftsEnabled ?? false,
	projectsEnabled: currentOrganization?.projectsEnabled ?? false,
	surchargesEnabled: currentOrganization?.surchargesEnabled ?? false,
	demoDataEnabled: currentOrganization?.demoDataEnabled ?? true,
};
```

- [ ] **Step 4: Write calendar provider registry tests**

Create `apps/webapp/src/lib/calendar-sync/providers/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getCalendarProvider, getSupportedProviders, isProviderSupported } from "./index";

describe("calendar provider registry", () => {
	it("returns implemented providers", () => {
		expect(getCalendarProvider("google").provider).toBe("google");
		expect(getCalendarProvider("microsoft365").provider).toBe("microsoft365");
		expect(getSupportedProviders().map((provider) => provider.provider)).toEqual([
			"google",
			"microsoft365",
		]);
	});

	it("fails explicitly for unsupported providers", () => {
		expect(() => getCalendarProvider("icloud")).toThrow(
			'Calendar provider "icloud" is not supported',
		);
		expect(() => getCalendarProvider("caldav")).toThrow(
			'Calendar provider "caldav" is not supported',
		);
		expect(isProviderSupported("icloud")).toBe(false);
		expect(isProviderSupported("caldav")).toBe(false);
	});
});
```

- [ ] **Step 5: Run the calendar test and verify it fails on placeholder behavior**

Run: `pnpm --filter webapp test -- src/lib/calendar-sync/providers/index.test.ts`

Expected before implementation: the unsupported-provider test fails or relies on casted `undefined` behavior.

- [ ] **Step 6: Implement the calendar registry fix**

In `apps/webapp/src/lib/calendar-sync/providers/index.ts`, replace the provider map with a partial registry:

```ts
const providers = {
	google: googleCalendarProvider,
	microsoft365: microsoft365CalendarProvider,
} satisfies Partial<Record<CalendarProvider, ICalendarProvider>>;
```

Keep `getCalendarProvider` as:

```ts
export function getCalendarProvider(provider: CalendarProvider): ICalendarProvider {
	const impl = providers[provider];
	if (!impl) {
		throw new Error(`Calendar provider "${provider}" is not supported`);
	}
	return impl;
}
```

Keep `isProviderSupported` returning `false` for `icloud` and `caldav`; remove the placeholder entries and comments.

- [ ] **Step 7: Verify Task 1**

Run:

```bash
pnpm --filter webapp test -- src/components/app-sidebar.test.tsx src/lib/calendar-sync/providers/index.test.ts
```

Expected: both test files pass.

- [ ] **Step 8: Checkpoint**

Do not commit unless the user explicitly asks. Record changed files in your handoff.

## Task 2: Cleanup Jobs

**Files:**
- Modify: `apps/webapp/src/lib/cleanup.ts`
- Create: `apps/webapp/src/lib/cleanup.test.ts`
- Create: `apps/webapp/src/lib/audit/cleanup.ts`
- Create: `apps/webapp/src/lib/audit/cleanup.test.ts`

- [ ] **Step 1: Write the cleanup routing test**

Create `apps/webapp/src/lib/cleanup.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const cleanupExpiredExportsMock = vi.fn();
const deleteOldNotificationsMock = vi.fn();
const deleteOldAuditLogsMock = vi.fn();

vi.mock("@/lib/export/export-service", () => ({
	cleanupExpiredExports: cleanupExpiredExportsMock,
}));

vi.mock("@/lib/notifications/notification-service", () => ({
	deleteOldNotifications: deleteOldNotificationsMock,
}));

vi.mock("@/lib/audit/cleanup", () => ({
	deleteOldAuditLogs: deleteOldAuditLogsMock,
}));

describe("runCleanup", () => {
	beforeEach(() => {
		cleanupExpiredExportsMock.mockReset();
		deleteOldNotificationsMock.mockReset();
		deleteOldAuditLogsMock.mockReset();
	});

	it("routes cleanup tasks to concrete cleanup functions", async () => {
		cleanupExpiredExportsMock.mockResolvedValue(2);
		deleteOldNotificationsMock.mockResolvedValue(3);
		deleteOldAuditLogsMock.mockResolvedValue(4);
		const { runCleanup } = await import("./cleanup");

		await expect(runCleanup({ type: "cleanup", task: "expired_exports" })).resolves.toEqual({ deletedCount: 2 });
		await expect(runCleanup({ type: "cleanup", task: "old_notifications" })).resolves.toEqual({ deletedCount: 3 });
		await expect(runCleanup({ type: "cleanup", task: "old_audit_logs" })).resolves.toEqual({ deletedCount: 4 });

		expect(deleteOldNotificationsMock).toHaveBeenCalledWith(90);
		expect(deleteOldAuditLogsMock).toHaveBeenCalledWith(365);
	});
});
```

- [ ] **Step 2: Run the cleanup routing test and verify it fails**

Run: `pnpm --filter webapp test -- src/lib/cleanup.test.ts`

Expected before implementation: `old_notifications` and `old_audit_logs` return `0` or do not call the mocked helpers.

- [ ] **Step 3: Add audit cleanup helper**

Create `apps/webapp/src/lib/audit/cleanup.ts`:

```ts
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { createLogger } from "@/lib/logger";

const logger = createLogger("AuditCleanup");

export async function deleteOldAuditLogs(olderThanDays = 365): Promise<number> {
	try {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

		const result = await db
			.delete(auditLog)
			.where(sql`${auditLog.timestamp} < ${cutoffDate}`)
			.returning({ id: auditLog.id });

		logger.info({ deletedCount: result.length, olderThanDays }, "Old audit logs cleaned up");
		return result.length;
	} catch (error) {
		logger.error({ error, olderThanDays }, "Failed to delete old audit logs");
		return 0;
	}
}
```

- [ ] **Step 4: Add audit cleanup helper test**

Create `apps/webapp/src/lib/audit/cleanup.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const returningMock = vi.fn();
const whereMock = vi.fn(() => ({ returning: returningMock }));
const deleteMock = vi.fn(() => ({ where: whereMock }));

vi.mock("@/db", () => ({
	db: { delete: deleteMock },
}));

describe("deleteOldAuditLogs", () => {
	beforeEach(() => {
		deleteMock.mockClear();
		whereMock.mockClear();
		returningMock.mockReset();
	});

	it("returns the number of deleted audit log rows", async () => {
		returningMock.mockResolvedValue([{ id: "a" }, { id: "b" }]);
		const { deleteOldAuditLogs } = await import("./cleanup");

		await expect(deleteOldAuditLogs(365)).resolves.toBe(2);
		expect(deleteMock).toHaveBeenCalledTimes(1);
		expect(whereMock).toHaveBeenCalledTimes(1);
	});

	it("returns zero when cleanup fails", async () => {
		returningMock.mockRejectedValue(new Error("db unavailable"));
		const { deleteOldAuditLogs } = await import("./cleanup");

		await expect(deleteOldAuditLogs(365)).resolves.toBe(0);
	});
});
```

- [ ] **Step 5: Wire real cleanup helpers**

Modify `apps/webapp/src/lib/cleanup.ts` imports:

```ts
import { deleteOldAuditLogs } from "@/lib/audit/cleanup";
import { cleanupExpiredExports } from "@/lib/export/export-service";
import { deleteOldNotifications } from "@/lib/notifications/notification-service";
```

Replace the TODO cases with:

```ts
case "old_notifications":
	deletedCount = await deleteOldNotifications(90);
	logger.info({ count: deletedCount }, "Cleaned up old notifications");
	break;

case "old_audit_logs":
	deletedCount = await deleteOldAuditLogs(365);
	logger.info({ count: deletedCount }, "Cleaned up old audit logs");
	break;
```

- [ ] **Step 6: Verify Task 2**

Run:

```bash
pnpm --filter webapp test -- src/lib/cleanup.test.ts src/lib/audit/cleanup.test.ts
```

Expected: both test files pass.

- [ ] **Step 7: Checkpoint**

Do not commit unless the user explicitly asks. Record changed files in your handoff.

## Task 3: Platform System Email Template Schema And Registry

**Files:**
- Modify: `apps/webapp/src/db/schema/email-template.ts`
- Create: `apps/webapp/drizzle/0030_platform_system_email_template.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Create: `apps/webapp/src/lib/email/system-template-registry.ts`
- Create: `apps/webapp/src/lib/email/system-template-registry.test.ts`

- [ ] **Step 1: Write system registry tests**

Create `apps/webapp/src/lib/email/system-template-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY,
	getPlatformSystemEmailTemplateDefinition,
} from "./system-template-registry";

describe("platform system email template registry", () => {
	it("defines the billing lifecycle templates", () => {
		expect(PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY.map((template) => template.key)).toEqual([
			"billing-trial-ending",
			"billing-subscription-paused",
			"billing-subscription-resumed",
			"billing-invoice-ready",
			"billing-payment-failed",
		]);
	});

	it("throws for unknown templates", () => {
		expect(() => getPlatformSystemEmailTemplateDefinition("unknown" as never)).toThrow(
			"Unknown platform system email template: unknown",
		);
	});
});
```

- [ ] **Step 2: Run the registry test and verify it fails**

Run: `pnpm --filter webapp test -- src/lib/email/system-template-registry.test.ts`

Expected before implementation: module not found.

- [ ] **Step 3: Extend schema constants and add table**

Modify `apps/webapp/src/db/schema/email-template.ts` after `EMAIL_TEMPLATE_KEYS`:

```ts
export const PLATFORM_SYSTEM_EMAIL_TEMPLATE_KEYS = [
	"billing-trial-ending",
	"billing-subscription-paused",
	"billing-subscription-resumed",
	"billing-invoice-ready",
	"billing-payment-failed",
] as const;

export type PlatformSystemEmailTemplateKey =
	(typeof PLATFORM_SYSTEM_EMAIL_TEMPLATE_KEYS)[number];
```

Add this table after `organizationEmailTemplate`:

```ts
export const platformSystemEmailTemplate = pgTable(
	"platform_system_email_template",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		templateKey: text("template_key").$type<PlatformSystemEmailTemplateKey>().notNull(),
		subject: text("subject").notNull(),
		editorDocument: jsonb("editor_document").$type<EmailTemplateEditorDocument>().notNull(),
		html: text("html").notNull(),
		plainText: text("plain_text"),
		isEnabled: boolean("is_enabled").default(true).notNull(),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		updatedByUserId: text("updated_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("platformSystemEmailTemplate_templateKey_idx").on(table.templateKey),
	],
);
```

- [ ] **Step 4: Add migration**

Create `apps/webapp/drizzle/0030_platform_system_email_template.sql`:

```sql
CREATE TABLE "platform_system_email_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"subject" text NOT NULL,
	"editor_document" jsonb NOT NULL,
	"html" text NOT NULL,
	"plain_text" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "platform_system_email_template"
	ADD CONSTRAINT "platform_system_email_template_created_by_user_id_user_id_fk"
	FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE set null;

ALTER TABLE "platform_system_email_template"
	ADD CONSTRAINT "platform_system_email_template_updated_by_user_id_user_id_fk"
	FOREIGN KEY ("updated_by_user_id") REFERENCES "user"("id") ON DELETE set null;

CREATE UNIQUE INDEX "platformSystemEmailTemplate_templateKey_idx"
	ON "platform_system_email_template" ("template_key");
```

Add journal entry with `idx: 30`, `tag: "0030_platform_system_email_template"`, and `when: 1779500000000`.

- [ ] **Step 5: Create platform system template registry**

Create `apps/webapp/src/lib/email/system-template-registry.ts` with these exports:

```ts
import type { PlatformSystemEmailTemplateKey } from "@/db/schema";
import type { EmailTemplateVariableDefinition } from "./template-registry";

export type PlatformSystemEmailTemplateCategory = "billing";

export interface PlatformSystemEmailTemplateDefinition<
	TData extends Record<string, unknown> = Record<string, unknown>,
> {
	key: PlatformSystemEmailTemplateKey;
	category: PlatformSystemEmailTemplateCategory;
	label: string;
	description: string;
	defaultSubject: string;
	variables: EmailTemplateVariableDefinition[];
	previewData: TData;
	renderDefault(data: TData): Promise<string>;
}

const variable = (name: string, label: string, description: string, example: string) => ({
	name,
	label,
	description,
	example,
});

const billingVariables = [
	variable("organizationName", "Organization name", "Name of the billed organization.", "Acme Operations"),
	variable("customerEmail", "Customer email", "Stripe customer email address.", "billing@example.com"),
	variable("billingPortalUrl", "Billing portal URL", "Link to manage billing.", "https://app.z8-time.app/settings/billing"),
	variable("trialEnd", "Trial end", "Formatted trial end date.", "May 31, 2026"),
	variable("invoiceUrl", "Invoice URL", "Stripe hosted invoice URL.", "https://invoice.stripe.com/example"),
	variable("invoicePdfUrl", "Invoice PDF URL", "Stripe invoice PDF URL.", "https://pay.stripe.com/invoice.pdf"),
	variable("amountDue", "Amount due", "Formatted amount due.", "EUR 24.00"),
	variable("failureReason", "Failure reason", "Payment failure reason.", "Your card was declined."),
] satisfies EmailTemplateVariableDefinition[];

const previewData = {
	organizationName: "Acme Operations",
	customerEmail: "billing@example.com",
	billingPortalUrl: "https://app.z8-time.app/settings/billing",
	trialEnd: "May 31, 2026",
	invoiceUrl: "https://invoice.stripe.com/example",
	invoicePdfUrl: "https://pay.stripe.com/invoice.pdf",
	amountDue: "EUR 24.00",
	failureReason: "Your card was declined.",
};

const renderDefaultBillingEmail = async (title: string, body: string, actionLabel: string) => `
<main style="font-family: system-ui, sans-serif; color: #0f172a; line-height: 1.5;">
	<h1>${title}</h1>
	<p>${body}</p>
	<p><a href="{{billingPortalUrl}}">${actionLabel}</a></p>
	<p>Z8 Billing</p>
</main>
`;

export const PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY = [
	{
		key: "billing-trial-ending",
		category: "billing",
		label: "Trial ending",
		description: "Sent before a customer trial ends.",
		defaultSubject: "Your Z8 trial is ending soon",
		variables: billingVariables,
		previewData,
		renderDefault: () => renderDefaultBillingEmail("Your trial is ending soon", "Your Z8 trial for {{organizationName}} ends on {{trialEnd}}.", "Manage billing"),
	},
	{
		key: "billing-subscription-paused",
		category: "billing",
		label: "Subscription paused",
		description: "Sent when a subscription is paused.",
		defaultSubject: "Your Z8 subscription is paused",
		variables: billingVariables,
		previewData,
		renderDefault: () => renderDefaultBillingEmail("Subscription paused", "The Z8 subscription for {{organizationName}} has been paused.", "Review billing"),
	},
	{
		key: "billing-subscription-resumed",
		category: "billing",
		label: "Subscription resumed",
		description: "Sent when a subscription resumes.",
		defaultSubject: "Your Z8 subscription has resumed",
		variables: billingVariables,
		previewData,
		renderDefault: () => renderDefaultBillingEmail("Subscription resumed", "The Z8 subscription for {{organizationName}} has resumed.", "Open billing"),
	},
	{
		key: "billing-invoice-ready",
		category: "billing",
		label: "Invoice ready",
		description: "Sent when an invoice is finalized.",
		defaultSubject: "Your Z8 invoice is ready",
		variables: billingVariables,
		previewData,
		renderDefault: () => renderDefaultBillingEmail("Invoice ready", "Your invoice for {{organizationName}} is ready. Amount due: {{amountDue}}.", "View invoice"),
	},
	{
		key: "billing-payment-failed",
		category: "billing",
		label: "Payment failed",
		description: "Sent when payment fails.",
		defaultSubject: "Action required: Z8 payment failed",
		variables: billingVariables,
		previewData,
		renderDefault: () => renderDefaultBillingEmail("Payment failed", "Payment for {{organizationName}} failed: {{failureReason}}", "Update payment method"),
	},
] satisfies PlatformSystemEmailTemplateDefinition[];

export function getPlatformSystemEmailTemplateDefinition(key: PlatformSystemEmailTemplateKey) {
	const definition = PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY.find((template) => template.key === key);
	if (!definition) {
		throw new Error(`Unknown platform system email template: ${key}`);
	}
	return definition;
}
```

- [ ] **Step 6: Verify Task 3**

Run:

```bash
pnpm --filter webapp test -- src/lib/email/system-template-registry.test.ts
```

Expected: test passes.

- [ ] **Step 7: Checkpoint**

Do not commit unless the user explicitly asks. Record changed files in your handoff.

## Task 4: Platform System Template Rendering And Admin Actions

**Files:**
- Create: `apps/webapp/src/lib/email/system-template-overrides.ts`
- Create: `apps/webapp/src/lib/email/system-template-renderer.ts`
- Create: `apps/webapp/src/lib/email/system-template-settings.ts`
- Create: `apps/webapp/src/lib/email/system-template-renderer.test.ts`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/system-email-templates/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/system-email-templates/actions.test.ts`

- [ ] **Step 1: Write renderer tests**

Create `apps/webapp/src/lib/email/system-template-renderer.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEnabledPlatformSystemEmailTemplate } from "./system-template-overrides";
import { renderPlatformSystemEmailTemplate } from "./system-template-renderer";

vi.mock("./system-template-overrides", () => ({
	getEnabledPlatformSystemEmailTemplate: vi.fn(),
}));

const getEnabledTemplateMock = vi.mocked(getEnabledPlatformSystemEmailTemplate);

describe("renderPlatformSystemEmailTemplate", () => {
	beforeEach(() => getEnabledTemplateMock.mockReset());

	it("renders the default template when no override exists", async () => {
		getEnabledTemplateMock.mockResolvedValue(null);

		const result = await renderPlatformSystemEmailTemplate({
			templateKey: "billing-payment-failed",
			data: {
				organizationName: "Acme",
				customerEmail: "billing@example.com",
				billingPortalUrl: "https://app.example.com/billing",
				failureReason: "Card declined",
			},
		});

		expect(result.subject).toContain("payment failed");
		expect(result.html).toContain("Acme");
		expect(result.usedOverride).toBe(false);
	});

	it("renders a valid override", async () => {
		getEnabledTemplateMock.mockResolvedValue({
			subject: "Payment issue for {{organizationName}}",
			html: "<p>{{failureReason}}</p>",
			plainText: "{{failureReason}}",
		});

		const result = await renderPlatformSystemEmailTemplate({
			templateKey: "billing-payment-failed",
			data: { organizationName: "Acme", failureReason: "Card declined" },
		});

		expect(result).toEqual({
			subject: "Payment issue for Acme",
			html: "<p>Card declined</p>",
			plainText: "Card declined",
			usedOverride: true,
		});
	});
});
```

- [ ] **Step 2: Implement override loader**

Create `apps/webapp/src/lib/email/system-template-overrides.ts`:

```ts
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { platformSystemEmailTemplate, type PlatformSystemEmailTemplateKey } from "@/db/schema";

export interface EnabledPlatformSystemEmailTemplate {
	subject: string;
	html: string;
	plainText: string | null;
}

export async function getEnabledPlatformSystemEmailTemplate(
	templateKey: PlatformSystemEmailTemplateKey,
): Promise<EnabledPlatformSystemEmailTemplate | null> {
	const template = await db.query.platformSystemEmailTemplate.findFirst({
		where: and(
			eq(platformSystemEmailTemplate.templateKey, templateKey),
			eq(platformSystemEmailTemplate.isEnabled, true),
		),
	});

	return template
		? { subject: template.subject, html: template.html, plainText: template.plainText }
		: null;
}
```

- [ ] **Step 3: Implement renderer**

Create `apps/webapp/src/lib/email/system-template-renderer.ts` using the same validation/sanitization behavior as the org renderer:

```ts
import type { PlatformSystemEmailTemplateKey } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { getEnabledPlatformSystemEmailTemplate } from "./system-template-overrides";
import { getPlatformSystemEmailTemplateDefinition } from "./system-template-registry";
import { interpolateTemplate, sanitizeEmailHtml, validateTemplateContent } from "./template-validation";

const logger = createLogger("PlatformSystemEmailTemplateRenderer");

export interface RenderPlatformSystemEmailTemplateInput {
	templateKey: PlatformSystemEmailTemplateKey;
	data: Record<string, unknown>;
}

export interface RenderedPlatformSystemEmailTemplate {
	subject: string;
	html: string;
	plainText?: string;
	usedOverride: boolean;
}

export async function renderPlatformSystemEmailTemplate({
	templateKey,
	data,
}: RenderPlatformSystemEmailTemplateInput): Promise<RenderedPlatformSystemEmailTemplate> {
	const definition = getPlatformSystemEmailTemplateDefinition(templateKey);
	const defaultTemplate = async (): Promise<RenderedPlatformSystemEmailTemplate> => ({
		subject: interpolateTemplate(definition.defaultSubject, data),
		html: interpolateTemplate(await definition.renderDefault(data as never), data),
		usedOverride: false,
	});

	let override;
	try {
		override = await getEnabledPlatformSystemEmailTemplate(templateKey);
	} catch (error) {
		logger.warn({ error, templateKey }, "Failed to load platform system template override");
		return defaultTemplate();
	}

	if (!override) return defaultTemplate();

	const validation = validateTemplateContent({
		subject: override.subject,
		html: override.plainText ? `${override.html}\n${override.plainText}` : override.html,
		allowedVariables: definition.variables,
	});

	if (!validation.success) {
		logger.warn({ errors: validation.errors, templateKey }, "Invalid platform system template override");
		return defaultTemplate();
	}

	const html = sanitizeEmailHtml(interpolateTemplate(override.html, data));
	if (!html.trim()) return defaultTemplate();

	return {
		subject: interpolateTemplate(override.subject, data),
		html,
		plainText: override.plainText ? interpolateTemplate(override.plainText, data) : undefined,
		usedOverride: true,
	};
}
```

- [ ] **Step 4: Implement shared settings validation**

Create `apps/webapp/src/lib/email/system-template-settings.ts` mirroring org template validation with platform template keys:

```ts
import type { PlatformSystemEmailTemplateKey } from "@/db/schema";
import { getPlatformSystemEmailTemplateDefinition } from "./system-template-registry";
import { validateTemplateContent } from "./template-validation";

export interface SavePlatformSystemEmailTemplateInput {
	templateKey: PlatformSystemEmailTemplateKey;
	subject: string;
	html: string;
	editorDocument: unknown;
	plainText?: string;
	isEnabled?: boolean;
}

export interface PlatformSystemEmailTemplateActionResult {
	success: boolean;
	errors?: string[];
}

export function validatePlatformSystemEmailTemplateInput(
	input: SavePlatformSystemEmailTemplateInput,
) {
	const errors: string[] = [];
	let definition;

	try {
		definition = getPlatformSystemEmailTemplateDefinition(input.templateKey);
	} catch {
		errors.push("Unknown platform system email template");
	}

	if (typeof input.subject !== "string") errors.push("Subject must be a string");
	if (typeof input.html !== "string") errors.push("HTML body must be a string");
	if (typeof input.editorDocument !== "object" || input.editorDocument === null || Array.isArray(input.editorDocument)) {
		errors.push("Editor document must be an object");
	}
	if (input.plainText !== undefined && typeof input.plainText !== "string") errors.push("Plain text body must be a string");
	if (input.isEnabled !== undefined && typeof input.isEnabled !== "boolean") errors.push("Enabled state must be a boolean");

	if (definition && typeof input.subject === "string" && typeof input.html === "string") {
		errors.push(
			...validateTemplateContent({
				subject: input.subject,
				html: input.plainText ? `${input.html}\n${input.plainText}` : input.html,
				allowedVariables: definition.variables,
			}).errors,
		);
	}

	return { success: errors.length === 0, errors };
}
```

- [ ] **Step 5: Create platform admin actions**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/system-email-templates/actions.ts`. Use `headers()`, `auth.api.getSession`, and `session.user.role === "admin"` before any DB write. Implement `listPlatformSystemEmailTemplates`, `savePlatformSystemEmailTemplate`, `resetPlatformSystemEmailTemplate`, and `sendPlatformSystemEmailTemplateTest`. Reuse the draft helpers from org actions by copying `htmlToPlainText`, `replaceTextNodeValues`, and `createSystemDraft`; do not import from the org route file.

Core save logic:

```ts
await db
	.insert(platformSystemEmailTemplate)
	.values({
		templateKey: input.templateKey,
		subject: input.subject,
		editorDocument: input.editorDocument as Record<string, unknown>,
		html: sanitizedHtml,
		plainText: input.plainText?.trim() ? input.plainText : null,
		isEnabled: true,
		createdByUserId: session.user.id,
		updatedByUserId: session.user.id,
	})
	.onConflictDoUpdate({
		target: platformSystemEmailTemplate.templateKey,
		set: {
			subject: input.subject,
			editorDocument: input.editorDocument as Record<string, unknown>,
			html: sanitizedHtml,
			plainText: input.plainText?.trim() ? input.plainText : null,
			isEnabled: true,
			updatedByUserId: session.user.id,
		},
	});
```

Test-send must call `sendEmail({ to: session.user.email, subject, html })` with no `organizationId`.

- [ ] **Step 6: Add action tests**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/system-email-templates/actions.test.ts` with mocks for `auth.api.getSession`, `db`, and `sendEmail`. Include these tests:

```ts
it("rejects non-platform admins", async () => {
	getSessionMock.mockResolvedValue({ user: { id: "user_1", role: "member", email: "a@example.com" } });
	const { savePlatformSystemEmailTemplate } = await import("./actions");

	await expect(savePlatformSystemEmailTemplate(validInput)).rejects.toThrow("Platform admin access required");
});

it("sends tests through system transport only", async () => {
	getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "admin", email: "admin@example.com" } });
	sendEmailMock.mockResolvedValue({ success: true, messageId: "message_1" });
	const { sendPlatformSystemEmailTemplateTest } = await import("./actions");

	await expect(sendPlatformSystemEmailTemplateTest(validInput)).resolves.toEqual({ success: true });
	expect(sendEmailMock).toHaveBeenCalledWith(expect.not.objectContaining({ organizationId: expect.anything() }));
});
```

- [ ] **Step 7: Verify Task 4**

Run:

```bash
pnpm --filter webapp test -- src/lib/email/system-template-renderer.test.ts 'src/app/[locale]/(admin)/platform-admin/system-email-templates/actions.test.ts'
```

Expected: tests pass.

- [ ] **Step 8: Checkpoint**

Do not commit unless the user explicitly asks. Record changed files in your handoff.

## Task 5: Platform Admin UI For System Email Templates

**Files:**
- Create: `apps/webapp/src/components/platform-admin/system-email-templates/system-email-template-settings-client.tsx`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/system-email-templates/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`

- [ ] **Step 1: Add nav/overview source tests**

Extend `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`:

```ts
it("links to platform system email templates from navigation and overview", () => {
	const layoutSource = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"));
	const overviewSource = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "page.tsx"), "utf8"));

	expect(layoutSource).toContain('href: "/platform-admin/system-email-templates"');
	expect(layoutSource).toContain('admin:admin.layout.nav.systemEmailTemplates');
	expect(overviewSource).toContain('href="/platform-admin/system-email-templates"');
	expect(overviewSource).toContain('"System Email Templates"');
});
```

- [ ] **Step 2: Run the nav test and verify it fails**

Run: `pnpm --filter webapp test -- 'src/app/[locale]/(admin)/platform-admin/layout.test.ts'`

Expected before implementation: new assertions fail.

- [ ] **Step 3: Create platform client component**

Create `apps/webapp/src/components/platform-admin/system-email-templates/system-email-template-settings-client.tsx` by adapting `EmailTemplateSettingsClient`. Change imports to platform actions:

```tsx
import {
	resetPlatformSystemEmailTemplate,
	savePlatformSystemEmailTemplate,
	sendPlatformSystemEmailTemplateTest,
} from "@/app/[locale]/(admin)/platform-admin/system-email-templates/actions";
```

Use `PlatformSystemEmailTemplateKey` instead of `EmailTemplateKey`, and keep `EmailTemplateEditor` plus `EmailTemplateList` for UI consistency. Keep button labels as `Save System Template`, `Send Test`, and `Reset To Default`.

- [ ] **Step 4: Create platform admin page**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/system-email-templates/page.tsx`:

```tsx
import type { Metadata } from "next";
import { connection } from "next/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SystemEmailTemplateSettingsClient } from "@/components/platform-admin/system-email-templates/system-email-template-settings-client";
import { getTranslate } from "@/tolgee/server";
import { listPlatformSystemEmailTemplates } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslate();
	return {
		title: t("admin:admin.systemEmailTemplates.title", "System Email Templates"),
		description: t("admin:admin.systemEmailTemplates.description", "Customize platform-owned system emails."),
	};
}

export default async function PlatformSystemEmailTemplatesPage() {
	await connection();
	const templates = await listPlatformSystemEmailTemplates();

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>System Email Templates</CardTitle>
					<CardDescription>
						Customize platform-owned billing emails. These templates use system email transport only.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<SystemEmailTemplateSettingsClient
						templates={templates.map(({ override, ...definition }) => ({ definition, override }))}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 5: Add nav item**

Modify `apps/webapp/src/app/[locale]/(admin)/layout.tsx` nav items to include:

```tsx
{
	href: "/platform-admin/system-email-templates",
	icon: "settings",
	label: t("admin:admin.layout.nav.systemEmailTemplates", "System Email Templates"),
},
```

- [ ] **Step 6: Add overview card**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx` to add a link card to `/platform-admin/system-email-templates` with visible text `System Email Templates` and an icon from `@tabler/icons-react`, such as `IconMailCog`, with `aria-hidden="true"`.

- [ ] **Step 7: Verify Task 5**

Run:

```bash
pnpm --filter webapp test -- 'src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: test passes.

- [ ] **Step 8: Checkpoint**

Do not commit unless the user explicitly asks. Record changed files in your handoff.

## Task 6: Billing System Email Sender And Stripe Event Hooks

**Files:**
- Create: `apps/webapp/src/lib/billing/billing-system-email.ts`
- Create: `apps/webapp/src/lib/billing/billing-system-email.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/billing/billing-events.service.ts`

- [ ] **Step 1: Write billing email sender tests**

Create `apps/webapp/src/lib/billing/billing-system-email.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email/email-service";
import { renderPlatformSystemEmailTemplate } from "@/lib/email/system-template-renderer";

vi.mock("@/lib/email/email-service", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/system-template-renderer", () => ({ renderPlatformSystemEmailTemplate: vi.fn() }));

const sendEmailMock = vi.mocked(sendEmail);
const renderTemplateMock = vi.mocked(renderPlatformSystemEmailTemplate);

describe("sendBillingSystemEmail", () => {
	beforeEach(() => {
		sendEmailMock.mockReset();
		renderTemplateMock.mockReset();
	});

	it("sends through system transport only", async () => {
		renderTemplateMock.mockResolvedValue({ subject: "Subject", html: "<p>Body</p>", usedOverride: false });
		sendEmailMock.mockResolvedValue({ success: true, messageId: "msg_1" });
		const { sendBillingSystemEmail } = await import("./billing-system-email");

		await expect(
			sendBillingSystemEmail({
				templateKey: "billing-payment-failed",
				to: "billing@example.com",
				data: { organizationName: "Acme" },
			}),
		).resolves.toEqual({ sent: true });

		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "billing@example.com",
			subject: "Subject",
			html: "<p>Body</p>",
		});
	});

	it("skips missing recipients without throwing", async () => {
		const { sendBillingSystemEmail } = await import("./billing-system-email");

		await expect(
			sendBillingSystemEmail({
				templateKey: "billing-payment-failed",
				to: null,
				data: {},
			}),
		).resolves.toEqual({ sent: false, reason: "missing-recipient" });

		expect(sendEmailMock).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Implement billing sender**

Create `apps/webapp/src/lib/billing/billing-system-email.ts`:

```ts
import type { PlatformSystemEmailTemplateKey } from "@/db/schema";
import { sendEmail } from "@/lib/email/email-service";
import { renderPlatformSystemEmailTemplate } from "@/lib/email/system-template-renderer";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BillingSystemEmail");

export interface SendBillingSystemEmailInput {
	templateKey: PlatformSystemEmailTemplateKey;
	to: string | null | undefined;
	data: Record<string, unknown>;
}

export async function sendBillingSystemEmail({ templateKey, to, data }: SendBillingSystemEmailInput) {
	if (!to) {
		logger.warn({ templateKey }, "Skipping billing system email without recipient");
		return { sent: false as const, reason: "missing-recipient" as const };
	}

	try {
		const rendered = await renderPlatformSystemEmailTemplate({ templateKey, data });
		const result = await sendEmail({ to, subject: rendered.subject, html: rendered.html });
		return result.success
			? { sent: true as const }
			: { sent: false as const, reason: "send-failed" as const };
	} catch (error) {
		logger.error({ error, templateKey }, "Failed to send billing system email");
		return { sent: false as const, reason: "send-failed" as const };
	}
}
```

- [ ] **Step 3: Add helper functions inside billing event service**

Modify `apps/webapp/src/lib/effect/services/billing/billing-events.service.ts` imports:

```ts
import { sendBillingSystemEmail } from "@/lib/billing/billing-system-email";
```

Inside the service layer, add helper functions near other local handlers:

```ts
const getSubscriptionRowByStripeSubscriptionId = (stripeSubscriptionId: string) =>
	Effect.tryPromise({
		try: () => db.query.subscription.findFirst({ where: eq(subscription.stripeSubscriptionId, stripeSubscriptionId) }),
		catch: (error) =>
			new DatabaseError({
				message: "Failed to load subscription for billing email",
				operation: "getSubscriptionRowByStripeSubscriptionId",
				table: "subscription",
				cause: error,
			}),
	});

const sendBillingMail = (input: Parameters<typeof sendBillingSystemEmail>[0]) =>
	Effect.promise(() => sendBillingSystemEmail(input)).pipe(Effect.asVoid);
```

- [ ] **Step 4: Replace trial/paused/resumed/invoice/payment TODOs**

For each TODO block, call `sendBillingMail` after state/logging. Build data with the available Stripe fields. Example for payment failed:

```ts
yield* sendBillingMail({
	templateKey: "billing-payment-failed",
	to: lastError?.payment_method?.billing_details?.email ?? null,
	data: {
		organizationName: subscriptionId ?? "your organization",
		customerEmail: lastError?.payment_method?.billing_details?.email ?? "",
		billingPortalUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.z8-time.app"}/settings/billing`,
		failureReason: failureMessage,
	},
});
```

For subscription events, resolve the local row by `stripeSub.id`; if a customer email is not expanded on the Stripe object, use `stripeService.getCustomer(customerId)` and `customer.email`. Keep all email calls non-blocking to webhook success by relying on `sendBillingSystemEmail` returning failure results instead of throwing.

- [ ] **Step 5: Verify billing sender tests**

Run:

```bash
pnpm --filter webapp test -- src/lib/billing/billing-system-email.test.ts
```

Expected: test passes.

- [ ] **Step 6: Run billing event service tests**

Run:

```bash
pnpm --filter webapp test -- src/lib/effect/services/billing/billing-events.service.test.ts
```

Expected: existing tests pass. If tests need a mock for `@/lib/billing/billing-system-email`, add:

```ts
vi.mock("@/lib/billing/billing-system-email", () => ({
	sendBillingSystemEmail: vi.fn(() => Promise.resolve({ sent: true })),
}));
```

- [ ] **Step 7: Checkpoint**

Do not commit unless the user explicitly asks. Record changed files in your handoff.

## Task 7: Final Verification

**Files:**
- All changed files from Tasks 1-6.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter webapp test -- \
  src/components/app-sidebar.test.tsx \
  src/lib/calendar-sync/providers/index.test.ts \
  src/lib/cleanup.test.ts \
  src/lib/audit/cleanup.test.ts \
  src/lib/email/system-template-registry.test.ts \
  src/lib/email/system-template-renderer.test.ts \
  src/lib/billing/billing-system-email.test.ts \
  'src/app/[locale]/(admin)/platform-admin/layout.test.ts' \
  'src/app/[locale]/(admin)/platform-admin/system-email-templates/actions.test.ts'
```

Expected: all listed tests pass.

- [ ] **Step 2: Run full webapp tests if focused tests pass**

Run: `pnpm --filter webapp test`

Expected: test suite passes. If unrelated pre-existing failures appear, record exact failing test names and error snippets.

- [ ] **Step 3: Run build only if no environment-variable blocker appears**

Run: `CI=true pnpm --filter webapp build`

Expected: build passes. If Phase CLI/system secrets are required and unavailable, skip and report that the build was skipped because agents do not have Phase CLI variables.

- [ ] **Step 4: Review security-sensitive behavior**

Confirm by inspection:

```ts
// Billing system email sends without organizationId.
sendEmail({ to, subject: rendered.subject, html: rendered.html });
```

Confirm platform admin writes require `session.user.role === "admin"` before DB writes.

- [ ] **Step 5: Final handoff**

Report:

- Files changed.
- Tests run and results.
- Build result or skip reason.
- Any follow-up, especially if platform-admin UI needs copy/i18n expansion beyond fallback strings.

Do not commit unless the user explicitly asks.

## Self-Review Notes

- Spec coverage: sidebar, calendar registry, cleanup jobs, platform system templates, platform admin editor, billing system email delivery, security constraints, and tests are covered by Tasks 1-7.
- Placeholder scan: no implementation step uses `TBD`, `TODO`, or unspecified follow-up work.
- Type consistency: platform system template key names match the approved design and are reused consistently across schema, registry, renderer, actions, and billing sender.
