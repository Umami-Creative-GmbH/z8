# Platform Admin Email Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add platform-admin email delivery testing to `/platform-admin/diagnostics` and show safe system Resend/SMTP configuration states.

**Architecture:** Keep diagnostics collection read-only by adding email provider status rows to `collectPlatformDiagnostics()`. Add a separate platform-admin-protected server action for the explicit send test, then render a small client form that defaults to the signed-in admin email and allows an override recipient.

**Tech Stack:** Next.js App Router server actions, React client component, Effect `PlatformAdminService`, Zod validation, existing `sendEmail()` service, Vitest, Testing Library, Tolgee translations.

---

## File Structure

- Modify `apps/webapp/src/lib/platform-diagnostics/collector.ts`: add small helpers for safe Resend and SMTP configuration status rows.
- Modify `apps/webapp/src/lib/platform-diagnostics/collector.test.ts`: verify email provider rows and no secret leakage.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts`: add `sendPlatformDiagnosticsTestEmailAction()`.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`: action-level authorization, validation, success, and safe failure tests.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx`: pass the signed-in platform admin email into the client.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx`: render the email delivery test card and wire the action.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`: verify render, default recipient, success, and failure behavior.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts`: add key client literals to the hardcoded-copy guard.

## Task 1: Email Provider Configuration Rows

**Files:**

- Modify: `apps/webapp/src/lib/platform-diagnostics/collector.ts`
- Modify: `apps/webapp/src/lib/platform-diagnostics/collector.test.ts`

- [ ] **Step 1: Write failing collector tests for configured providers and secret safety**

Add this test after `returns a healthy snapshot without leaking secret values` in `apps/webapp/src/lib/platform-diagnostics/collector.test.ts`:

```ts
	it("reports safe system email provider configuration states", async () => {
		const snapshot = await collectPlatformDiagnostics(
			buildDeps({
				env: {
					RESEND_API_KEY: "re_secret_that_must_not_leak",
					EMAIL_FROM: "ops@example.com",
					SMTP_HOST: "smtp.internal.example.com",
					SMTP_PORT: "587",
					SMTP_USERNAME: "smtp-user-that-must-not-leak",
					SMTP_PASSWORD: "smtp-password-that-must-not-leak",
					SMTP_FROM_EMAIL: "smtp-from@example.com",
				},
			}),
		);
		const serialized = JSON.stringify(snapshot);

		expect(snapshot.configuration).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "System Resend",
					status: "healthy",
					value: "Configured",
				}),
				expect.objectContaining({
					title: "System SMTP",
					status: "healthy",
					value: "Configured",
				}),
			]),
		);
		expect(serialized).not.toContain("re_secret_that_must_not_leak");
		expect(serialized).not.toContain("ops@example.com");
		expect(serialized).not.toContain("smtp.internal.example.com");
		expect(serialized).not.toContain("smtp-user-that-must-not-leak");
		expect(serialized).not.toContain("smtp-password-that-must-not-leak");
		expect(serialized).not.toContain("smtp-from@example.com");
	});
```

Add this test after it:

```ts
	it("reports missing and incomplete system email provider configuration safely", async () => {
		const snapshot = await collectPlatformDiagnostics(
			buildDeps({
				env: {
					SMTP_HOST: "smtp.internal.example.com",
					SMTP_PORT: "587",
					SMTP_USERNAME: "smtp-user-that-must-not-leak",
					SMTP_PASSWORD: undefined,
					SMTP_FROM_EMAIL: "smtp-from@example.com",
				},
			}),
		);
		const serialized = JSON.stringify(snapshot);

		expect(snapshot.configuration).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "System Resend",
					status: "disabled",
					value: "Not configured",
				}),
				expect.objectContaining({
					title: "System SMTP",
					status: "warning",
					value: "Incomplete",
				}),
			]),
		);
		expect(snapshot.overallStatus).toBe("warning");
		expect(serialized).not.toContain("smtp.internal.example.com");
		expect(serialized).not.toContain("smtp-user-that-must-not-leak");
		expect(serialized).not.toContain("smtp-from@example.com");
	});
```

- [ ] **Step 2: Run collector tests and verify failure**

Run: `pnpm vitest run apps/webapp/src/lib/platform-diagnostics/collector.test.ts`

Expected: FAIL because `System Resend` and `System SMTP` rows do not exist.

- [ ] **Step 3: Add safe email config helpers and rows**

In `apps/webapp/src/lib/platform-diagnostics/collector.ts`, add this constant after `STRIPE_KEYS`:

```ts
const SMTP_REQUIRED_KEYS = [
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_USERNAME",
	"SMTP_PASSWORD",
	"SMTP_FROM_EMAIL",
] as const;
```

Add these helpers after `buildTurnstileConfigItem()`:

```ts
function buildSystemResendConfigItem(env: DiagnosticsEnv): DiagnosticsItem {
	const configured = isConfigured(env.RESEND_API_KEY);

	return {
		title: "System Resend",
		status: configured ? "healthy" : "disabled",
		value: configured ? "Configured" : "Not configured",
		description: configured
			? "System Resend transport is available for fallback email delivery."
			: "System Resend transport is disabled unless RESEND_API_KEY is configured.",
	};
}

function buildSystemSmtpConfigItem(env: DiagnosticsEnv): DiagnosticsItem {
	const configuredCount = SMTP_REQUIRED_KEYS.filter((key) => isConfigured(env[key])).length;
	const configured = configuredCount === SMTP_REQUIRED_KEYS.length;
	const partiallyConfigured = configuredCount > 0 && !configured;

	return {
		title: "System SMTP",
		status: configured ? "healthy" : partiallyConfigured ? "warning" : "disabled",
		value: configured ? "Configured" : partiallyConfigured ? "Incomplete" : "Not configured",
		description: configured
			? "System SMTP transport is available for fallback email delivery."
			: partiallyConfigured
				? "System SMTP transport has only part of the required configuration."
				: "System SMTP transport is disabled unless all required SMTP variables are configured.",
	};
}
```

In the `configuration` array, place the rows after `buildTurnstileConfigItem(deps.env),`:

```ts
		buildTurnstileConfigItem(deps.env),
		buildSystemResendConfigItem(deps.env),
		buildSystemSmtpConfigItem(deps.env),
```

- [ ] **Step 4: Run collector tests and verify pass**

Run: `pnpm vitest run apps/webapp/src/lib/platform-diagnostics/collector.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit collector changes**

Run:

```bash
git add apps/webapp/src/lib/platform-diagnostics/collector.ts apps/webapp/src/lib/platform-diagnostics/collector.test.ts
git commit -m "feat(diagnostics): show email provider config"
```

Expected: commit succeeds and does not include unrelated files.

## Task 2: Protected Email Test Server Action

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`

- [ ] **Step 1: Write failing action tests**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	requirePlatformAdmin: vi.fn(),
	sendEmail: vi.fn(),
}));

vi.mock("@/lib/effect/services/platform-admin.service", async () => {
	const { Context, Effect, Layer } = await import("effect");

	class PlatformAdminService extends Context.Tag("PlatformAdminService")<
		PlatformAdminService,
		{
			readonly requirePlatformAdmin: () => Effect.Effect<
				{ userId: string; email: string },
				unknown
			>;
		}
	>() {}

	const PlatformAdminServiceLive = Layer.succeed(
		PlatformAdminService,
		PlatformAdminService.of({
			requirePlatformAdmin: () =>
				Effect.tryPromise({
					try: () => mockState.requirePlatformAdmin(),
					catch: (error) => error,
				}),
		}),
	);

	return { PlatformAdminService, PlatformAdminServiceLive };
});

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: mockState.sendEmail,
}));

async function importActions() {
	return await import("./actions");
}

describe("sendPlatformDiagnosticsTestEmailAction", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockState.requirePlatformAdmin.mockResolvedValue({
			userId: "admin-1",
			email: "admin@example.com",
		});
		mockState.sendEmail.mockResolvedValue({ success: true, messageId: "msg_123" });
	});

	it("requires platform admin access before sending", async () => {
		const { AuthorizationError } = await import("@/lib/effect/errors");
		mockState.requirePlatformAdmin.mockRejectedValue(
			new AuthorizationError({ message: "Platform admin access required" }),
		);
		const { sendPlatformDiagnosticsTestEmailAction } = await importActions();

		const result = await sendPlatformDiagnosticsTestEmailAction({ to: "ops@example.com" });

		expect(result).toEqual(expect.objectContaining({ success: false, error: "Platform admin access required" }));
		expect(mockState.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mockState.sendEmail).not.toHaveBeenCalled();
	});

	it("rejects invalid recipient emails", async () => {
		const { sendPlatformDiagnosticsTestEmailAction } = await importActions();

		const result = await sendPlatformDiagnosticsTestEmailAction({ to: "not-an-email" });

		expect(result).toEqual(expect.objectContaining({ success: false, error: "Enter a valid email address." }));
		expect(mockState.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mockState.sendEmail).not.toHaveBeenCalled();
	});

	it("sends a diagnostics email through the system email path", async () => {
		const { sendPlatformDiagnosticsTestEmailAction } = await importActions();

		const result = await sendPlatformDiagnosticsTestEmailAction({ to: "ops@example.com" });

		expect(result).toEqual({
			success: true,
			data: { recipient: "ops@example.com", messageId: "msg_123" },
		});
		expect(mockState.sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: "ops@example.com",
				subject: "Z8 platform diagnostics test email",
			}),
		);
		expect(mockState.sendEmail.mock.calls[0][0]).not.toHaveProperty("organizationId");
		expect(mockState.sendEmail.mock.calls[0][0].html).toContain("Z8 platform diagnostics");
	});

	it("returns a safe error when transport delivery fails", async () => {
		mockState.sendEmail.mockResolvedValue({
			success: false,
			error: "SMTP password was rejected by smtp.internal.example.com",
		});
		const { sendPlatformDiagnosticsTestEmailAction } = await importActions();

		const result = await sendPlatformDiagnosticsTestEmailAction({ to: "ops@example.com" });

		expect(result).toEqual(expect.objectContaining({ success: false, error: "Failed to send test email." }));
	});
});
```

- [ ] **Step 2: Run action tests and verify failure**

Run: `pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts'`

Expected: FAIL because `sendPlatformDiagnosticsTestEmailAction` does not exist.

- [ ] **Step 3: Add the server action**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts` imports:

```ts
import { z } from "zod";
import { sendEmail } from "@/lib/email/email-service";
import { EmailError, ValidationError } from "@/lib/effect/errors";
```

Add this schema and type after the imports:

```ts
const sendDiagnosticsTestEmailSchema = z.object({
	to: z.email("Enter a valid email address."),
});

export interface PlatformDiagnosticsEmailTestResult {
	recipient: string;
	messageId?: string;
}
```

Add this action after `refreshPlatformDiagnosticsAction()`:

```ts
export async function sendPlatformDiagnosticsTestEmailAction(input: {
	to: string;
}): Promise<ServerActionResult<PlatformDiagnosticsEmailTestResult>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		const parsed = sendDiagnosticsTestEmailSchema.safeParse(input);
		if (!parsed.success) {
			return yield* Effect.fail(
				new ValidationError({
					message: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
					field: "to",
					value: input.to,
				}),
			);
		}

		const recipient = parsed.data.to;
		const result = yield* Effect.promise(() =>
			sendEmail({
				to: recipient,
				subject: "Z8 platform diagnostics test email",
				html: `
					<p>This is a Z8 platform diagnostics test email.</p>
					<p>If you received this message, the system email transport accepted a diagnostics delivery request.</p>
				`,
			}),
		);

		if (!result.success) {
			return yield* Effect.fail(
				new EmailError({
					message: "Failed to send test email.",
					recipient,
				}),
			);
		}

		return {
			recipient,
			messageId: result.messageId,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
```

- [ ] **Step 4: Run action tests and verify pass**

Run: `pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts'`

Expected: PASS. The invalid email result may include `code: "ValidationError"`, and the delivery failure may include `code: "EmailError"`; the tests intentionally assert with `expect.objectContaining()` so the stable client-facing error text remains the contract.

- [ ] **Step 5: Commit action changes**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts'
git commit -m "feat(diagnostics): add email test action"
```

Expected: commit succeeds and does not include unrelated files.

## Task 3: Page Prop for Default Admin Email

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`

- [ ] **Step 1: Write failing client prop test**

In `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`, update existing renders to pass the new prop:

```tsx
render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);
```

Apply the same `adminEmail="admin@example.com"` prop to every existing `DiagnosticsClient` render in the file.

Add this test after `renders the initial diagnostics snapshot`:

```tsx
	it("defaults the email test recipient to the signed-in admin email", () => {
		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);

		expect(screen.getByLabelText("Recipient email")).toHaveProperty(
			"value",
			"admin@example.com",
		);
	});
```

- [ ] **Step 2: Run client tests and verify failure**

Run: `pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'`

Expected: FAIL because `DiagnosticsClient` does not accept `adminEmail` and the recipient input does not exist.

- [ ] **Step 3: Add the prop shape and pass it from the page**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx` props:

```tsx
export function DiagnosticsClient({
	initialSnapshot,
	adminEmail,
}: {
	initialSnapshot: PlatformDiagnosticsSnapshot;
	adminEmail: string;
}) {
```

Add recipient state near the existing `useState` calls:

```tsx
	const [emailRecipient, setEmailRecipient] = useState(adminEmail);
```

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx` imports:

```ts
import { Effect } from "effect";
import { AppLayer } from "@/lib/effect/runtime";
import { PlatformAdminService } from "@/lib/effect/services/platform-admin.service";
```

Modify the data load in `PlatformDiagnosticsPage()`:

```tsx
	const [t, snapshot, admin] = await Promise.all([
		getTranslate(),
		collectPlatformDiagnostics(),
		Effect.runPromise(
			Effect.gen(function* () {
				const adminService = yield* PlatformAdminService;
				return yield* adminService.requirePlatformAdmin();
			}).pipe(Effect.provide(AppLayer)),
		),
	]);
```

Update the client render:

```tsx
			<DiagnosticsClient initialSnapshot={snapshot} adminEmail={admin.email} />
```

Add this minimal email test card after the configuration/health grid and before the Key Manager card:

```tsx
			<Card>
				<CardHeader className="space-y-2">
					<CardTitle>{t("admin:admin.diagnostics.emailTest.title", "Email Delivery Test")}</CardTitle>
					<CardDescription>
						{t(
							"admin:admin.diagnostics.emailTest.description",
							"Send a diagnostics email through the system email transport.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<label className="space-y-2 text-sm font-medium">
						<span>{t("admin:admin.diagnostics.emailTest.recipient", "Recipient email")}</span>
						<input
							className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							type="email"
							value={emailRecipient}
							onChange={(event) => setEmailRecipient(event.target.value)}
						/>
					</label>
				</CardContent>
			</Card>
```

- [ ] **Step 4: Run client tests and verify pass**

Run: `pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'`

Expected: PASS.

- [ ] **Step 5: Commit page prop and minimal email card**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'
git commit -m "feat(diagnostics): default email test recipient"
```

Expected: commit succeeds and does not include unrelated files.

## Task 4: Email Delivery Test Client Card

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts`

- [ ] **Step 1: Extend action mock and write failing client behavior tests**

In `diagnostics-client.test.tsx`, update the hoisted mocks:

```ts
const {
	refreshPlatformDiagnosticsActionMock,
	testPlatformKeyManagerEncryptionActionMock,
	sendPlatformDiagnosticsTestEmailActionMock,
} = vi.hoisted(() => ({
	refreshPlatformDiagnosticsActionMock: vi.fn(),
	testPlatformKeyManagerEncryptionActionMock: vi.fn(),
	sendPlatformDiagnosticsTestEmailActionMock: vi.fn(),
}));
```

Update the `./actions` mock:

```ts
vi.mock("./actions", () => ({
	refreshPlatformDiagnosticsAction: refreshPlatformDiagnosticsActionMock,
	testPlatformKeyManagerEncryptionAction: testPlatformKeyManagerEncryptionActionMock,
	sendPlatformDiagnosticsTestEmailAction: sendPlatformDiagnosticsTestEmailActionMock,
}));
```

Add these tests before the Key Manager tests:

```tsx
	it("sends a test email to the edited recipient and shows success", async () => {
		sendPlatformDiagnosticsTestEmailActionMock.mockResolvedValue({
			success: true,
			data: { recipient: "ops@example.com", messageId: "msg_123" },
		});
		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);

		fireEvent.change(screen.getByLabelText("Recipient email"), {
			target: { value: "ops@example.com" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send test email" }));

		await waitFor(() => expect(screen.getByText("Test email sent to ops@example.com.")).toBeTruthy());
		expect(screen.getByText("Message ID: msg_123")).toBeTruthy();
		expect(sendPlatformDiagnosticsTestEmailActionMock).toHaveBeenCalledWith({
			to: "ops@example.com",
		});
	});

	it("shows an inline error when the email test fails", async () => {
		sendPlatformDiagnosticsTestEmailActionMock.mockResolvedValue({
			success: false,
			error: "Failed to send test email.",
		});
		render(<DiagnosticsClient initialSnapshot={snapshot()} adminEmail="admin@example.com" />);

		fireEvent.click(screen.getByRole("button", { name: "Send test email" }));

		await waitFor(() => expect(screen.getByText("Failed to send test email.")).toBeTruthy());
		expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("polite");
	});
```

- [ ] **Step 2: Run client tests and verify failure**

Run: `pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'`

Expected: FAIL because the card/action wiring does not exist.

- [ ] **Step 3: Implement client state and action wiring**

Modify the imports in `diagnostics-client.tsx`:

```tsx
import {
	refreshPlatformDiagnosticsAction,
	sendPlatformDiagnosticsTestEmailAction,
	testPlatformKeyManagerEncryptionAction,
} from "./actions";
```

Add state near the existing encryption state:

```tsx
	const [emailResult, setEmailResult] = useState<{
		recipient: string;
		messageId?: string;
	} | null>(null);
	const [emailError, setEmailError] = useState<string | null>(null);
```

Add transition state near the existing transitions:

```tsx
	const [isEmailPending, startEmailTransition] = useTransition();
```

Add this handler after `testEncryption()`:

```tsx
	function sendTestEmail() {
		setEmailError(null);
		setEmailResult(null);
		startEmailTransition(async () => {
			const result = await sendPlatformDiagnosticsTestEmailAction({ to: emailRecipient });

			if (result.success) {
				setEmailResult(result.data);
				return;
			}

			setEmailError(result.error);
		});
	}
```

Replace the minimal email test card from Task 3 with this fully wired version:

```tsx
			<Card>
				<CardHeader className="space-y-2">
					<CardTitle>{t("admin:admin.diagnostics.emailTest.title", "Email Delivery Test")}</CardTitle>
					<CardDescription>
						{t(
							"admin:admin.diagnostics.emailTest.description",
							"Send a diagnostics email through the system email transport.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
						<label className="space-y-2 text-sm font-medium">
							<span>{t("admin:admin.diagnostics.emailTest.recipient", "Recipient email")}</span>
							<input
								className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								type="email"
								value={emailRecipient}
								onChange={(event) => setEmailRecipient(event.target.value)}
								disabled={isEmailPending}
							/>
						</label>
						<Button onClick={sendTestEmail} disabled={isEmailPending || emailRecipient.trim().length === 0}>
							{isEmailPending ? (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							) : null}
							{t("admin:admin.diagnostics.emailTest.actions.send", "Send test email")}
						</Button>
					</div>
					{emailError ? (
						<div
							className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400"
							role="alert"
							aria-live="polite"
						>
							{emailError}
						</div>
					) : null}
					{emailResult ? (
						<div
							className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400"
							role="status"
							aria-live="polite"
						>
							<p>
								{t("admin:admin.diagnostics.emailTest.success", "Test email sent to {recipient}.", {
									recipient: emailResult.recipient,
								})}
							</p>
							{emailResult.messageId ? (
								<p className="font-mono">
									{t("admin:admin.diagnostics.emailTest.messageId", "Message ID: {messageId}", {
										messageId: emailResult.messageId,
									})}
								</p>
							) : null}
						</div>
					) : null}
				</CardContent>
			</Card>
```

- [ ] **Step 4: Add the i18n source guard literals**

In `diagnostics-client.i18n.test.ts`, extend the `literal` array:

```ts
			"Email Delivery Test",
			"Recipient email",
			"Send test email",
```

- [ ] **Step 5: Run client and i18n tests**

Run: `pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts'`

Expected: PASS.

- [ ] **Step 6: Commit page and client changes**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts'
git commit -m "feat(diagnostics): wire email test card"
```

Expected: commit succeeds and does not include unrelated files.

## Task 5: Final Verification

**Files:**

- Verify all modified diagnostics files.

- [ ] **Step 1: Run focused diagnostics tests**

Run:

```bash
pnpm vitest run apps/webapp/src/lib/platform-diagnostics/collector.test.ts 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts'
```

Expected: PASS for all four test files.

- [ ] **Step 2: Run type/lint-level verification if available through the repo test suite**

Run: `pnpm test -- --run apps/webapp/src/lib/platform-diagnostics/collector.test.ts`

Expected: PASS or the command reports that the project-level test runner does not accept that path. If it does not accept the path, keep the focused `pnpm vitest run ...` result as the verification evidence.

- [ ] **Step 3: Inspect git status and diff**

Run: `git status --short && git diff --stat`

Expected: only intended diagnostics/email test files are modified or the working tree is clean after commits. Existing unrelated changes in `apps/webapp/src/lib/approvals/server/absence-approvals.ts` and `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts` may remain and must not be modified or reverted.

- [ ] **Step 4: Final commit if any verification-only fixes were needed**

If Task 5 required code fixes, commit only those intended files:

```bash
git add apps/webapp/src/lib/platform-diagnostics/collector.ts apps/webapp/src/lib/platform-diagnostics/collector.test.ts 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.i18n.test.ts'
git commit -m "fix(diagnostics): stabilize email test"
```

Expected: commit succeeds. If no fixes were needed, skip this commit.
