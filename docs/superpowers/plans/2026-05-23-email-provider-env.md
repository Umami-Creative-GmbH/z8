# Email Provider Environment Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `EMAIL_PROVIDER=smtp|resend` so deployments can strictly choose the system default email provider.

**Architecture:** The setting is a server-only environment variable validated in `apps/webapp/src/env.ts`. System transport selection remains centralized in `apps/webapp/src/lib/email/email-service.ts`; organization-specific email configuration continues to bypass this setting and take precedence. Documentation is updated in `deploy/.env.template`.

**Tech Stack:** Next.js 16, TypeScript, Zod via `@t3-oss/env-nextjs`, Vitest, Resend, Nodemailer SMTP.

---

## File Structure

- Modify `apps/webapp/src/env.ts`: add optional `EMAIL_PROVIDER` validation and runtime wiring.
- Modify `apps/webapp/src/env.test.ts`: verify valid provider values pass and invalid values fail env validation.
- Modify `apps/webapp/src/lib/email/email-service.ts`: implement strict system provider selection while preserving current behavior when unset.
- Create `apps/webapp/src/lib/email/email-service.test.ts`: unit-test provider selection with mocked transports and mocked database access.
- Modify `deploy/.env.template`: document `EMAIL_PROVIDER` and current provider-specific variables.

## Task 1: Add Env Schema Coverage

**Files:**
- Modify: `apps/webapp/src/env.ts`
- Modify: `apps/webapp/src/env.test.ts`

- [ ] **Step 1: Write failing env tests**

Add these tests to `apps/webapp/src/env.test.ts` inside the existing `describe("env", () => { ... })` block:

```ts
test("accepts a strict system email provider", async () => {
	const { env } = await importEnv({ EMAIL_PROVIDER: "smtp" });

	expect(env.EMAIL_PROVIDER).toBe("smtp");
});

test("rejects invalid system email providers", async () => {
	vi.spyOn(process, "exit").mockImplementation((code) => {
		throw new Error(`process.exit:${code}`);
	});

	await expect(importEnv({ EMAIL_PROVIDER: "mailgun" })).rejects.toThrow("process.exit:1");
});
```

- [ ] **Step 2: Run the env tests and verify failure**

Run from `apps/webapp`:

```bash
pnpm test src/env.test.ts
```

Expected: the `accepts a strict system email provider` test fails because `EMAIL_PROVIDER` is not exposed on `env` yet.

- [ ] **Step 3: Add `EMAIL_PROVIDER` to the env schema**

In `apps/webapp/src/env.ts`, add this server variable near the existing email settings:

```ts
		// Email provider for system-level fallback. Organization configs take precedence.
		EMAIL_PROVIDER: z.enum(["smtp", "resend"]).optional(),
```

In the same file, add this to `runtimeEnv` near the SMTP variables:

```ts
		EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
```

- [ ] **Step 4: Run the env tests and verify pass**

Run from `apps/webapp`:

```bash
pnpm test src/env.test.ts
```

Expected: all tests in `src/env.test.ts` pass.

## Task 2: Implement Strict System Transport Selection

**Files:**
- Modify: `apps/webapp/src/lib/email/email-service.ts`
- Create: `apps/webapp/src/lib/email/email-service.test.ts`

- [ ] **Step 1: Write failing transport selection tests**

Create `apps/webapp/src/lib/email/email-service.test.ts` with this content:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbFindFirstMock = vi.hoisted(() => vi.fn());
const infoMock = vi.hoisted(() => vi.fn());
const debugMock = vi.hoisted(() => vi.fn());
const errorMock = vi.hoisted(() => vi.fn());
const warnMock = vi.hoisted(() => vi.fn());
const createSystemResendTransportMock = vi.hoisted(() => vi.fn());
const createSystemSmtpTransportMock = vi.hoisted(() => vi.fn());

vi.mock("@/db", () => ({
	db: {
		query: {
			organizationEmailConfig: {
				findFirst: dbFindFirstMock,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	organizationEmailConfig: {
		organizationId: "organizationId",
	},
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn((field, value) => ({ field, value })),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: debugMock,
		error: errorMock,
		info: infoMock,
		warn: warnMock,
	}),
}));

vi.mock("@/lib/vault", () => ({
	getOrgSecret: vi.fn(),
}));

vi.mock("./transports", () => ({
	ConsoleTransport: class ConsoleTransport {
		getName() {
			return "Console (Development)";
		}

		async send() {
			return { success: true, messageId: "console-message" };
		}
	},
	ResendTransport: class ResendTransport {},
	SmtpTransport: class SmtpTransport {},
	createSystemResendTransport: createSystemResendTransportMock,
	createSystemSmtpTransport: createSystemSmtpTransportMock,
}));

const originalEmailProvider = process.env.EMAIL_PROVIDER;

function makeTransport(name: string) {
	return {
		getName: () => name,
		send: vi.fn().mockResolvedValue({ success: true, messageId: `${name}-message` }),
	};
}

async function importEmailService() {
	vi.resetModules();
	return import("./email-service");
}

describe("email service system provider selection", () => {
	beforeEach(() => {
		delete process.env.EMAIL_PROVIDER;
		createSystemResendTransportMock.mockReset();
		createSystemSmtpTransportMock.mockReset();
		dbFindFirstMock.mockReset();
		infoMock.mockReset();
		debugMock.mockReset();
		errorMock.mockReset();
		warnMock.mockReset();
	});

	afterEach(() => {
		if (originalEmailProvider === undefined) {
			delete process.env.EMAIL_PROVIDER;
		} else {
			process.env.EMAIL_PROVIDER = originalEmailProvider;
		}
	});

	it("uses only Resend when EMAIL_PROVIDER is resend", async () => {
		process.env.EMAIL_PROVIDER = "resend";
		const resendTransport = makeTransport("Resend (System)");
		createSystemResendTransportMock.mockReturnValue(resendTransport);
		createSystemSmtpTransportMock.mockReturnValue(makeTransport("SMTP (smtp.example.com)"));
		const { sendEmail } = await importEmailService();

		await sendEmail({ to: "alex@example.com", subject: "Hello", html: "<p>Hello</p>" });

		expect(createSystemResendTransportMock).toHaveBeenCalledTimes(1);
		expect(createSystemSmtpTransportMock).not.toHaveBeenCalled();
		expect(resendTransport.send).toHaveBeenCalledTimes(1);
	});

	it("uses only SMTP when EMAIL_PROVIDER is smtp", async () => {
		process.env.EMAIL_PROVIDER = "smtp";
		const smtpTransport = makeTransport("SMTP (smtp.example.com)");
		createSystemResendTransportMock.mockReturnValue(makeTransport("Resend (System)"));
		createSystemSmtpTransportMock.mockReturnValue(smtpTransport);
		const { sendEmail } = await importEmailService();

		await sendEmail({ to: "alex@example.com", subject: "Hello", html: "<p>Hello</p>" });

		expect(createSystemResendTransportMock).not.toHaveBeenCalled();
		expect(createSystemSmtpTransportMock).toHaveBeenCalledTimes(1);
		expect(smtpTransport.send).toHaveBeenCalledTimes(1);
	});

	it("preserves Resend to SMTP fallback order when EMAIL_PROVIDER is unset", async () => {
		const smtpTransport = makeTransport("SMTP (smtp.example.com)");
		createSystemResendTransportMock.mockReturnValue(null);
		createSystemSmtpTransportMock.mockReturnValue(smtpTransport);
		const { sendEmail } = await importEmailService();

		await sendEmail({ to: "alex@example.com", subject: "Hello", html: "<p>Hello</p>" });

		expect(createSystemResendTransportMock).toHaveBeenCalledTimes(1);
		expect(createSystemSmtpTransportMock).toHaveBeenCalledTimes(1);
		expect(smtpTransport.send).toHaveBeenCalledTimes(1);
	});

	it("falls back to console when selected provider is not configured", async () => {
		process.env.EMAIL_PROVIDER = "smtp";
		createSystemSmtpTransportMock.mockReturnValue(null);
		const { sendEmail } = await importEmailService();

		const result = await sendEmail({
			to: "alex@example.com",
			subject: "Hello",
			html: "<p>Hello</p>",
		});

		expect(createSystemSmtpTransportMock).toHaveBeenCalledTimes(1);
		expect(createSystemResendTransportMock).not.toHaveBeenCalled();
		expect(result).toEqual({ success: true, messageId: "console-message" });
	});

	it("uses organization transport before the system provider", async () => {
		process.env.EMAIL_PROVIDER = "smtp";
		dbFindFirstMock.mockResolvedValue({
			isActive: true,
			transportType: "resend",
			fromEmail: "org@example.com",
			fromName: "Org Mail",
		});
		const { getOrgSecret } = await import("@/lib/vault");
		vi.mocked(getOrgSecret).mockResolvedValue("org-resend-key");
		const { sendEmail } = await importEmailService();

		await sendEmail({
			to: "alex@example.com",
			subject: "Hello",
			html: "<p>Hello</p>",
			organizationId: "org_123",
		});

		expect(createSystemSmtpTransportMock).not.toHaveBeenCalled();
		expect(createSystemResendTransportMock).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run the email service tests and verify failure**

Run from `apps/webapp`:

```bash
pnpm test src/lib/email/email-service.test.ts
```

Expected: the strict provider tests fail because `getSystemTransport()` still tries Resend before SMTP regardless of `EMAIL_PROVIDER`.

- [ ] **Step 3: Implement strict selection in `getSystemTransport()`**

In `apps/webapp/src/lib/email/email-service.ts`, replace the body of `getSystemTransport()` with:

```ts
function getSystemTransport(): EmailTransport {
	if (!systemTransport) {
		const provider = process.env.EMAIL_PROVIDER;
		const selectedTransport =
			provider === "resend"
				? createSystemResendTransport()
				: provider === "smtp"
					? createSystemSmtpTransport()
					: null;

		if (selectedTransport) {
			systemTransport = selectedTransport;
			logger.info({ transport: systemTransport.getName(), provider }, "System email transport initialized");
			return systemTransport;
		}

		if (provider) {
			systemTransport = new ConsoleTransport();
			logger.info(
				{ transport: systemTransport.getName(), provider },
				"System email transport initialized (selected provider unavailable - using console fallback)",
			);
			return systemTransport;
		}

		// Try Resend first when no strict provider is selected.
		const resendTransport = createSystemResendTransport();
		if (resendTransport) {
			systemTransport = resendTransport;
			logger.info({ transport: systemTransport.getName() }, "System email transport initialized");
			return systemTransport;
		}

		// Fall back to SMTP if Resend is not available.
		const smtpTransport = createSystemSmtpTransport();
		if (smtpTransport) {
			systemTransport = smtpTransport;
			logger.info({ transport: systemTransport.getName() }, "System email transport initialized");
			return systemTransport;
		}

		// Final fallback to console for development and unconfigured systems.
		systemTransport = new ConsoleTransport();
		logger.info(
			{ transport: systemTransport.getName() },
			"System email transport initialized (using console fallback - configure EMAIL_PROVIDER with RESEND_API_KEY or SMTP_* env vars for production)",
		);
	}
	return systemTransport;
}
```

- [ ] **Step 4: Run the email service tests and verify pass**

Run from `apps/webapp`:

```bash
pnpm test src/lib/email/email-service.test.ts
```

Expected: all tests in `src/lib/email/email-service.test.ts` pass.

## Task 3: Document the System Email Provider Switch

**Files:**
- Modify: `deploy/.env.template`

- [ ] **Step 1: Update email environment template**

Replace the current Email section in `deploy/.env.template` with:

```dotenv
# ===========================================
# Email (System Default)
# ===========================================
# Optional strict system email provider: resend or smtp.
# If unset, the app tries Resend first, then SMTP, then console fallback.
# Organization-specific email settings still take precedence.
# EMAIL_PROVIDER=resend

# Resend system provider
RESEND_API_KEY=
EMAIL_FROM=noreply@yourdomain.com

# SMTP system provider
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_FROM_EMAIL=noreply@yourdomain.com
SMTP_FROM_NAME=Z8
```

- [ ] **Step 2: Review the template diff**

Run from the repository root:

```bash
git diff -- deploy/.env.template
```

Expected: only the Email section changed, and it documents strict provider selection plus both provider configurations.

## Task 4: Final Verification

**Files:**
- Verify: `apps/webapp/src/env.ts`
- Verify: `apps/webapp/src/env.test.ts`
- Verify: `apps/webapp/src/lib/email/email-service.ts`
- Verify: `apps/webapp/src/lib/email/email-service.test.ts`
- Verify: `deploy/.env.template`

- [ ] **Step 1: Run focused tests**

Run from `apps/webapp`:

```bash
pnpm test src/env.test.ts src/lib/email/email-service.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run the full webapp test suite**

Run from `apps/webapp`:

```bash
pnpm test
```

Expected: the full Vitest suite passes.

- [ ] **Step 3: Inspect the final diff**

Run from the repository root:

```bash
git diff -- apps/webapp/src/env.ts apps/webapp/src/env.test.ts apps/webapp/src/lib/email/email-service.ts apps/webapp/src/lib/email/email-service.test.ts deploy/.env.template docs/superpowers/specs/2026-05-23-email-provider-env-design.md docs/superpowers/plans/2026-05-23-email-provider-env.md
```

Expected: the diff matches the approved design and does not include unrelated changes.

- [ ] **Step 4: Commit only if explicitly authorized**

Repository policy for this session says not to commit unless explicitly requested. If the user authorizes a commit, run from the repository root:

```bash
git status --short
git diff -- apps/webapp/src/env.ts apps/webapp/src/env.test.ts apps/webapp/src/lib/email/email-service.ts apps/webapp/src/lib/email/email-service.test.ts deploy/.env.template docs/superpowers/specs/2026-05-23-email-provider-env-design.md docs/superpowers/plans/2026-05-23-email-provider-env.md
git add apps/webapp/src/env.ts apps/webapp/src/env.test.ts apps/webapp/src/lib/email/email-service.ts apps/webapp/src/lib/email/email-service.test.ts deploy/.env.template docs/superpowers/specs/2026-05-23-email-provider-env-design.md docs/superpowers/plans/2026-05-23-email-provider-env.md
git commit -m "feat: add system email provider switch"
```

Expected: a commit is created with only the intended files.

## Self-Review

- Spec coverage: The plan adds `EMAIL_PROVIDER`, implements strict provider selection, preserves unset fallback behavior, keeps organization-specific config precedence, updates docs, and verifies validation/tests.
- Placeholder scan: No placeholder tasks remain; every code-changing step includes concrete code.
- Type consistency: The plan consistently uses `EMAIL_PROVIDER`, `EmailTransport`, `createSystemResendTransport`, and `createSystemSmtpTransport` as defined in the existing codebase.
