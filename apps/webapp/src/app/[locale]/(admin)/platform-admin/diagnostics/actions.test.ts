import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACTIONS_PATH = fileURLToPath(new URL("./actions.ts", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

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

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { PlatformAdminService } = await import("@/lib/effect/services/platform-admin.service");

	return {
		AppLayer: Layer.succeed(
			PlatformAdminService,
			PlatformAdminService.of({
				requirePlatformAdmin: () =>
					Effect.tryPromise({
						try: () => mockState.requirePlatformAdmin(),
						catch: (error) => error,
					}),
			}),
		),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	return {
		runServerActionSafe: async <T, E, R>(effect: Effect.Effect<T, E, R>) => {
			const exit = await Effect.runPromiseExit(effect as Effect.Effect<T, E, never>);

			return Exit.match(exit, {
				onFailure: (cause) => {
					const defect = [...Cause.defects(cause)][0] ?? null;
					const failure = Option.getOrNull(Cause.failureOption(cause));
					const error = defect ?? failure ?? cause;

					if (error && typeof error === "object" && "_tag" in error) {
						return {
							success: false as const,
							error: (error as { message: string }).message,
							code: (error as { _tag: string })._tag,
						};
					}

					return {
						success: false as const,
						error: error instanceof Error ? error.message : "An unexpected error occurred",
						code: "UNKNOWN_ERROR",
					};
				},
				onSuccess: (data) => ({ success: true as const, data }),
			});
		},
	};
});

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: mockState.sendEmail,
}));

async function importActions() {
	return await import("./actions");
}

describe("platform diagnostics refresh action", () => {
	it("requires platform-admin authorization before collecting diagnostics", () => {
		const source = stripComments(readFileSync(ACTIONS_PATH, "utf8"));
		const authCheck = "adminService.requirePlatformAdmin()";
		const collectorCall = "collectPlatformDiagnostics()";

		expect(source).toContain('"use server"');
		expect(source).toContain("PlatformAdminService");
		expect(source).toContain(authCheck);
		expect(source).toContain(collectorCall);
		expect(source.indexOf(authCheck)).toBeLessThan(source.indexOf(collectorCall));
		expect(source).toContain("runServerActionSafe");
	});

	it("requires platform-admin authorization before testing platform key manager encryption", () => {
		const source = stripComments(readFileSync(ACTIONS_PATH, "utf8"));
		const actionStart = source.indexOf(
			"export async function testPlatformKeyManagerEncryptionAction",
		);
		expect(actionStart).toBeGreaterThanOrEqual(0);
		const actionSource = source.slice(actionStart);
		const authCheck = "adminService.requirePlatformAdmin()";
		const encryptionCall = "testPlatformKeyManagerEncryption(testValue)";
		const fakerCall = "faker.person.fullName()";

		expect(actionSource).toContain("PlatformAdminService");
		expect(actionSource).toContain(authCheck);
		expect(actionSource).toContain(fakerCall);
		expect(actionSource).toContain(encryptionCall);
		expect(actionSource.indexOf(authCheck)).toBeLessThan(actionSource.indexOf(fakerCall));
		expect(actionSource.indexOf(fakerCall)).toBeLessThan(actionSource.indexOf(encryptionCall));
		expect(actionSource).toContain("runServerActionSafe");
	});
});

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

		const result = await sendPlatformDiagnosticsTestEmailAction({
			to: "ops@example.com",
		});

		expect(result).toEqual(
			expect.objectContaining({
				success: false,
				error: "Platform admin access required",
			}),
		);
		expect(mockState.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mockState.sendEmail).not.toHaveBeenCalled();
	});

	it("rejects invalid recipient emails", async () => {
		const { sendPlatformDiagnosticsTestEmailAction } = await importActions();

		const result = await sendPlatformDiagnosticsTestEmailAction({
			to: "not-an-email",
		});

		expect(result).toEqual(
			expect.objectContaining({
				success: false,
				error: "Enter a valid email address.",
			}),
		);
		expect(mockState.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mockState.sendEmail).not.toHaveBeenCalled();
		expect(JSON.stringify(result)).not.toContain("not-an-email");
	});

	it("sends a diagnostics email through the system email path", async () => {
		const { sendPlatformDiagnosticsTestEmailAction } = await importActions();

		const result = await sendPlatformDiagnosticsTestEmailAction({
			to: "ops@example.com",
		});

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

		const result = await sendPlatformDiagnosticsTestEmailAction({
			to: "ops@example.com",
		});

		expect(result).toEqual(
			expect.objectContaining({
				success: false,
				error: "Failed to send test email.",
			}),
		);
	});

	it("returns a safe error when email delivery rejects", async () => {
		mockState.sendEmail.mockRejectedValue(
			new Error("SMTP password was rejected by smtp.internal.example.com"),
		);
		const { sendPlatformDiagnosticsTestEmailAction } = await importActions();

		const result = await sendPlatformDiagnosticsTestEmailAction({
			to: "ops@example.com",
		});

		expect(result).toEqual(
			expect.objectContaining({
				success: false,
				error: "Failed to send test email.",
			}),
		);
		expect(JSON.stringify(result)).not.toContain(
			"SMTP password was rejected by smtp.internal.example.com",
		);
	});
});
