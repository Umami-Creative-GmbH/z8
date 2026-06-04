# SMTP Diagnostics IP Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SMTP IP-family mode support across the app-wide SMTP stack and add platform diagnostics temporary SMTP overrides that can force SMTP-only test sends.

**Architecture:** Introduce a shared `SmtpIpMode` transport setting used by system SMTP env config, organization SMTP database config, and diagnostics one-off SMTP overrides. Keep diagnostics overrides ephemeral and platform-admin-only; keep organization settings organization-scoped through existing settings actions.

**Tech Stack:** Next.js App Router server actions, React client components, TanStack Form, Drizzle/Postgres migrations, nodemailer, Zod, Vitest, Testing Library, Tolgee translations.

---

## File Structure

- Modify `apps/webapp/src/lib/email/transports/base.ts`: define/export `SmtpIpMode` and add `ipMode` to `SmtpTransportConfig`.
- Modify `apps/webapp/src/lib/email/transports/smtp-transport.ts`: map `ipMode` to nodemailer connection options and pass system env value.
- Create `apps/webapp/src/lib/email/transports/smtp-transport.test.ts`: verify nodemailer options for auto/IPv4/IPv6 and system env handling.
- Modify `apps/webapp/src/env.ts`: add optional `SMTP_IP_MODE` env validation/runtime mapping.
- Modify `apps/webapp/src/db/schema/enterprise.ts`: add `EmailSmtpIpMode` type and `smtpIpMode` column.
- Create `apps/webapp/drizzle/0045_organization_smtp_ip_mode.sql`: add `smtp_ip_mode` column with default `auto`.
- Modify `apps/webapp/drizzle/meta/_journal.json`: add journal entry for migration `0045_organization_smtp_ip_mode`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.ts`: read/save/return `smtpIpMode`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.test.ts`: cover org scoping and `smtpIpMode` persistence.
- Modify `apps/webapp/src/components/settings/enterprise/email-config-form.tsx`: expose SMTP IP mode in organization settings.
- Modify `apps/webapp/src/lib/email/email-service.ts`: pass org SMTP `smtpIpMode` to `SmtpTransport`.
- Modify `apps/webapp/src/lib/email/email-service.test.ts`: cover org SMTP IP mode passed to transport.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts`: validate optional SMTP override and send with one-off `SmtpTransport` when present.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`: cover override validation, SMTP-only send, safe failures, and no fallback.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx`: render blank temporary SMTP override fields and submit override payload.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`: cover UI defaults and submitted override payload.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts`: add new diagnostics literals to the hardcoded-copy guard.

## Task 1: Shared SMTP IP Mode and System Env

**Files:**

- Modify: `apps/webapp/src/lib/email/transports/base.ts`
- Modify: `apps/webapp/src/lib/email/transports/smtp-transport.ts`
- Modify: `apps/webapp/src/env.ts`
- Create: `apps/webapp/src/lib/email/transports/smtp-transport.test.ts`

- [ ] **Step 1: Write failing transport tests**

Create `apps/webapp/src/lib/email/transports/smtp-transport.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const createTransportMock = vi.hoisted(() => vi.fn());

vi.mock("nodemailer", () => ({
	createTransport: createTransportMock,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: vi.fn(),
		info: vi.fn(),
	}),
}));

function mockTransporter() {
	return {
		close: vi.fn(),
		sendMail: vi.fn(async () => ({ messageId: "smtp-message" })),
		verify: vi.fn(async () => true),
	};
}

describe("SmtpTransport IP mode", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllEnvs();
		vi.clearAllMocks();
		createTransportMock.mockReturnValue(mockTransporter());
	});

	it("omits address family forcing when ipMode is auto", async () => {
		const { SmtpTransport } = await import("./smtp-transport");

		new SmtpTransport({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			requireTls: true,
			auth: { user: "user", pass: "password" },
			fromEmail: "noreply@example.com",
			ipMode: "auto",
		});

		expect(createTransportMock).toHaveBeenCalledWith(
			expect.not.objectContaining({ family: expect.any(Number) }),
		);
	});

	it("sets nodemailer family 4 when ipMode is ipv4", async () => {
		const { SmtpTransport } = await import("./smtp-transport");

		new SmtpTransport({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			requireTls: true,
			auth: { user: "user", pass: "password" },
			fromEmail: "noreply@example.com",
			ipMode: "ipv4",
		});

		expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ family: 4 }));
	});

	it("sets nodemailer family 6 when ipMode is ipv6", async () => {
		const { SmtpTransport } = await import("./smtp-transport");

		new SmtpTransport({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			requireTls: true,
			auth: { user: "user", pass: "password" },
			fromEmail: "noreply@example.com",
			ipMode: "ipv6",
		});

		expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ family: 6 }));
	});

	it("passes SMTP_IP_MODE into system SMTP transport", async () => {
		vi.stubEnv("SMTP_HOST", "smtp.example.com");
		vi.stubEnv("SMTP_PORT", "587");
		vi.stubEnv("SMTP_USERNAME", "user");
		vi.stubEnv("SMTP_PASSWORD", "password");
		vi.stubEnv("SMTP_FROM_EMAIL", "noreply@example.com");
		vi.stubEnv("SMTP_IP_MODE", "ipv4");
		const { createSystemSmtpTransport } = await import("./smtp-transport");

		const transport = createSystemSmtpTransport();

		expect(transport).not.toBeNull();
		expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ family: 4 }));
	});
});
```

- [ ] **Step 2: Run transport tests and verify failure**

Run: `pnpm vitest run apps/webapp/src/lib/email/transports/smtp-transport.test.ts`

Expected: FAIL because `SmtpTransportConfig` has no `ipMode` and the SMTP transport does not set `family`.

- [ ] **Step 3: Add shared type and env var**

In `apps/webapp/src/lib/email/transports/base.ts`, replace the SMTP config block with:

```ts
export type SmtpIpMode = "auto" | "ipv4" | "ipv6";

export interface SmtpTransportConfig {
	type: "smtp";
	host: string;
	port: number;
	secure: boolean;
	requireTls: boolean;
	ipMode?: SmtpIpMode;
	auth: {
		user: string;
		pass: string;
	};
	fromEmail: string;
	fromName?: string;
}
```

In `apps/webapp/src/env.ts`, add to the server schema near `SMTP_REQUIRE_TLS`:

```ts
		SMTP_IP_MODE: z.enum(["auto", "ipv4", "ipv6"]).optional(),
```

Add to `runtimeEnv` near `SMTP_REQUIRE_TLS`:

```ts
		SMTP_IP_MODE: optionalEnv(process.env.SMTP_IP_MODE),
```

- [ ] **Step 4: Wire IP mode into SMTP transport**

In `apps/webapp/src/lib/email/transports/smtp-transport.ts`, update imports to include `SmtpIpMode`:

```ts
import type {
	EmailMessage,
	EmailTransport,
	EmailTransportResult,
	SmtpIpMode,
	SmtpTransportConfig,
} from "./base";
```

Add this helper before `export class SmtpTransport`:

```ts
function smtpFamilyForIpMode(ipMode: SmtpIpMode | undefined): 4 | 6 | undefined {
	if (ipMode === "ipv4") {
		return 4;
	}

	if (ipMode === "ipv6") {
		return 6;
	}

	return undefined;
}
```

In the constructor, before `this.transporter = createTransport({`, add:

```ts
		const family = smtpFamilyForIpMode(config.ipMode);
```

Replace the `createTransport` call with:

```ts
		this.transporter = createTransport({
			host: config.host,
			port: config.port,
			secure: config.secure,
			requireTLS: config.requireTls,
			...(family ? { family } : {}),
			auth: {
				user: config.auth.user,
				pass: config.auth.pass,
			},
			connectionTimeout: 10000,
			greetingTimeout: 10000,
			socketTimeout: 30000,
		});
```

In `createSystemSmtpTransport()`, add:

```ts
	const ipMode = env.SMTP_IP_MODE ?? "auto";
```

Pass it into the `new SmtpTransport` config:

```ts
			ipMode,
```

- [ ] **Step 5: Run transport tests and verify pass**

Run: `pnpm vitest run apps/webapp/src/lib/email/transports/smtp-transport.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit shared transport changes**

Run:

```bash
git add apps/webapp/src/lib/email/transports/base.ts apps/webapp/src/lib/email/transports/smtp-transport.ts apps/webapp/src/lib/email/transports/smtp-transport.test.ts apps/webapp/src/env.ts
git commit -m "feat(email): add smtp ip mode"
```

Expected: commit succeeds and includes only the listed files.

## Task 2: Organization SMTP IP Mode Persistence

**Files:**

- Modify: `apps/webapp/src/db/schema/enterprise.ts`
- Create: `apps/webapp/drizzle/0045_organization_smtp_ip_mode.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.test.ts`

- [ ] **Step 1: Add failing action tests for saving SMTP IP mode**

In `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.test.ts`, update the import to include `getEmailConfig`:

```ts
import { getEmailConfig, getSecretStoreConnectionStatus, saveEmailConfig } from "./actions";
```

Add these tests inside `describe("enterprise email config actions", () => { ... })`:

```ts
	it("saves smtpIpMode for SMTP configs without storing it as a secret", async () => {
		const result = await saveEmailConfig("org-1", {
			transportType: "smtp",
			fromEmail: "noreply@example.com",
			fromName: "Example",
			isActive: true,
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpSecure: false,
			smtpRequireTls: true,
			smtpUsername: "smtp-user",
			smtpPassword: "smtp-password",
			smtpIpMode: "ipv6",
		});

		expect(result).toEqual({ success: true });
		expect(mocks.insert).toHaveBeenCalledTimes(1);
		expect(mocks.values).toHaveBeenCalledWith(
			expect.objectContaining({
				smtpIpMode: "ipv6",
			}),
		);
		expect(mocks.storeOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"email/smtp_password",
			"smtp-password",
		);
	});

	it("returns smtpIpMode from saved organization email config", async () => {
		mocks.findFirst.mockResolvedValue({
			id: "config-1",
			organizationId: "org-1",
			transportType: "smtp",
			fromEmail: "noreply@example.com",
			fromName: "Example",
			isActive: true,
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpSecure: false,
			smtpRequireTls: true,
			smtpUsername: "smtp-user",
			smtpIpMode: "ipv4",
			lastTestAt: null,
			lastTestSuccess: null,
			lastTestError: null,
			createdAt: new Date("2026-06-04T00:00:00.000Z"),
			updatedAt: new Date("2026-06-04T00:00:00.000Z"),
		});
		mocks.hasOrgSecret.mockResolvedValue(false);

		const result = await getEmailConfig("org-1");

		expect(result).toEqual(
			expect.objectContaining({
				smtpIpMode: "ipv4",
				hasResendApiKey: false,
				hasSmtpPassword: false,
			}),
		);
	});
```

- [ ] **Step 2: Run action tests and verify failure**

Run: `pnpm vitest run apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.test.ts`

Expected: FAIL because `smtpIpMode` is not part of the action input/output or DB values.

- [ ] **Step 3: Add schema type and column**

In `apps/webapp/src/db/schema/enterprise.ts`, replace the email transport type with:

```ts
export type EmailTransportType = "resend" | "smtp";
export type EmailSmtpIpMode = "auto" | "ipv4" | "ipv6";
```

Add this column after `smtpRequireTls`:

```ts
		smtpIpMode: text("smtp_ip_mode").$type<EmailSmtpIpMode>().default("auto"),
```

- [ ] **Step 4: Add migration and journal entry**

Create `apps/webapp/drizzle/0045_organization_smtp_ip_mode.sql`:

```sql
ALTER TABLE "organization_email_config"
	ADD COLUMN IF NOT EXISTS "smtp_ip_mode" text DEFAULT 'auto';
```

In `apps/webapp/drizzle/meta/_journal.json`, add this entry after the `0044_cron_schedule_override` entry:

```json
    {
      "idx": 45,
      "version": "7",
      "when": 1780304304746,
      "tag": "0045_organization_smtp_ip_mode",
      "breakpoints": true
    }
```

Ensure the previous entry has a trailing comma and the JSON remains valid.

- [ ] **Step 5: Update organization email actions**

In `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.ts`, update the import:

```ts
import {
	type EmailSmtpIpMode,
	type EmailTransportType,
	organizationEmailConfig,
} from "@/db/schema";
```

Add `smtpIpMode` to `EmailConfigInput` after `smtpRequireTls`:

```ts
	smtpIpMode?: EmailSmtpIpMode;
```

Add `smtpIpMode` to `EmailConfigOutput` after `smtpRequireTls`:

```ts
	smtpIpMode: EmailSmtpIpMode | null;
```

In `getEmailConfig()`, add to the returned object after `smtpRequireTls`:

```ts
			smtpIpMode: config.smtpIpMode ?? "auto",
```

In `saveEmailConfig()`, add validation inside `if (config.transportType === "smtp") {` after required field validation:

```ts
			if (config.smtpIpMode && !["auto", "ipv4", "ipv6"].includes(config.smtpIpMode)) {
				return { success: false, error: "Invalid SMTP IP mode" };
			}
```

Add to `dbValues` after `smtpRequireTls`:

```ts
			smtpIpMode: config.transportType === "smtp" ? (config.smtpIpMode ?? "auto") : null,
```

- [ ] **Step 6: Run action tests and verify pass**

Run: `pnpm vitest run apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit persistence changes**

Run:

```bash
git add apps/webapp/src/db/schema/enterprise.ts apps/webapp/drizzle/0045_organization_smtp_ip_mode.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.ts apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.test.ts
git commit -m "feat(email): persist organization smtp ip mode"
```

Expected: commit succeeds and includes only the listed files.

## Task 3: Organization Settings UI and Org SMTP Sending

**Files:**

- Modify: `apps/webapp/src/components/settings/enterprise/email-config-form.tsx`
- Modify: `apps/webapp/src/lib/email/email-service.ts`
- Modify: `apps/webapp/src/lib/email/email-service.test.ts`

- [ ] **Step 1: Add failing email service test for org SMTP IP mode**

In `apps/webapp/src/lib/email/email-service.test.ts`, add this test after the existing organization config test:

```ts
	it("passes organization SMTP IP mode to the SMTP transport", async () => {
		dbFindFirstMock.mockResolvedValue({
			organizationId: "org_123",
			isActive: true,
			transportType: "smtp",
			fromEmail: "team@example.com",
			fromName: "Team",
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpSecure: false,
			smtpRequireTls: true,
			smtpUsername: "smtp-user",
			smtpIpMode: "ipv4",
		});
		getOrgSecretMock.mockResolvedValue("smtp-password");
		const { sendEmail } = await import("./email-service");

		const result = await sendEmail({
			to: "alex@example.com",
			subject: "Org SMTP Test",
			html: "<p>Org SMTP Test</p>",
			organizationId: "org_123",
		});

		expect(result).toEqual({ success: true, messageId: "org-smtp-message" });
		expect(smtpTransportConstructorMock).toHaveBeenCalledWith(
			expect.objectContaining({
				ipMode: "ipv4",
			}),
		);
	});
```

- [ ] **Step 2: Run email service tests and verify failure**

Run: `pnpm vitest run apps/webapp/src/lib/email/email-service.test.ts`

Expected: FAIL because org SMTP transport does not pass `ipMode`.

- [ ] **Step 3: Pass org SMTP IP mode to transport**

In `apps/webapp/src/lib/email/email-service.ts`, add `ipMode` to the organization SMTP `new SmtpTransport({ ... })` config after `requireTls`:

```ts
				ipMode: config.smtpIpMode ?? "auto",
```

- [ ] **Step 4: Run email service tests and verify pass**

Run: `pnpm vitest run apps/webapp/src/lib/email/email-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Add organization settings form field**

In `apps/webapp/src/components/settings/enterprise/email-config-form.tsx`, add to `defaultValues` after `smtpRequireTls`:

```ts
		smtpIpMode: initialConfig?.smtpIpMode ?? "auto",
```

Inside the SMTP Configuration block, after the host/port grid and before username/password, add:

```tsx
									<form.Field name="smtpIpMode">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor="smtpIpMode">
													{t("settings.enterprise.email.smtpIpMode", "IP mode")}
												</Label>
												<select
													id="smtpIpMode"
													className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
													value={field.state.value ?? "auto"}
													onChange={(event) =>
														field.handleChange(event.target.value as "auto" | "ipv4" | "ipv6")
													}
													onBlur={field.handleBlur}
												>
													<option value="auto">{t("settings.enterprise.email.smtpIpMode.auto", "Auto")}</option>
													<option value="ipv4">
														{t("settings.enterprise.email.smtpIpMode.ipv4", "IPv4 only")}
													</option>
													<option value="ipv6">
														{t("settings.enterprise.email.smtpIpMode.ipv6", "IPv6 only")}
													</option>
												</select>
												<p className="text-xs text-muted-foreground">
													{t(
														"settings.enterprise.email.smtpIpModeHint",
														"Use Auto unless your SMTP provider requires a specific IP family.",
													)}
												</p>
											</div>
										)}
									</form.Field>
```

- [ ] **Step 6: Run focused checks**

Run: `pnpm vitest run apps/webapp/src/lib/email/email-service.test.ts apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit org UI/send changes**

Run:

```bash
git add apps/webapp/src/components/settings/enterprise/email-config-form.tsx apps/webapp/src/lib/email/email-service.ts apps/webapp/src/lib/email/email-service.test.ts
git commit -m "feat(email): expose organization smtp ip mode"
```

Expected: commit succeeds and includes only the listed files.

## Task 4: Diagnostics Temporary SMTP Override Server Action

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`

- [ ] **Step 1: Add failing diagnostics action tests**

In `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`, add `smtpTransportConstructorMock` to `mockState`:

```ts
	smtpTransportConstructor: vi.fn(),
```

Add this mock after the existing email service mock:

```ts
vi.mock("@/lib/email/transports", () => ({
	SmtpTransport: vi.fn().mockImplementation(function SmtpTransport(config) {
		mockState.smtpTransportConstructor(config);
		return {
			getName: () => `SMTP (${config.host})`,
			send: vi.fn(async () => ({ success: true, messageId: "override-msg" })),
			test: vi.fn(),
		};
	}),
}));
```

In `beforeEach`, add:

```ts
		mockState.smtpTransportConstructor.mockClear();
```

Add these tests inside `describe("sendPlatformDiagnosticsTestEmailAction", () => { ... })`:

```ts
	it("sends through a temporary SMTP override without using system email fallback", async () => {
		const { sendPlatformDiagnosticsTestEmailAction } = await importActions();

		const result = await sendPlatformDiagnosticsTestEmailAction({
			to: "ops@example.com",
			smtpOverride: {
				host: "smtp.example.com",
				port: 587,
				username: "smtp-user",
				password: "smtp-password",
				fromEmail: "noreply@example.com",
				fromName: "Z8 Ops",
				secure: false,
				requireTls: true,
				ipMode: "ipv4",
			},
		});

		expect(result).toEqual({
			success: true,
			data: { recipient: "ops@example.com", messageId: "override-msg" },
		});
		expect(mockState.sendEmail).not.toHaveBeenCalled();
		expect(mockState.smtpTransportConstructor).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "smtp.example.com",
				port: 587,
				fromEmail: "noreply@example.com",
				fromName: "Z8 Ops",
				secure: false,
				requireTls: true,
				ipMode: "ipv4",
				auth: { user: "smtp-user", pass: "smtp-password" },
			}),
		);
	});

	it("rejects incomplete temporary SMTP overrides without leaking input values", async () => {
		const { sendPlatformDiagnosticsTestEmailAction } = await importActions();

		const result = await sendPlatformDiagnosticsTestEmailAction({
			to: "ops@example.com",
			smtpOverride: {
				host: "smtp.internal.example.com",
				port: 587,
				username: "smtp-user",
				password: "",
				fromEmail: "noreply@example.com",
				secure: false,
				requireTls: true,
				ipMode: "ipv4",
			},
		});

		expect(result).toEqual(
			expect.objectContaining({
				success: false,
				error: "Complete SMTP override settings are required.",
			}),
		);
		expect(JSON.stringify(result)).not.toContain("smtp.internal.example.com");
		expect(mockState.sendEmail).not.toHaveBeenCalled();
	});
```

- [ ] **Step 2: Run diagnostics action tests and verify failure**

Run: `pnpm vitest run apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`

Expected: FAIL because the action schema does not accept `smtpOverride` and does not construct `SmtpTransport`.

- [ ] **Step 3: Implement diagnostics override schema and send path**

In `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts`, add this import:

```ts
import { SmtpTransport } from "@/lib/email/transports";
```

Replace `sendDiagnosticsTestEmailSchema` with:

```ts
const smtpIpModeSchema = z.enum(["auto", "ipv4", "ipv6"]);

const smtpOverrideSchema = z.object({
	host: z.string().trim().min(1, "Complete SMTP override settings are required."),
	port: z.number().int().min(1).max(65535),
	username: z.string().trim().min(1, "Complete SMTP override settings are required."),
	password: z.string().min(1, "Complete SMTP override settings are required."),
	fromEmail: z.email("Enter a valid from email address."),
	fromName: z.string().trim().optional(),
	secure: z.boolean(),
	requireTls: z.boolean(),
	ipMode: smtpIpModeSchema.default("auto"),
});

const sendDiagnosticsTestEmailSchema = z.object({
	to: z.email("Enter a valid email address."),
	smtpOverride: smtpOverrideSchema.optional(),
});
```

Update the action input type:

```ts
export async function sendPlatformDiagnosticsTestEmailAction(input: {
	to: string;
	smtpOverride?: z.input<typeof smtpOverrideSchema>;
}): Promise<ServerActionResult<PlatformDiagnosticsEmailTestResult>> {
```

Inside the action, after `const recipient = parsed.data.to;`, add:

```ts
		const message = {
			to: recipient,
			subject: "Z8 platform diagnostics test email",
			html: `
				<p>This is a Z8 platform diagnostics test email.</p>
				<p>If you received this message, the system email transport accepted a diagnostics delivery request.</p>
			`,
		};

		if (parsed.data.smtpOverride) {
			const override = parsed.data.smtpOverride;
			const transport = new SmtpTransport({
				host: override.host,
				port: override.port,
				secure: override.secure,
				requireTls: override.requireTls,
				ipMode: override.ipMode,
				auth: {
					user: override.username,
					pass: override.password,
				},
				fromEmail: override.fromEmail,
				fromName: override.fromName,
			});

			const overrideResult = yield* Effect.tryPromise({
				try: () => transport.send(message),
				catch: () =>
					new EmailError({
						message: "Failed to send test email.",
						recipient,
					}),
			});

			if (!overrideResult.success) {
				return yield* Effect.fail(
					new EmailError({
						message: "Failed to send test email.",
						recipient,
					}),
				);
			}

			return { recipient, messageId: overrideResult.messageId };
		}
```

Then update the existing `sendEmail` call to use `message`:

```ts
		const result = yield* Effect.tryPromise({
			try: () => sendEmail(message),
```

In the validation failure block, replace the message expression with:

```ts
					message:
						parsed.error.issues[0]?.message === "Complete SMTP override settings are required."
							? "Complete SMTP override settings are required."
							: (parsed.error.issues[0]?.message ?? "Enter a valid email address."),
```

- [ ] **Step 4: Run diagnostics action tests and verify pass**

Run: `pnpm vitest run apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit diagnostics server changes**

Run:

```bash
git add apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts
git commit -m "feat(admin): send diagnostics smtp overrides"
```

Expected: commit succeeds and includes only the listed files.

## Task 5: Diagnostics Temporary SMTP Override UI

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts`

- [ ] **Step 1: Add failing client test for SMTP override payload**

In `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`, add this test after `sends a test email to the edited recipient and shows success`:

```ts
	it("submits temporary SMTP override settings when provided", async () => {
		sendPlatformDiagnosticsTestEmailActionMock.mockResolvedValue({
			success: true,
			data: { recipient: "ops@example.com", messageId: "override-msg" },
		});
		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);

		fireEvent.change(screen.getByLabelText("Recipient email"), {
			target: { value: "ops@example.com" },
		});
		fireEvent.change(screen.getByLabelText("SMTP host"), {
			target: { value: "smtp.example.com" },
		});
		fireEvent.change(screen.getByLabelText("SMTP port"), {
			target: { value: "587" },
		});
		fireEvent.change(screen.getByLabelText("SMTP username"), {
			target: { value: "smtp-user" },
		});
		fireEvent.change(screen.getByLabelText("SMTP password"), {
			target: { value: "smtp-password" },
		});
		fireEvent.change(screen.getByLabelText("From email"), {
			target: { value: "noreply@example.com" },
		});
		fireEvent.change(screen.getByLabelText("From name"), {
			target: { value: "Z8 Ops" },
		});
		fireEvent.change(screen.getByLabelText("IP mode"), {
			target: { value: "ipv4" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send test email" }));

		await waitFor(() =>
			expect(screen.getByText("Test email sent to ops@example.com.")).toBeTruthy(),
		);
		expect(sendPlatformDiagnosticsTestEmailActionMock).toHaveBeenCalledWith({
			to: "ops@example.com",
			smtpOverride: {
				host: "smtp.example.com",
				port: 587,
				username: "smtp-user",
				password: "smtp-password",
				fromEmail: "noreply@example.com",
				fromName: "Z8 Ops",
				secure: true,
				requireTls: true,
				ipMode: "ipv4",
			},
		});
	});
```

- [ ] **Step 2: Run client tests and verify failure**

Run: `pnpm vitest run apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`

Expected: FAIL because SMTP override fields do not exist.

- [ ] **Step 3: Add diagnostics SMTP override state and payload builder**

In `diagnostics-client.tsx`, add state after `emailRecipient`:

```ts
	const [smtpOverride, setSmtpOverride] = useState({
		host: "",
		port: "587",
		username: "",
		password: "",
		fromEmail: "",
		fromName: "",
		secure: true,
		requireTls: true,
		ipMode: "auto" as "auto" | "ipv4" | "ipv6",
	});
```

Add this helper before `sendTestEmail()`:

```ts
	function buildSmtpOverrideInput() {
		const hasTextOverride =
			smtpOverride.host.trim().length > 0 ||
			smtpOverride.username.trim().length > 0 ||
			smtpOverride.password.length > 0 ||
			smtpOverride.fromEmail.trim().length > 0 ||
			smtpOverride.fromName.trim().length > 0;
		const hasControlOverride =
			smtpOverride.port !== "587" ||
			!smtpOverride.secure ||
			!smtpOverride.requireTls ||
			smtpOverride.ipMode !== "auto";

		if (!hasTextOverride && !hasControlOverride) {
			return undefined;
		}

		return {
			host: smtpOverride.host.trim(),
			port: Number.parseInt(smtpOverride.port, 10),
			username: smtpOverride.username.trim(),
			password: smtpOverride.password,
			fromEmail: smtpOverride.fromEmail.trim(),
			fromName: smtpOverride.fromName.trim() || undefined,
			secure: smtpOverride.secure,
			requireTls: smtpOverride.requireTls,
			ipMode: smtpOverride.ipMode,
		};
	}
```

Update the action call in `sendTestEmail()`:

```ts
			const result = await sendPlatformDiagnosticsTestEmailAction({
				to: emailRecipient,
				smtpOverride: buildSmtpOverrideInput(),
			});
```

- [ ] **Step 4: Render override fields**

In the Email Delivery Test `<CardContent>`, after the recipient/send row and before error rendering, add:

```tsx
					<div className="space-y-4 rounded-lg border p-4">
						<div className="space-y-1">
							<h3 className="text-sm font-medium">
								{t("admin:admin.diagnostics.emailTest.smtpOverride.title", "Temporary SMTP override")}
							</h3>
							<p className="text-sm text-muted-foreground">
								{t(
									"admin:admin.diagnostics.emailTest.smtpOverride.description",
									"Leave blank to use the configured system email transport. If filled, the test uses these SMTP settings only.",
								)}
							</p>
						</div>

						<div className="grid gap-3 md:grid-cols-2">
							<label className="space-y-2 text-sm font-medium">
								<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.host", "SMTP host")}</span>
								<input className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={smtpOverride.host} onChange={(event) => setSmtpOverride((current) => ({ ...current, host: event.target.value }))} disabled={isEmailPending} />
							</label>
							<label className="space-y-2 text-sm font-medium">
								<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.port", "SMTP port")}</span>
								<input className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" type="number" value={smtpOverride.port} onChange={(event) => setSmtpOverride((current) => ({ ...current, port: event.target.value }))} disabled={isEmailPending} />
							</label>
							<label className="space-y-2 text-sm font-medium">
								<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.username", "SMTP username")}</span>
								<input className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={smtpOverride.username} onChange={(event) => setSmtpOverride((current) => ({ ...current, username: event.target.value }))} disabled={isEmailPending} />
							</label>
							<label className="space-y-2 text-sm font-medium">
								<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.password", "SMTP password")}</span>
								<input className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" type="password" value={smtpOverride.password} onChange={(event) => setSmtpOverride((current) => ({ ...current, password: event.target.value }))} disabled={isEmailPending} />
							</label>
							<label className="space-y-2 text-sm font-medium">
								<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.fromEmail", "From email")}</span>
								<input className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" type="email" value={smtpOverride.fromEmail} onChange={(event) => setSmtpOverride((current) => ({ ...current, fromEmail: event.target.value }))} disabled={isEmailPending} />
							</label>
							<label className="space-y-2 text-sm font-medium">
								<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.fromName", "From name")}</span>
								<input className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={smtpOverride.fromName} onChange={(event) => setSmtpOverride((current) => ({ ...current, fromName: event.target.value }))} disabled={isEmailPending} />
							</label>
							<label className="space-y-2 text-sm font-medium">
								<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.ipMode", "IP mode")}</span>
								<select className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={smtpOverride.ipMode} onChange={(event) => setSmtpOverride((current) => ({ ...current, ipMode: event.target.value as "auto" | "ipv4" | "ipv6" }))} disabled={isEmailPending}>
									<option value="auto">{t("admin:admin.diagnostics.emailTest.smtpOverride.ipMode.auto", "Auto")}</option>
									<option value="ipv4">{t("admin:admin.diagnostics.emailTest.smtpOverride.ipMode.ipv4", "IPv4 only")}</option>
									<option value="ipv6">{t("admin:admin.diagnostics.emailTest.smtpOverride.ipMode.ipv6", "IPv6 only")}</option>
								</select>
							</label>
						</div>

						<div className="flex flex-col gap-3 text-sm md:flex-row md:gap-6">
							<label className="flex items-center gap-2 font-medium">
								<input type="checkbox" checked={smtpOverride.secure} onChange={(event) => setSmtpOverride((current) => ({ ...current, secure: event.target.checked }))} disabled={isEmailPending} />
								<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.secure", "Use TLS")}</span>
							</label>
							<label className="flex items-center gap-2 font-medium">
								<input type="checkbox" checked={smtpOverride.requireTls} onChange={(event) => setSmtpOverride((current) => ({ ...current, requireTls: event.target.checked }))} disabled={isEmailPending} />
								<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.requireTls", "Require STARTTLS")}</span>
							</label>
						</div>
					</div>
```

- [ ] **Step 5: Update diagnostics i18n guard**

In `diagnostics-client.i18n.test.ts`, add these literals to the array:

```ts
			"Temporary SMTP override",
			"SMTP host",
			"SMTP port",
			"SMTP username",
			"SMTP password",
			"From email",
			"From name",
			"IP mode",
			"IPv4 only",
			"IPv6 only",
```

- [ ] **Step 6: Run diagnostics client tests and verify pass**

Run: `pnpm vitest run apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit diagnostics UI changes**

Run:

```bash
git add apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts
git commit -m "feat(admin): add smtp override diagnostics ui"
```

Expected: commit succeeds and includes only the listed files.

## Task 6: Final Verification

**Files:**

- Verify only.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm vitest run apps/webapp/src/lib/email/transports/smtp-transport.test.ts apps/webapp/src/lib/email/email-service.test.ts apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.test.ts apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite if focused tests pass**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Run production build if tests pass**

Run: `CI=true pnpm build`

Expected: PASS.

- [ ] **Step 4: Inspect final git status**

Run: `git status --short`

Expected: only intentional changes remain. Do not stage or modify unrelated files such as pre-existing untracked plans.

- [ ] **Step 5: Commit final fixes if verification required changes**

If verification required fixes, commit only those files:

```bash
git add <changed-files-from-this-feature>
git commit -m "fix(email): stabilize smtp ip mode diagnostics"
```

Expected: commit succeeds. Skip this step if no additional changes were needed.

## Self-Review Notes

- Spec coverage: system SMTP env, organization SMTP persistence/UI, transport-level IP mode, diagnostics temporary SMTP override, SMTP-only fallback prevention, and safety requirements are each covered by tasks.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation steps remain.
- Type consistency: the plan uses `SmtpIpMode` for transport config and `EmailSmtpIpMode` for DB/action types; action/UI payloads use `ipMode` inside temporary overrides and `smtpIpMode` for saved organization config.
