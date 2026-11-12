import { join } from "node:path";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTestText } from "@/test/read-test-text";

const mocks = vi.hoisted(() => ({
	signedIn: true,
	validateCode: vi.fn(),
	setPendingInviteCode: vi.fn(),
	processPendingInviteCode: vi.fn(),
	useCode: vi.fn(),
}));

vi.mock("@/lib/effect/services/invite-code.service", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/lib/effect/services/invite-code.service")>();
	return {
		...original,
		InviteCodeServiceLive: Layer.succeed(
			original.InviteCodeService,
			original.InviteCodeService.of({
				validateCode: (code: string) => Effect.sync(() => mocks.validateCode(code)),
				setPendingInviteCode: (userId: string, code: string) =>
					Effect.sync(() => mocks.setPendingInviteCode(userId, code)),
				processPendingInviteCode: (userId: string) =>
					Effect.sync(() => mocks.processPendingInviteCode(userId)),
				useCode: (input: unknown) => Effect.sync(() => mocks.useCode(input)),
			} as never),
		),
	};
});

// The shared runtime over a stubbed AuthService: the signed-in user is "user-1".
vi.mock("@/lib/effect/runtime", async () => {
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { AuthenticationError } = await import("@/lib/effect/errors");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		Layer.mergeAll(
			Layer.succeed(
				AuthService,
				AuthService.of({
					getSession: () =>
						mocks.signedIn
							? Effect.succeed({
									user: { id: "user-1" },
									session: { id: "session-1", userId: "user-1" },
								} as never)
							: Effect.fail(new AuthenticationError({ message: "No session found" })),
				}),
			),
			Layer.succeed(DatabaseService, {} as never),
		),
	);
});

import {
	processPendingInviteCode,
	redeemInviteCode,
	storePendingInviteCode,
	validateInviteCode,
} from "./invite-code-actions";

const preMembershipActions = [
	"validateInviteCode",
	"storePendingInviteCode",
	"processPendingInviteCode",
	"redeemInviteCode",
] as const;

describe("pre-membership invite-code actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.signedIn = true;
	});

	it("validates a code without a session", async () => {
		mocks.signedIn = false;
		mocks.validateCode.mockReturnValue({ valid: true });

		const result = await validateInviteCode("JOIN-TEAM");

		expect(result).toEqual({ success: true, data: { valid: true } });
		expect(mocks.validateCode).toHaveBeenCalledWith("JOIN-TEAM");
	});

	it("stores a pending code for the signed-in user", async () => {
		const result = await storePendingInviteCode("JOIN-TEAM");

		expect(result.success).toBe(true);
		expect(mocks.setPendingInviteCode).toHaveBeenCalledWith("user-1", "JOIN-TEAM");
	});

	it("refuses to store a pending code without a session", async () => {
		mocks.signedIn = false;

		const result = await storePendingInviteCode("JOIN-TEAM");

		expect(result.success).toBe(false);
		expect(mocks.setPendingInviteCode).not.toHaveBeenCalled();
	});

	it("processes the signed-in user's pending code", async () => {
		mocks.processPendingInviteCode.mockReturnValue({
			success: true,
			status: "pending",
			organizationName: "Acme",
			organizationId: "org-1",
		});

		const result = await processPendingInviteCode();

		expect(result).toEqual({
			success: true,
			data: { success: true, status: "pending", organizationName: "Acme" },
		});
		expect(mocks.processPendingInviteCode).toHaveBeenCalledWith("user-1");
	});

	it("returns null when the user has no pending code", async () => {
		mocks.processPendingInviteCode.mockReturnValue(null);

		expect(await processPendingInviteCode()).toEqual({
			success: true,
			data: null,
		});
	});


	it("redeems a code as the signed-in user", async () => {
		mocks.useCode.mockReturnValue({
			success: true,
			status: "approved",
			organizationName: "Acme",
			organizationId: "org-1",
		});

		const result = await redeemInviteCode("JOIN-TEAM", "203.0.113.1", "ua");

		expect(result).toEqual({
			success: true,
			data: { success: true, status: "approved", organizationName: "Acme" },
		});
		expect(mocks.useCode).toHaveBeenCalledWith({
			code: "JOIN-TEAM",
			userId: "user-1",
			ipAddress: "203.0.113.1",
			userAgent: "ua",
		});
	});

	it("is no longer exported from the settings route", () => {
		const settingsSource = readTestText(
			join(import.meta.dirname, "../(app)/settings/organization/invite-code-actions.ts"),
			"utf8",
		);
		for (const action of preMembershipActions) {
			expect(settingsSource, action).not.toMatch(new RegExp(`export async function ${action}\\b`));
		}
	});
});
