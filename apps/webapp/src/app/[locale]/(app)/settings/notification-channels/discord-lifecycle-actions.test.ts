import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
	prepareDiscordCandidateInstallation: vi.fn(),
	getDiscordCandidateSetupView: vi.fn(),
	buildChatSwitchImpactPreview: vi.fn(),
	getChatInstallationRecoveryState: vi.fn(),
	retryDiscordCandidateCommandRegistration: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/chat-installations", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-installations")>();
	return {
		...actual,
		prepareDiscordCandidateInstallation: mocks.prepareDiscordCandidateInstallation,
		getDiscordCandidateSetupView: mocks.getDiscordCandidateSetupView,
		buildChatSwitchImpactPreview: mocks.buildChatSwitchImpactPreview,
		getChatInstallationRecoveryState: mocks.getChatInstallationRecoveryState,
		retryDiscordCandidateCommandRegistration: mocks.retryDiscordCandidateCommandRegistration,
	};
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { DatabaseError } = await import("@/lib/effect/errors");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {},
			query: (name, fn) =>
				Effect.tryPromise({
					try: fn,
					catch: (cause) =>
						new DatabaseError({
							message: `Database error during ${name}`,
							operation: name,
							cause,
						}),
				}),
		}),
	);
});

import {
	getDiscordLifecycleState,
	prepareDiscordCandidate,
	retryDiscordCandidateCommands,
} from "./discord-lifecycle-actions";

const orgAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};

const memberCaller: StubCaller = {
	userId: "user-member",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-1", role: "employee", former: false },
};

describe("discord-lifecycle-actions", () => {
	beforeEach(() => {
		mocks.caller = orgAdmin;
		mocks.revalidatePath.mockReset();
		mocks.prepareDiscordCandidateInstallation.mockReset();
		mocks.getDiscordCandidateSetupView.mockReset();
		mocks.buildChatSwitchImpactPreview.mockReset();
		mocks.getChatInstallationRecoveryState.mockReset();
		mocks.retryDiscordCandidateCommandRegistration.mockReset();

		mocks.getDiscordCandidateSetupView.mockResolvedValue(null);
		mocks.buildChatSwitchImpactPreview.mockResolvedValue({ impactDigest: "a".repeat(64) });
		mocks.getChatInstallationRecoveryState.mockResolvedValue({ provider: "discord" });
	});

	it("refuses non-orgAdmin callers cleanly without invoking Discord lifecycle services", async () => {
		mocks.caller = memberCaller;
		const res = await getDiscordLifecycleState();
		expect(res).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.getDiscordCandidateSetupView).not.toHaveBeenCalled();
	});

	it("prepares a Discord candidate and revalidates the settings path for org admins", async () => {
		mocks.prepareDiscordCandidateInstallation.mockResolvedValue({ installationId: "inst-1" });
		const res = await prepareDiscordCandidate();
		expect(res.success).toBe(true);
		expect(mocks.prepareDiscordCandidateInstallation).toHaveBeenCalledWith(
			{ organizationId: "org-1", actorUserId: "user-admin" },
			expect.any(Object),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/notification-channels");
	});

	it("supports retrying Discord slash command registration via orgAdmin action", async () => {
		const installationId = "10000000-0000-4000-8000-000000000001";
		mocks.retryDiscordCandidateCommandRegistration.mockResolvedValue({
			kind: "ok",
			commandsRegistered: true,
			view: { installationId },
		});

		const res = await retryDiscordCandidateCommands({ installationId });
		expect(res.success).toBe(true);
		expect(mocks.retryDiscordCandidateCommandRegistration).toHaveBeenCalledWith(
			{ organizationId: "org-1", actorUserId: "user-admin", installationId },
			expect.any(Object),
		);
	});
});
