# Custom Email Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build org-scoped custom email template overrides for all current system emails, with `@react-email/editor` editing, fixed system variables, safe runtime fallback, and org-admin settings access.

**Architecture:** Add a focused email-template override layer: schema + registry + validation + render resolver + settings UI. Existing React Email templates remain the default renderers, and existing email transports remain responsible for SMTP/Resend selection. Runtime email sending asks the resolver for a subject/body by template key and organization, then falls back to the default renderer if no valid override exists.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, Vitest, `@react-email/render`, `@react-email/editor`, TanStack Form where form state is needed, existing settings and auth helper patterns.

---

## File Structure

- Create: `apps/webapp/src/db/schema/email-template.ts` - Drizzle table and shared template-key type storage for organization template overrides.
- Modify: `apps/webapp/src/db/schema/index.ts` - Export the new schema file.
- Modify: `apps/webapp/src/db/schema/relations.ts` - Add organization/template relations only if the existing relation style needs them for queries.
- Create: `apps/webapp/src/lib/email/template-registry.ts` - Template keys, categories, default subjects, allowed variables, preview data, and default renderer mapping.
- Create: `apps/webapp/src/lib/email/template-validation.ts` - Placeholder extraction, validation, HTML escaping, and safe interpolation.
- Create: `apps/webapp/src/lib/email/template-overrides.ts` - DB-backed load/save/reset helpers scoped by organization.
- Create: `apps/webapp/src/lib/email/template-renderer.ts` - Override-aware render entry point with fallback to system renderers.
- Modify: `apps/webapp/src/lib/email/sender.ts` - Use the override-aware renderer for queued template emails and pass `organizationId` through queue job data.
- Modify: `apps/webapp/src/lib/queue/index.ts` - Add optional `organizationId` to `EmailJobData`.
- Modify: `apps/webapp/src/lib/notifications/email-notifications.ts` - Route notification emails through template keys instead of manually choosing subject/html.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/page.tsx` - Org-admin settings page shell.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.ts` - Server actions for list/get/save/reset/test-send with org-admin checks.
- Create: `apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx` - Client page layout and selection state.
- Create: `apps/webapp/src/components/settings/email-templates/email-template-editor.tsx` - Wrapped `@react-email/editor` integration, subject editor, validation state, save/reset/test controls.
- Create: `apps/webapp/src/components/settings/email-templates/email-template-list.tsx` - Grouped template list with status badges.
- Create: `apps/webapp/src/components/settings/email-templates/variable-palette.tsx` - Allowed variable display and insertion affordance.
- Modify: `apps/webapp/src/components/settings/settings-config.ts` - Add the `Email Templates` settings entry for `orgAdmin`.
- Modify: `apps/webapp/src/lib/settings-access.ts` - Add `/settings/email-templates` to org-admin route list.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts` - Update access alignment tests for the new route.
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts` - Test the new setting visibility.
- Modify: `apps/webapp/messages/settings/en.json` - Add settings UI copy.
- Test: `apps/webapp/src/lib/email/template-registry.test.ts`
- Test: `apps/webapp/src/lib/email/template-validation.test.ts`
- Test: `apps/webapp/src/lib/email/template-renderer.test.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.test.ts`
- Test: `apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx`

## Task 1: Add The Org-Scoped Template Schema

**Files:**
- Create: `apps/webapp/src/db/schema/email-template.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Test: Typecheck/build coverage in later tasks; this task is schema-only.

- [ ] **Step 1: Create the schema file**

Create `apps/webapp/src/db/schema/email-template.ts` with:

```ts
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";

export const EMAIL_TEMPLATE_KEYS = [
	"email-verification",
	"password-reset",
	"organization-invitation",
	"absence-request-submitted",
	"absence-request-pending-approval",
	"absence-request-approved",
	"absence-request-rejected",
	"time-correction-pending-approval",
	"time-correction-approved",
	"time-correction-rejected",
	"team-member-added",
	"team-member-removed",
	"security-alert",
	"export-ready",
	"export-failed",
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export type EmailTemplateEditorDocument = Record<string, unknown>;

export const organizationEmailTemplate = pgTable(
	"organization_email_template",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		templateKey: text("template_key").$type<EmailTemplateKey>().notNull(),
		subject: text("subject").notNull(),
		editorDocument: jsonb("editor_document").$type<EmailTemplateEditorDocument>().notNull(),
		html: text("html").notNull(),
		plainText: text("plain_text"),
		isEnabled: boolean("is_enabled").default(true).notNull(),
		createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
		updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("organizationEmailTemplate_org_template_idx").on(
			table.organizationId,
			table.templateKey,
		),
		index("organizationEmailTemplate_organizationId_idx").on(table.organizationId),
	],
);
```

- [ ] **Step 2: Export the schema**

Modify `apps/webapp/src/db/schema/index.ts` and add near the existing email/enterprise exports:

```ts
export * from "./email-template";
```

- [ ] **Step 3: Run focused type/schema tests**

Run from `apps/webapp`:

```bash
pnpm test src/db/schema/import-review.test.ts
```

Expected: PASS. This does not test the new table directly; it verifies schema imports still load under Vitest.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/email-template.ts src/db/schema/index.ts
git commit -m "feat: add organization email template schema"
```

## Task 2: Add Template Registry And Completeness Tests

**Files:**
- Create: `apps/webapp/src/lib/email/template-registry.ts`
- Create: `apps/webapp/src/lib/email/template-registry.test.ts`

- [ ] **Step 1: Write the registry completeness test**

Create `apps/webapp/src/lib/email/template-registry.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATE_KEYS } from "@/db/schema";
import { EMAIL_TEMPLATE_REGISTRY, getEmailTemplateDefinition } from "./template-registry";

describe("email template registry", () => {
	it("registers every supported template key", () => {
		expect(EMAIL_TEMPLATE_REGISTRY.map((entry) => entry.key)).toEqual(EMAIL_TEMPLATE_KEYS);
	});

	it("defines subjects, variables, preview data, and renderers for every template", async () => {
		for (const key of EMAIL_TEMPLATE_KEYS) {
			const definition = getEmailTemplateDefinition(key);

			expect(definition.defaultSubject.trim()).not.toBe("");
			expect(definition.label.trim()).not.toBe("");
			expect(definition.description.trim()).not.toBe("");
			expect(definition.variables.length).toBeGreaterThan(0);
			expect(definition.previewData).toEqual(expect.any(Object));

			const rendered = await definition.renderDefault(definition.previewData as never);
			expect(rendered).toContain("<");
		}
	});

	it("throws for unknown template keys", () => {
		expect(() => getEmailTemplateDefinition("unknown" as never)).toThrow("Unknown email template key");
	});
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `apps/webapp`:

```bash
pnpm test src/lib/email/template-registry.test.ts
```

Expected: FAIL because `template-registry.ts` does not exist.

- [ ] **Step 3: Create the registry implementation**

Create `apps/webapp/src/lib/email/template-registry.ts`. Use this structure and include all template keys from `EMAIL_TEMPLATE_KEYS`:

```ts
import type { EmailTemplateKey } from "@/db/schema";
import {
	renderAbsenceRequestApproved,
	renderAbsenceRequestPendingApproval,
	renderAbsenceRequestRejected,
	renderAbsenceRequestSubmitted,
	renderEmailVerification,
	renderExportFailed,
	renderExportReady,
	renderOrganizationInvitation,
	renderPasswordReset,
	renderSecurityAlert,
	renderTeamMemberAdded,
	renderTeamMemberRemoved,
	renderTimeCorrectionApproved,
	renderTimeCorrectionPendingApproval,
	renderTimeCorrectionRejected,
} from "./render";

export type EmailTemplateCategory = "auth" | "absences" | "time-corrections" | "teams" | "security" | "exports";

export interface EmailTemplateVariableDefinition {
	name: string;
	label: string;
	description: string;
	example: string;
}

export interface EmailTemplateDefinition<TData extends Record<string, unknown> = Record<string, unknown>> {
	key: EmailTemplateKey;
	category: EmailTemplateCategory;
	label: string;
	description: string;
	defaultSubject: string;
	variables: EmailTemplateVariableDefinition[];
	previewData: TData;
	renderDefault: (data: TData) => Promise<string>;
}

const variable = (
	name: string,
	label: string,
	description: string,
	example: string,
): EmailTemplateVariableDefinition => ({ name, label, description, example });

export const EMAIL_TEMPLATE_REGISTRY = [
	{
		key: "email-verification",
		category: "auth",
		label: "Email verification",
		description: "Sent when a user verifies their email address.",
		defaultSubject: "Verify your email address",
		variables: [
			variable("userName", "User name", "Recipient display name.", "Alex Morgan"),
			variable("verificationUrl", "Verification URL", "Secure verification link.", "https://app.z8-time.app/verify?token=sample"),
			variable("appUrl", "App URL", "Organization app URL.", "https://app.z8-time.app"),
		],
		previewData: {
			userName: "Alex Morgan",
			verificationUrl: "https://app.z8-time.app/verify?token=sample",
			appUrl: "https://app.z8-time.app",
		},
		renderDefault: renderEmailVerification,
	},
	{
		key: "password-reset",
		category: "auth",
		label: "Password reset",
		description: "Sent when a user requests a password reset.",
		defaultSubject: "Reset your password",
		variables: [
			variable("userName", "User name", "Recipient display name.", "Alex Morgan"),
			variable("resetUrl", "Reset URL", "Secure password reset link.", "https://app.z8-time.app/reset-password?token=sample"),
		],
		previewData: { userName: "Alex Morgan", resetUrl: "https://app.z8-time.app/reset-password?token=sample" },
		renderDefault: renderPasswordReset,
	},
	{
		key: "organization-invitation",
		category: "auth",
		label: "Organization invitation",
		description: "Sent when a user is invited to an organization.",
		defaultSubject: "You have been invited to {{organizationName}}",
		variables: [
			variable("email", "Email", "Invited email address.", "alex@example.com"),
			variable("organizationName", "Organization", "Organization name.", "Acme Operations"),
			variable("inviterName", "Inviter", "Name of the inviting user.", "Jordan Lee"),
			variable("role", "Role", "Assigned organization role.", "member"),
			variable("invitationUrl", "Invitation URL", "Secure invitation acceptance link.", "https://app.z8-time.app/invite/sample"),
		],
		previewData: {
			email: "alex@example.com",
			organizationName: "Acme Operations",
			inviterName: "Jordan Lee",
			role: "member",
			invitationUrl: "https://app.z8-time.app/invite/sample",
		},
		renderDefault: renderOrganizationInvitation,
	},
	{
		key: "absence-request-submitted",
		category: "absences",
		label: "Absence request submitted",
		description: "Sent to an employee after submitting an absence request.",
		defaultSubject: "Absence Request Submitted",
		variables: [
			variable("employeeName", "Employee", "Employee display name.", "Alex Morgan"),
			variable("startDate", "Start date", "Absence start date.", "May 3, 2026"),
			variable("endDate", "End date", "Absence end date.", "May 7, 2026"),
			variable("absenceType", "Absence type", "Type of absence.", "Vacation"),
			variable("days", "Days", "Requested number of days.", "5"),
			variable("managerName", "Manager", "Manager display name.", "Jordan Lee"),
			variable("appUrl", "App URL", "Organization app URL.", "https://app.z8-time.app"),
		],
		previewData: { employeeName: "Alex Morgan", startDate: "May 3, 2026", endDate: "May 7, 2026", absenceType: "Vacation", days: 5, managerName: "Jordan Lee", appUrl: "https://app.z8-time.app" },
		renderDefault: renderAbsenceRequestSubmitted,
	},
	{
		key: "absence-request-pending-approval",
		category: "absences",
		label: "Absence pending approval",
		description: "Sent to a manager when an absence request needs approval.",
		defaultSubject: "New Absence Request Pending Approval",
		variables: [
			variable("managerName", "Manager", "Manager display name.", "Jordan Lee"),
			variable("employeeName", "Employee", "Employee display name.", "Alex Morgan"),
			variable("startDate", "Start date", "Absence start date.", "May 3, 2026"),
			variable("endDate", "End date", "Absence end date.", "May 7, 2026"),
			variable("absenceType", "Absence type", "Type of absence.", "Vacation"),
			variable("days", "Days", "Requested number of days.", "5"),
			variable("notes", "Notes", "Optional request notes.", "Family trip"),
			variable("approvalUrl", "Approval URL", "Approvals page URL.", "https://app.z8-time.app/approvals"),
		],
		previewData: { managerName: "Jordan Lee", employeeName: "Alex Morgan", startDate: "May 3, 2026", endDate: "May 7, 2026", absenceType: "Vacation", days: 5, notes: "Family trip", approvalUrl: "https://app.z8-time.app/approvals" },
		renderDefault: renderAbsenceRequestPendingApproval,
	},
	{
		key: "absence-request-approved",
		category: "absences",
		label: "Absence request approved",
		description: "Sent when an absence request is approved.",
		defaultSubject: "Absence Request Approved",
		variables: [variable("employeeName", "Employee", "Employee display name.", "Alex Morgan"), variable("approverName", "Approver", "Approver display name.", "Jordan Lee"), variable("startDate", "Start date", "Absence start date.", "May 3, 2026"), variable("endDate", "End date", "Absence end date.", "May 7, 2026"), variable("absenceType", "Absence type", "Type of absence.", "Vacation"), variable("days", "Days", "Approved number of days.", "5"), variable("appUrl", "App URL", "Organization app URL.", "https://app.z8-time.app")],
		previewData: { employeeName: "Alex Morgan", approverName: "Jordan Lee", startDate: "May 3, 2026", endDate: "May 7, 2026", absenceType: "Vacation", days: 5, appUrl: "https://app.z8-time.app" },
		renderDefault: renderAbsenceRequestApproved,
	},
	{
		key: "absence-request-rejected",
		category: "absences",
		label: "Absence request rejected",
		description: "Sent when an absence request is rejected.",
		defaultSubject: "Absence Request Rejected",
		variables: [variable("employeeName", "Employee", "Employee display name.", "Alex Morgan"), variable("approverName", "Approver", "Approver display name.", "Jordan Lee"), variable("startDate", "Start date", "Absence start date.", "May 3, 2026"), variable("endDate", "End date", "Absence end date.", "May 7, 2026"), variable("absenceType", "Absence type", "Type of absence.", "Vacation"), variable("days", "Days", "Rejected number of days.", "5"), variable("rejectionReason", "Rejection reason", "Reason provided by approver.", "Staffing coverage is too low"), variable("appUrl", "App URL", "Organization app URL.", "https://app.z8-time.app")],
		previewData: { employeeName: "Alex Morgan", approverName: "Jordan Lee", startDate: "May 3, 2026", endDate: "May 7, 2026", absenceType: "Vacation", days: 5, rejectionReason: "Staffing coverage is too low", appUrl: "https://app.z8-time.app" },
		renderDefault: renderAbsenceRequestRejected,
	},
	{
		key: "time-correction-pending-approval",
		category: "time-corrections",
		label: "Time correction pending approval",
		description: "Sent to a manager when a time correction needs approval.",
		defaultSubject: "New Time Correction Pending Approval",
		variables: [variable("managerName", "Manager", "Manager display name.", "Jordan Lee"), variable("employeeName", "Employee", "Employee display name.", "Alex Morgan"), variable("date", "Date", "Correction date.", "May 3, 2026"), variable("originalClockIn", "Original clock-in", "Original clock-in time.", "08:00"), variable("originalClockOut", "Original clock-out", "Original clock-out time.", "16:30"), variable("correctedClockIn", "Corrected clock-in", "Requested clock-in time.", "08:15"), variable("correctedClockOut", "Corrected clock-out", "Requested clock-out time.", "16:45"), variable("reason", "Reason", "Employee correction reason.", "Forgot to clock out"), variable("approvalUrl", "Approval URL", "Approvals page URL.", "https://app.z8-time.app/approvals")],
		previewData: { managerName: "Jordan Lee", employeeName: "Alex Morgan", date: "May 3, 2026", originalClockIn: "08:00", originalClockOut: "16:30", correctedClockIn: "08:15", correctedClockOut: "16:45", reason: "Forgot to clock out", approvalUrl: "https://app.z8-time.app/approvals" },
		renderDefault: renderTimeCorrectionPendingApproval,
	},
	{
		key: "time-correction-approved",
		category: "time-corrections",
		label: "Time correction approved",
		description: "Sent when a time correction is approved.",
		defaultSubject: "Time Correction Approved",
		variables: [variable("employeeName", "Employee", "Employee display name.", "Alex Morgan"), variable("approverName", "Approver", "Approver display name.", "Jordan Lee"), variable("date", "Date", "Correction date.", "May 3, 2026"), variable("correctedClockIn", "Corrected clock-in", "Approved clock-in time.", "08:15"), variable("correctedClockOut", "Corrected clock-out", "Approved clock-out time.", "16:45"), variable("appUrl", "App URL", "Organization app URL.", "https://app.z8-time.app")],
		previewData: { employeeName: "Alex Morgan", approverName: "Jordan Lee", date: "May 3, 2026", correctedClockIn: "08:15", correctedClockOut: "16:45", appUrl: "https://app.z8-time.app" },
		renderDefault: renderTimeCorrectionApproved,
	},
	{
		key: "time-correction-rejected",
		category: "time-corrections",
		label: "Time correction rejected",
		description: "Sent when a time correction is rejected.",
		defaultSubject: "Time Correction Rejected",
		variables: [variable("employeeName", "Employee", "Employee display name.", "Alex Morgan"), variable("approverName", "Approver", "Approver display name.", "Jordan Lee"), variable("date", "Date", "Correction date.", "May 3, 2026"), variable("correctedClockIn", "Corrected clock-in", "Requested clock-in time.", "08:15"), variable("correctedClockOut", "Corrected clock-out", "Requested clock-out time.", "16:45"), variable("rejectionReason", "Rejection reason", "Reason provided by approver.", "Insufficient explanation"), variable("appUrl", "App URL", "Organization app URL.", "https://app.z8-time.app")],
		previewData: { employeeName: "Alex Morgan", approverName: "Jordan Lee", date: "May 3, 2026", correctedClockIn: "08:15", correctedClockOut: "16:45", rejectionReason: "Insufficient explanation", appUrl: "https://app.z8-time.app" },
		renderDefault: renderTimeCorrectionRejected,
	},
	{
		key: "team-member-added",
		category: "teams",
		label: "Team member added",
		description: "Sent when a user is added to a team.",
		defaultSubject: "You've been added to {{teamName}}",
		variables: [variable("memberName", "Member", "Member display name.", "Alex Morgan"), variable("teamName", "Team", "Team name.", "Front Desk"), variable("addedByName", "Added by", "Admin or manager display name.", "Jordan Lee"), variable("teamUrl", "Team URL", "Team settings URL.", "https://app.z8-time.app/settings/teams/team-1"), variable("appUrl", "App URL", "Organization app URL.", "https://app.z8-time.app")],
		previewData: { memberName: "Alex Morgan", teamName: "Front Desk", addedByName: "Jordan Lee", teamUrl: "https://app.z8-time.app/settings/teams/team-1", appUrl: "https://app.z8-time.app" },
		renderDefault: renderTeamMemberAdded,
	},
	{
		key: "team-member-removed",
		category: "teams",
		label: "Team member removed",
		description: "Sent when a user is removed from a team.",
		defaultSubject: "You've been removed from {{teamName}}",
		variables: [variable("memberName", "Member", "Member display name.", "Alex Morgan"), variable("teamName", "Team", "Team name.", "Front Desk"), variable("removedByName", "Removed by", "Admin or manager display name.", "Jordan Lee"), variable("appUrl", "App URL", "Organization app URL.", "https://app.z8-time.app")],
		previewData: { memberName: "Alex Morgan", teamName: "Front Desk", removedByName: "Jordan Lee", appUrl: "https://app.z8-time.app" },
		renderDefault: renderTeamMemberRemoved,
	},
	{
		key: "security-alert",
		category: "security",
		label: "Security alert",
		description: "Sent for important account security events.",
		defaultSubject: "Security alert for your account",
		variables: [variable("userName", "User name", "Recipient display name.", "Alex Morgan"), variable("eventType", "Event type", "Security event identifier.", "password_changed"), variable("timestamp", "Timestamp", "Event timestamp.", "Apr 29, 2026 10:30"), variable("ipAddress", "IP address", "Event source IP when available.", "203.0.113.10"), variable("userAgent", "User agent", "Browser/device details when available.", "Chrome on Windows"), variable("securitySettingsUrl", "Security settings URL", "Security settings page URL.", "https://app.z8-time.app/settings/security"), variable("appUrl", "App URL", "Organization app URL.", "https://app.z8-time.app")],
		previewData: { userName: "Alex Morgan", eventType: "password_changed", timestamp: "Apr 29, 2026 10:30", ipAddress: "203.0.113.10", userAgent: "Chrome on Windows", securitySettingsUrl: "https://app.z8-time.app/settings/security", appUrl: "https://app.z8-time.app" },
		renderDefault: renderSecurityAlert,
	},
	{
		key: "export-ready",
		category: "exports",
		label: "Export ready",
		description: "Sent when an export is ready to download.",
		defaultSubject: "Your export is ready",
		variables: [variable("recipientName", "Recipient", "Recipient display name.", "Alex Morgan"), variable("organizationName", "Organization", "Organization name.", "Acme Operations"), variable("categories", "Categories", "Export categories.", "Timesheets, Absences"), variable("fileSize", "File size", "Generated file size.", "1.4 MB"), variable("downloadUrl", "Download URL", "Secure download link.", "https://app.z8-time.app/exports/download/sample"), variable("expiresAt", "Expires at", "Download link expiry.", "May 6, 2026")],
		previewData: { recipientName: "Alex Morgan", organizationName: "Acme Operations", categories: ["Timesheets", "Absences"], fileSize: "1.4 MB", downloadUrl: "https://app.z8-time.app/exports/download/sample", expiresAt: "May 6, 2026" },
		renderDefault: renderExportReady,
	},
	{
		key: "export-failed",
		category: "exports",
		label: "Export failed",
		description: "Sent when an export fails.",
		defaultSubject: "Your export failed",
		variables: [variable("recipientName", "Recipient", "Recipient display name.", "Alex Morgan"), variable("organizationName", "Organization", "Organization name.", "Acme Operations"), variable("categories", "Categories", "Export categories.", "Timesheets, Absences"), variable("errorMessage", "Error message", "Safe failure summary.", "The export could not be generated."), variable("retryUrl", "Retry URL", "Export settings URL.", "https://app.z8-time.app/settings/export")],
		previewData: { recipientName: "Alex Morgan", organizationName: "Acme Operations", categories: ["Timesheets", "Absences"], errorMessage: "The export could not be generated.", retryUrl: "https://app.z8-time.app/settings/export" },
		renderDefault: renderExportFailed,
	},
] satisfies EmailTemplateDefinition[];

export function getEmailTemplateDefinition(key: EmailTemplateKey): EmailTemplateDefinition {
	const definition = EMAIL_TEMPLATE_REGISTRY.find((entry) => entry.key === key);
	if (!definition) {
		throw new Error(`Unknown email template key: ${key}`);
	}
	return definition;
}
```

- [ ] **Step 4: Run the registry test**

Run from `apps/webapp`:

```bash
pnpm test src/lib/email/template-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/template-registry.ts src/lib/email/template-registry.test.ts
git commit -m "feat: register email template definitions"
```

## Task 3: Add Placeholder Validation And Interpolation

**Files:**
- Create: `apps/webapp/src/lib/email/template-validation.ts`
- Create: `apps/webapp/src/lib/email/template-validation.test.ts`

- [ ] **Step 1: Write validation tests**

Create `apps/webapp/src/lib/email/template-validation.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
	escapeHtml,
	extractTemplateVariables,
	interpolateTemplate,
	sanitizeEmailHtml,
	validateTemplateContent,
} from "./template-validation";

const allowedVariables = [
	{ name: "employeeName", label: "Employee", description: "Employee name", example: "Alex" },
	{ name: "approvalUrl", label: "Approval URL", description: "Approval URL", example: "https://example.com" },
];

describe("email template validation", () => {
	it("extracts variables from subject and body", () => {
		expect(extractTemplateVariables("Hi {{employeeName}}, open {{approvalUrl}}"))
			.toEqual(["employeeName", "approvalUrl"]);
	});

	it("rejects unknown variables", () => {
		const result = validateTemplateContent({
			subject: "Hi {{employeeName}}",
			html: "<p>{{secretToken}}</p>",
			allowedVariables,
		});

		expect(result.success).toBe(false);
		expect(result.errors).toContain("Unknown variable: secretToken");
	});

	it("rejects malformed variable syntax", () => {
		const result = validateTemplateContent({
			subject: "Hi {{employeeName}",
			html: "<p>Body</p>",
			allowedVariables,
		});

		expect(result.success).toBe(false);
		expect(result.errors).toContain("Malformed variable placeholder syntax");
	});

	it("escapes interpolated values", () => {
		expect(escapeHtml('<script>alert("x")</script>')).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
	});

	it("interpolates arrays as comma-separated escaped values", () => {
		expect(interpolateTemplate("Categories: {{categories}}", { categories: ["A", "B<script>"] }))
			.toBe("Categories: A, B&lt;script&gt;");
	});

	it("removes executable html before storage or send", () => {
		expect(sanitizeEmailHtml('<p onclick="alert(1)">Hi</p><script>alert(1)</script><img src="x" onerror="alert(1)">'))
			.toBe('<p>Hi</p><img src="x">');
	});
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `apps/webapp`:

```bash
pnpm test src/lib/email/template-validation.test.ts
```

Expected: FAIL because `template-validation.ts` does not exist.

- [ ] **Step 3: Implement validation**

Create `apps/webapp/src/lib/email/template-validation.ts` with:

```ts
import type { EmailTemplateVariableDefinition } from "./template-registry";

const VARIABLE_PATTERN = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;
const MAX_SUBJECT_LENGTH = 180;
const MAX_HTML_LENGTH = 200_000;

export interface TemplateValidationInput {
	subject: string;
	html: string;
	allowedVariables: EmailTemplateVariableDefinition[];
}

export interface TemplateValidationResult {
	success: boolean;
	errors: string[];
}

export function extractTemplateVariables(content: string): string[] {
	const variables = new Set<string>();
	for (const match of content.matchAll(VARIABLE_PATTERN)) {
		variables.add(match[1]);
	}
	return [...variables];
}

function hasMalformedPlaceholder(content: string): boolean {
	const withoutValidPlaceholders = content.replace(VARIABLE_PATTERN, "");
	return withoutValidPlaceholders.includes("{{") || withoutValidPlaceholders.includes("}}");
}

export function validateTemplateContent({
	subject,
	html,
	allowedVariables,
}: TemplateValidationInput): TemplateValidationResult {
	const errors: string[] = [];
	const trimmedSubject = subject.trim();
	const trimmedHtml = html.trim();

	if (!trimmedSubject) errors.push("Subject is required");
	if (trimmedSubject.length > MAX_SUBJECT_LENGTH) errors.push(`Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer`);
	if (!trimmedHtml) errors.push("Email body is required");
	if (trimmedHtml.length > MAX_HTML_LENGTH) errors.push(`Email body must be ${MAX_HTML_LENGTH} characters or fewer`);
	if (hasMalformedPlaceholder(subject) || hasMalformedPlaceholder(html)) errors.push("Malformed variable placeholder syntax");

	const allowedNames = new Set(allowedVariables.map((variable) => variable.name));
	for (const variableName of [...extractTemplateVariables(subject), ...extractTemplateVariables(html)]) {
		if (!allowedNames.has(variableName)) {
			errors.push(`Unknown variable: ${variableName}`);
		}
	}

	return { success: errors.length === 0, errors: [...new Set(errors)] };
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function stringifyVariableValue(value: unknown): string {
	if (Array.isArray(value)) return value.map((item) => stringifyVariableValue(item)).join(", ");
	if (value === null || value === undefined) return "";
	return String(value);
}

export function interpolateTemplate(template: string, data: Record<string, unknown>): string {
	return template.replace(VARIABLE_PATTERN, (_match, variableName: string) =>
		escapeHtml(stringifyVariableValue(data[variableName])),
	);
}

export function sanitizeEmailHtml(html: string): string {
	return html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
		.replace(/\s+on[a-z]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
		.replace(/\s+href=("|')javascript:[^"']*("|')/gi, "")
		.replace(/\s+src=("|')javascript:[^"']*("|')/gi, "");
}
```

- [ ] **Step 4: Run validation tests**

Run from `apps/webapp`:

```bash
pnpm test src/lib/email/template-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/template-validation.ts src/lib/email/template-validation.test.ts
git commit -m "feat: validate email template variables"
```

## Task 4: Add Override Persistence And Rendering Fallback

**Files:**
- Create: `apps/webapp/src/lib/email/template-overrides.ts`
- Create: `apps/webapp/src/lib/email/template-renderer.ts`
- Create: `apps/webapp/src/lib/email/template-renderer.test.ts`

- [ ] **Step 1: Write renderer tests with mocked DB helpers**

Create `apps/webapp/src/lib/email/template-renderer.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderOrganizationEmailTemplate } from "./template-renderer";

vi.mock("./template-overrides", () => ({
	getEnabledOrganizationEmailTemplate: vi.fn(),
}));

const { getEnabledOrganizationEmailTemplate } = await import("./template-overrides");

describe("template renderer", () => {
	beforeEach(() => {
		vi.mocked(getEnabledOrganizationEmailTemplate).mockReset();
	});

	it("renders the default template when no organization id is provided", async () => {
		const result = await renderOrganizationEmailTemplate({
			templateKey: "password-reset",
			data: { userName: "Alex", resetUrl: "https://example.com/reset" },
		});

		expect(result.subject).toBe("Reset your password");
		expect(result.html).toContain("Alex");
		expect(getEnabledOrganizationEmailTemplate).not.toHaveBeenCalled();
	});

	it("uses a valid organization override", async () => {
		vi.mocked(getEnabledOrganizationEmailTemplate).mockResolvedValue({
			subject: "Reset password for {{userName}}",
			html: "<p>Use {{resetUrl}}</p>",
			plainText: null,
		});

		const result = await renderOrganizationEmailTemplate({
			organizationId: "org-1",
			templateKey: "password-reset",
			data: { userName: "Alex", resetUrl: "https://example.com/reset" },
		});

		expect(result.subject).toBe("Reset password for Alex");
		expect(result.html).toBe("<p>Use https://example.com/reset</p>");
	});

	it("falls back when override contains an unknown variable", async () => {
		vi.mocked(getEnabledOrganizationEmailTemplate).mockResolvedValue({
			subject: "Reset {{secret}}",
			html: "<p>{{resetUrl}}</p>",
			plainText: null,
		});

		const result = await renderOrganizationEmailTemplate({
			organizationId: "org-1",
			templateKey: "password-reset",
			data: { userName: "Alex", resetUrl: "https://example.com/reset" },
		});

		expect(result.subject).toBe("Reset your password");
		expect(result.html).toContain("Alex");
	});
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `apps/webapp`:

```bash
pnpm test src/lib/email/template-renderer.test.ts
```

Expected: FAIL because renderer modules do not exist.

- [ ] **Step 3: Implement persistence helper**

Create `apps/webapp/src/lib/email/template-overrides.ts` with:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationEmailTemplate, type EmailTemplateKey } from "@/db/schema";

export interface EnabledOrganizationEmailTemplate {
	subject: string;
	html: string;
	plainText: string | null;
}

export async function getEnabledOrganizationEmailTemplate(
	organizationId: string,
	templateKey: EmailTemplateKey,
): Promise<EnabledOrganizationEmailTemplate | null> {
	const template = await db.query.organizationEmailTemplate.findFirst({
		where: and(
			eq(organizationEmailTemplate.organizationId, organizationId),
			eq(organizationEmailTemplate.templateKey, templateKey),
			eq(organizationEmailTemplate.isEnabled, true),
		),
		columns: { subject: true, html: true, plainText: true },
	});

	return template ?? null;
}
```

- [ ] **Step 4: Implement renderer**

Create `apps/webapp/src/lib/email/template-renderer.ts` with:

```ts
import type { EmailTemplateKey } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { getEmailTemplateDefinition } from "./template-registry";
import { getEnabledOrganizationEmailTemplate } from "./template-overrides";
import { interpolateTemplate, validateTemplateContent } from "./template-validation";

const logger = createLogger("EmailTemplateRenderer");

export interface RenderOrganizationEmailTemplateInput {
	organizationId?: string;
	templateKey: EmailTemplateKey;
	data: Record<string, unknown>;
	subjectOverride?: string;
}

export interface RenderedOrganizationEmailTemplate {
	subject: string;
	html: string;
	plainText?: string;
	usedOverride: boolean;
}

export async function renderOrganizationEmailTemplate({
	organizationId,
	templateKey,
	data,
	subjectOverride,
}: RenderOrganizationEmailTemplateInput): Promise<RenderedOrganizationEmailTemplate> {
	const definition = getEmailTemplateDefinition(templateKey);
	const renderDefault = async (): Promise<RenderedOrganizationEmailTemplate> => ({
		subject: subjectOverride ?? interpolateTemplate(definition.defaultSubject, data),
		html: await definition.renderDefault(data),
		usedOverride: false,
	});

	if (!organizationId) return renderDefault();

	const override = await getEnabledOrganizationEmailTemplate(organizationId, templateKey);
	if (!override) return renderDefault();

	const validation = validateTemplateContent({
		subject: override.subject,
		html: override.html,
		allowedVariables: definition.variables,
	});

	if (!validation.success) {
		logger.warn({ organizationId, templateKey, errors: validation.errors }, "Invalid email template override; falling back to default");
		return renderDefault();
	}

	return {
		subject: interpolateTemplate(override.subject, data),
		html: interpolateTemplate(override.html, data),
		plainText: override.plainText ? interpolateTemplate(override.plainText, data) : undefined,
		usedOverride: true,
	};
}
```

- [ ] **Step 5: Run renderer tests**

Run from `apps/webapp`:

```bash
pnpm test src/lib/email/template-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email/template-overrides.ts src/lib/email/template-renderer.ts src/lib/email/template-renderer.test.ts
git commit -m "feat: render organization email template overrides"
```

## Task 5: Add Org-Admin Server Actions

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.test.ts`

- [ ] **Step 1: Write action tests for validation and access helper shape**

Create `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.test.ts` with tests that mock `@/lib/auth-helpers`, `@/db`, and `@/lib/email/email-service`. Include these cases:

```ts
import { describe, expect, it } from "vitest";
import { validateEmailTemplateInput } from "./actions";

describe("email template settings actions", () => {
	it("rejects unknown variables before saving", () => {
		const result = validateEmailTemplateInput({
			templateKey: "password-reset",
			subject: "Reset {{secret}}",
			html: "<p>{{resetUrl}}</p>",
			editorDocument: { root: {} },
			isEnabled: true,
		});

		expect(result.success).toBe(false);
		expect(result.errors).toContain("Unknown variable: secret");
	});

	it("accepts valid template input", () => {
		const result = validateEmailTemplateInput({
			templateKey: "password-reset",
			subject: "Reset your password, {{userName}}",
			html: "<p>{{resetUrl}}</p>",
			editorDocument: { root: { type: "email" } },
			isEnabled: true,
		});

		expect(result).toEqual({ success: true, errors: [] });
	});
});
```

- [ ] **Step 2: Run the action tests and verify failure**

Run from `apps/webapp`:

```bash
pnpm test 'src/app/[locale]/(app)/settings/email-templates/actions.test.ts'
```

Expected: FAIL because actions do not exist.

- [ ] **Step 3: Implement actions**

Create `apps/webapp/src/app/[locale]/(app)/settings/email-templates/actions.ts` with:

```ts
"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizationEmailTemplate, type EmailTemplateEditorDocument, type EmailTemplateKey } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { sendEmail } from "@/lib/email/email-service";
import { getEmailTemplateDefinition, EMAIL_TEMPLATE_REGISTRY } from "@/lib/email/template-registry";
import { renderOrganizationEmailTemplate } from "@/lib/email/template-renderer";
import { sanitizeEmailHtml, validateTemplateContent } from "@/lib/email/template-validation";

export interface SaveEmailTemplateInput {
	templateKey: EmailTemplateKey;
	subject: string;
	html: string;
	editorDocument: EmailTemplateEditorDocument;
	plainText?: string | null;
	isEnabled: boolean;
}

export function validateEmailTemplateInput(input: SaveEmailTemplateInput): { success: boolean; errors: string[] } {
	const definition = getEmailTemplateDefinition(input.templateKey);
	const errors: string[] = [];

	if (!input.editorDocument || typeof input.editorDocument !== "object" || Array.isArray(input.editorDocument)) {
		errors.push("Editor document is required");
	}

	const contentValidation = validateTemplateContent({
		subject: input.subject,
		html: input.html,
		allowedVariables: definition.variables,
	});

	return { success: errors.length === 0 && contentValidation.success, errors: [...errors, ...contentValidation.errors] };
}

export async function listEmailTemplates() {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const overrides = await db.query.organizationEmailTemplate.findMany({
		where: eq(organizationEmailTemplate.organizationId, organizationId),
	});

	return EMAIL_TEMPLATE_REGISTRY.map((definition) => {
		const override = overrides.find((entry) => entry.templateKey === definition.key);
		return { definition, override: override ?? null };
	});
}

export async function saveEmailTemplate(input: SaveEmailTemplateInput): Promise<{ success: boolean; errors?: string[] }> {
	const { organizationId, authContext } = await requireOrgAdminSettingsAccess();
	const validation = validateEmailTemplateInput(input);
	if (!validation.success) return { success: false, errors: validation.errors };
	const safeHtml = sanitizeEmailHtml(input.html.trim());

	const existing = await db.query.organizationEmailTemplate.findFirst({
		where: and(eq(organizationEmailTemplate.organizationId, organizationId), eq(organizationEmailTemplate.templateKey, input.templateKey)),
	});

	const values = {
		organizationId,
		templateKey: input.templateKey,
		subject: input.subject.trim(),
		html: safeHtml,
		plainText: input.plainText?.trim() || null,
		editorDocument: input.editorDocument,
		isEnabled: input.isEnabled,
		updatedByUserId: authContext.user.id,
	};

	if (existing) {
		await db.update(organizationEmailTemplate).set(values).where(eq(organizationEmailTemplate.id, existing.id));
	} else {
		await db.insert(organizationEmailTemplate).values({ ...values, createdByUserId: authContext.user.id });
	}

	revalidatePath("/settings/email-templates");
	return { success: true };
}

export async function resetEmailTemplate(templateKey: EmailTemplateKey): Promise<{ success: boolean }> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	await db.delete(organizationEmailTemplate).where(and(eq(organizationEmailTemplate.organizationId, organizationId), eq(organizationEmailTemplate.templateKey, templateKey)));
	revalidatePath("/settings/email-templates");
	return { success: true };
}

export async function sendEmailTemplateTest(input: SaveEmailTemplateInput): Promise<{ success: boolean; errors?: string[] }> {
	const { organizationId, authContext } = await requireOrgAdminSettingsAccess();
	const validation = validateEmailTemplateInput(input);
	if (!validation.success) return { success: false, errors: validation.errors };

	const rendered = await renderOrganizationEmailTemplate({
		organizationId,
		templateKey: input.templateKey,
		data: getEmailTemplateDefinition(input.templateKey).previewData,
	});

	const result = await sendEmail({
		to: authContext.user.email,
		subject: rendered.subject,
		html: rendered.html,
		organizationId,
	});

	return result.success ? { success: true } : { success: false, errors: ["Failed to send test email"] };
}
```

- [ ] **Step 4: Run action tests**

Run from `apps/webapp`:

```bash
pnpm test 'src/app/[locale]/(app)/settings/email-templates/actions.test.ts'
```

Expected: PASS. If imports that touch Next server APIs break the unit test, split `validateEmailTemplateInput` into `apps/webapp/src/lib/email/template-action-validation.ts` and keep the same assertions against that pure module.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/(app)/settings/email-templates/actions.ts' 'src/app/[locale]/(app)/settings/email-templates/actions.test.ts'
git commit -m "feat: add email template settings actions"
```

## Task 6: Add Settings Route Visibility

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Modify: `apps/webapp/src/lib/settings-access.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Modify: `apps/webapp/messages/settings/en.json`

- [ ] **Step 1: Add failing settings visibility assertions**

Modify `apps/webapp/src/components/settings/settings-config.test.ts` and add:

```ts
it("shows email templates for org admins only", () => {
	expect(getVisibleSettings("orgAdmin", true).some((entry) => entry.id === "email-templates")).toBe(true);
	expect(getVisibleSettings("manager", true).some((entry) => entry.id === "email-templates")).toBe(false);
	expect(getVisibleSettings("member", true).some((entry) => entry.id === "email-templates")).toBe(false);
});
```

Modify `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts` to include `"email-templates/page.tsx"` in `ORG_ADMIN_ROUTE_FILES` and `"/settings/email-templates"` in the expected `ORG_ADMIN_SETTINGS_ROUTES` list.

- [ ] **Step 2: Run the tests and verify failure**

Run from `apps/webapp`:

```bash
pnpm test src/components/settings/settings-config.test.ts 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: FAIL because the route and setting are not registered yet.

- [ ] **Step 3: Register route and settings entry**

Modify `apps/webapp/src/lib/settings-access.ts` and add:

```ts
"/settings/email-templates",
```

Modify `apps/webapp/src/components/settings/settings-config.ts` and add an entry near other organization/admin email settings:

```ts
{
	id: "email-templates",
	titleKey: "settings.emailTemplates.title",
	titleDefault: "Email Templates",
	descriptionKey: "settings.emailTemplates.description",
	descriptionDefault: "Customize the emails your organization sends",
	href: "/settings/email-templates",
	icon: "mail",
	minimumTier: "orgAdmin",
	group: "organization",
},
```

Modify `apps/webapp/messages/settings/en.json` and add copy under the existing `settings` namespace:

```json
"emailTemplates": {
  "title": "Email Templates",
  "description": "Customize the emails your organization sends"
}
```

- [ ] **Step 4: Run route visibility tests**

Run from `apps/webapp`:

```bash
pnpm test src/components/settings/settings-config.test.ts 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/settings-config.ts src/lib/settings-access.ts src/components/settings/settings-config.test.ts 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts' messages/settings/en.json
git commit -m "feat: add email templates settings entry"
```

## Task 7: Build The Email Templates Settings UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/email-templates/page.tsx`
- Create: `apps/webapp/src/components/settings/email-templates/email-template-settings-client.tsx`
- Create: `apps/webapp/src/components/settings/email-templates/email-template-list.tsx`
- Create: `apps/webapp/src/components/settings/email-templates/email-template-editor.tsx`
- Create: `apps/webapp/src/components/settings/email-templates/variable-palette.tsx`
- Create: `apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx`

- [ ] **Step 1: Write a component smoke test**

Create `apps/webapp/src/components/settings/email-templates/email-template-settings-client.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMAIL_TEMPLATE_REGISTRY } from "@/lib/email/template-registry";
import { EmailTemplateSettingsClient } from "./email-template-settings-client";

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("./email-template-editor", () => ({ EmailTemplateEditor: () => <div>Email editor</div> }));

describe("EmailTemplateSettingsClient", () => {
	it("renders grouped templates and the editor", () => {
		render(<EmailTemplateSettingsClient templates={EMAIL_TEMPLATE_REGISTRY.map((definition) => ({ definition, override: null }))} />);

		expect(screen.getByText("Email Templates")).toBeInTheDocument();
		expect(screen.getByText("Email verification")).toBeInTheDocument();
		expect(screen.getByText("Password reset")).toBeInTheDocument();
		expect(screen.getByText("Email editor")).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run the UI test and verify failure**

Run from `apps/webapp`:

```bash
pnpm test src/components/settings/email-templates/email-template-settings-client.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Add page shell**

Create `apps/webapp/src/app/[locale]/(app)/settings/email-templates/page.tsx` with:

```tsx
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { EmailTemplateSettingsClient } from "@/components/settings/email-templates/email-template-settings-client";
import { listEmailTemplates } from "./actions";

export default async function EmailTemplatesPage() {
	await requireOrgAdminSettingsAccess();
	const [t, templates] = await Promise.all([getTranslate(), listEmailTemplates()]);

	return (
		<div className="p-6">
			<div className="mx-auto max-w-7xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">{t("settings.emailTemplates.title", "Email Templates")}</h1>
					<p className="text-muted-foreground">{t("settings.emailTemplates.description", "Customize the emails your organization sends")}</p>
				</div>
				<EmailTemplateSettingsClient templates={templates} />
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Add list and variable palette components**

Create `email-template-list.tsx` and `variable-palette.tsx` with focused props:

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EmailTemplateDefinition } from "@/lib/email/template-registry";

interface TemplateListItem {
	definition: EmailTemplateDefinition;
	override: { isEnabled: boolean; updatedAt: Date } | null;
}

export function EmailTemplateList({
	templates,
	selectedKey,
	onSelect,
}: {
	templates: TemplateListItem[];
	selectedKey: string;
	onSelect: (key: string) => void;
}) {
	return (
		<div className="space-y-2">
			{templates.map(({ definition, override }) => (
				<Button key={definition.key} type="button" variant={selectedKey === definition.key ? "secondary" : "ghost"} className="h-auto w-full justify-start p-3 text-left" onClick={() => onSelect(definition.key)}>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="font-medium">{definition.label}</span>
							<Badge variant={override ? "default" : "outline"}>{override ? (override.isEnabled ? "Customized" : "Disabled") : "Default"}</Badge>
						</div>
						<p className="text-muted-foreground text-xs">{definition.description}</p>
					</div>
				</Button>
			))}
		</div>
	);
}
```

```tsx
"use client";

import { Button } from "@/components/ui/button";
import type { EmailTemplateVariableDefinition } from "@/lib/email/template-registry";

export function VariablePalette({
	variables,
	onInsert,
}: {
	variables: EmailTemplateVariableDefinition[];
	onInsert: (value: string) => void;
}) {
	return (
		<div className="space-y-2">
			{variables.map((variable) => (
				<Button key={variable.name} type="button" variant="outline" className="h-auto w-full justify-start p-2 text-left" onClick={() => onInsert(`{{${variable.name}}}`)}>
					<div>
						<div className="font-mono text-xs">{"{{"}{variable.name}{"}}"}</div>
						<div className="text-muted-foreground text-xs">{variable.description}</div>
					</div>
				</Button>
			))}
		</div>
	);
}
```

- [ ] **Step 5: Add editor wrapper and client state**

Create `email-template-editor.tsx` as a client component. Dynamically import `@react-email/editor` so settings page SSR does not crash if the editor touches browser globals:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EmailTemplateDefinition } from "@/lib/email/template-registry";
import { saveEmailTemplate, resetEmailTemplate, sendEmailTemplateTest } from "@/app/[locale]/(app)/settings/email-templates/actions";
import { VariablePalette } from "./variable-palette";

const ReactEmailEditor = dynamic(() => import("@react-email/editor").then((mod) => mod.Editor ?? mod.default), {
	ssr: false,
	loading: () => <div className="bg-muted flex min-h-[520px] items-center justify-center rounded-md">Loading editor...</div>,
});

export function EmailTemplateEditor({ definition, override }: { definition: EmailTemplateDefinition; override: any }) {
	const [isPending, startTransition] = useTransition();
	const [subject, setSubject] = useState(override?.subject ?? definition.defaultSubject);
	const [html, setHtml] = useState(override?.html ?? `<p>${definition.description}</p>`);
	const [editorDocument, setEditorDocument] = useState<Record<string, unknown>>(override?.editorDocument ?? { root: { type: "email" } });

	const insertIntoSubject = (value: string) => setSubject((current) => `${current}${value}`);

	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
			<Card>
				<CardHeader><CardTitle>{definition.label}</CardTitle></CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="email-template-subject">Subject</Label>
						<Input id="email-template-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
					</div>
					<ReactEmailEditor value={editorDocument} onChange={(value: Record<string, unknown>) => setEditorDocument(value)} onHtmlChange={(value: string) => setHtml(value)} />
				</CardContent>
			</Card>
			<Card>
				<CardHeader><CardTitle>Variables</CardTitle></CardHeader>
				<CardContent className="space-y-4">
					<VariablePalette variables={definition.variables} onInsert={insertIntoSubject} />
					<Button disabled={isPending} className="w-full" onClick={() => startTransition(async () => {
						const result = await saveEmailTemplate({ templateKey: definition.key, subject, html, editorDocument, isEnabled: true });
						result.success ? toast.success("Template saved") : toast.error(result.errors?.join("\n") ?? "Failed to save template");
					})}>Save</Button>
					<Button disabled={isPending} variant="outline" className="w-full" onClick={() => startTransition(async () => {
						const result = await sendEmailTemplateTest({ templateKey: definition.key, subject, html, editorDocument, isEnabled: true });
						result.success ? toast.success("Test email sent") : toast.error(result.errors?.join("\n") ?? "Failed to send test email");
					})}>Send test</Button>
					<Button disabled={isPending} variant="destructive" className="w-full" onClick={() => startTransition(async () => {
						await resetEmailTemplate(definition.key);
						toast.success("Template reset to default");
					})}>Reset to default</Button>
				</CardContent>
			</Card>
		</div>
	);
}
```

Create `email-template-settings-client.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { EmailTemplateDefinition } from "@/lib/email/template-registry";
import { EmailTemplateEditor } from "./email-template-editor";
import { EmailTemplateList } from "./email-template-list";

interface TemplateItem {
	definition: EmailTemplateDefinition;
	override: any | null;
}

export function EmailTemplateSettingsClient({ templates }: { templates: TemplateItem[] }) {
	const [selectedKey, setSelectedKey] = useState(templates[0]?.definition.key ?? "email-verification");
	const selected = templates.find((template) => template.definition.key === selectedKey) ?? templates[0];

	return (
		<div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
			<Card>
				<CardContent className="p-3">
					<h2 className="mb-3 px-1 text-sm font-medium">Email Templates</h2>
					<EmailTemplateList templates={templates} selectedKey={selectedKey} onSelect={setSelectedKey} />
				</CardContent>
			</Card>
			{selected ? <EmailTemplateEditor definition={selected.definition} override={selected.override} /> : null}
		</div>
	);
}
```

- [ ] **Step 6: Run UI test**

Run from `apps/webapp`:

```bash
pnpm test src/components/settings/email-templates/email-template-settings-client.test.tsx
```

Expected: PASS after aligning the dynamic editor import to the actual `@react-email/editor` export names if needed.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/[locale]/(app)/settings/email-templates/page.tsx' src/components/settings/email-templates
git commit -m "feat: add email template settings UI"
```

## Task 8: Integrate Runtime Email Sending

**Files:**
- Modify: `apps/webapp/src/lib/queue/index.ts`
- Modify: `apps/webapp/src/lib/email/sender.ts`
- Modify: `apps/webapp/src/lib/notifications/email-notifications.ts`
- Add tests where existing email sender tests live, or create `apps/webapp/src/lib/email/sender.test.ts`.

- [ ] **Step 1: Add `organizationId` to queued email jobs**

Modify `apps/webapp/src/lib/queue/index.ts`:

```ts
export interface EmailJobData {
	type: "email";
	to: string;
	subject: string;
	template: string;
	data: Record<string, unknown>;
	organizationId?: string;
}
```

- [ ] **Step 2: Update worker email sender**

Modify `apps/webapp/src/lib/email/sender.ts` so it validates template keys with `EMAIL_TEMPLATE_KEYS` and renders through `renderOrganizationEmailTemplate`:

```ts
import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey } from "@/db/schema";
import { renderOrganizationEmailTemplate } from "./template-renderer";

function isEmailTemplateKey(value: string): value is EmailTemplateKey {
	return EMAIL_TEMPLATE_KEYS.includes(value as EmailTemplateKey);
}
```

Replace the switch with:

```ts
if (!isEmailTemplateKey(data.template)) {
	throw new Error(`Unknown email template: ${data.template}`);
}

const rendered = await renderOrganizationEmailTemplate({
	organizationId: data.organizationId,
	templateKey: data.template,
	data: data.data,
	subjectOverride: data.subject,
});

await sendEmailInternal({
	to: data.to,
	subject: rendered.subject,
	html: rendered.html,
	organizationId: data.organizationId,
});
```

- [ ] **Step 3: Update direct notification emails**

Modify `apps/webapp/src/lib/notifications/email-notifications.ts` to replace each `renderX` call plus hardcoded subject with `renderOrganizationEmailTemplate`. Keep the switch, but assign `templateKey` and `templateData` instead of rendered HTML. The case for password/auth emails is handled by worker sender or auth integration if those call sites are elsewhere.

Use this pattern per case:

```ts
templateKey = "absence-request-submitted";
templateData = {
	employeeName: userName,
	startDate: String(metadata.startDate || ""),
	endDate: String(metadata.endDate || ""),
	absenceType: String(metadata.absenceType || ""),
	days: Number(metadata.days || 0),
	managerName: String(metadata.managerName || "your manager"),
	appUrl,
};
```

After the switch, render and send:

```ts
if (!templateKey || !templateData) {
	logger.warn({ type }, "No email template data generated, skipping email notification");
	return false;
}

const rendered = await renderOrganizationEmailTemplate({
	organizationId,
	templateKey,
	data: templateData,
});

const result = await sendEmail({
	to: email,
	subject: rendered.subject,
	html: rendered.html,
	organizationId,
});
```

- [ ] **Step 4: Run email tests**

Run from `apps/webapp`:

```bash
pnpm test src/lib/email/template-renderer.test.ts src/lib/email/template-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queue/index.ts src/lib/email/sender.ts src/lib/notifications/email-notifications.ts
git commit -m "feat: use organization email template overrides"
```

## Task 9: Verification And Build

**Files:**
- No planned code changes unless verification finds defects.

- [ ] **Step 1: Run focused test suite**

Run from `apps/webapp`:

```bash
pnpm test src/lib/email/template-registry.test.ts src/lib/email/template-validation.test.ts src/lib/email/template-renderer.test.ts src/components/settings/settings-config.test.ts 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts' src/components/settings/email-templates/email-template-settings-client.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run from `apps/webapp`:

```bash
pnpm test
```

Expected: PASS or only pre-existing unrelated failures. If failures are related to email templates, fix them before continuing.

- [ ] **Step 3: Run production build**

Run from `apps/webapp`:

```bash
pnpm build
```

Expected: PASS. If the editor package fails SSR, ensure the editor remains dynamically imported with `ssr: false` and that no server file imports browser-only editor code.

- [ ] **Step 4: Manual browser verification**

Start the dev server from `apps/webapp`:

```bash
pnpm dev
```

Then verify in the browser:

- `/settings/email-templates` loads for an org admin.
- Template list shows all registered templates.
- Selecting a template updates the editor panel.
- Inserting a variable adds `{{variableName}}` to the subject.
- Saving a valid template succeeds.
- Saving `{{unknownVariable}}` fails with a validation message.
- Reset returns the template to default status.
- Test send sends only to the current admin email.

- [ ] **Step 5: Final commit**

If verification fixes changed files, commit them:

```bash
git add src messages
git commit -m "fix: stabilize custom email template workflow"
```

If there are no verification fixes, skip this commit.

## Self-Review Notes

- Spec coverage: schema, registry, validation, security, settings access, editor UI, fallback rendering, test-send, and runtime integration are each mapped to tasks.
- Tenant isolation: actions use `requireOrgAdminSettingsAccess` and derive `organizationId` server-side.
- Fallback reliability: renderer tests cover missing org id and invalid override fallback.
- XSS controls: variable interpolation escapes values; Task 3 adds a conservative sanitizer that removes script tags, event handlers, and JavaScript URLs before custom HTML is stored or sent.
- Known integration risk: `@react-email/editor` export names and callback props must be confirmed during Task 7 because local `node_modules` were not present during planning. The wrapper component isolates that adjustment.
