import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
	getTelegramCandidateSetupView: vi.fn(),
	prepareTelegramCandidateInstallation: vi.fn(),
	configureTelegramCandidateCredentials: vi.fn(),
	retryTelegramCandidateCommandRegistration: vi.fn(),
	retryTelegramCandidateWebhookRegistration: vi.fn(),
	sendTelegramCandidateTestMessage: vi.fn(),
	rotateTelegramInstallationCredentials: vi.fn(),
	buildChatSwitchImpactPreview: vi.fn(),
	confirmChatInstallationSwitch: vi.fn(),
	getChatInstallationRecoveryState: vi.fn(),
	revokeChatInstallation: vi.fn(),
	beginChatInstallationRestore: vi.fn(),
	confirmChatInstallationRestore: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/chat-installations/telegram-setup", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-installations/telegram-setup")>();
	return {
		...actual,
		getTelegramCandidateSetupView: mocks.getTelegramCandidateSetupView,
		prepareTelegramCandidateInstallation: mocks.prepareTelegramCandidateInstallation,
		configureTelegramCandidateCredentials: mocks.configureTelegramCandidateCredentials,
		retryTelegramCandidateCommandRegistration: mocks.retryTelegramCandidateCommandRegistration,
		retryTelegramCandidateWebhookRegistration: mocks.retryTelegramCandidateWebhookRegistration,
		sendTelegramCandidateTestMessage: mocks.sendTelegramCandidateTestMessage,
		rotateTelegramInstallationCredentials: mocks.rotateTelegramInstallationCredentials,
	};
});

vi.mock("@/lib/chat-installations", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-installations")>();
	return {
		...actual,
		buildChatSwitchImpactPreview: mocks.buildChatSwitchImpactPreview,
		confirmChatInstallationSwitch: mocks.confirmChatInstallationSwitch,
		getChatInstallationRecoveryState: mocks.getChatInstallationRecoveryState,
		revokeChatInstallation: mocks.revokeChatInstallation,
		beginChatInstallationRestore: mocks.beginChatInstallationRestore,
		confirmChatInstallationRestore: mocks.confirmChatInstallationRestore,
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
	confirmTelegramInstallationSwitch,
	getTelegramLifecycleState,
	prepareTelegramCandidate,
	retryTelegramCandidateCommands,
	rotateTelegramCredentials,
} from "./telegram-lifecycle-actions";

const orgAdmin: StubCaller = {
	userId: "admin-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};

const memberCaller: StubCaller = {
	userId: "member-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-1", role: "employee", former: false },
};

describe("telegram-lifecycle-actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
		mocks.getTelegramCandidateSetupView.mockResolvedValue(null);
		mocks.buildChatSwitchImpactPreview.mockResolvedValue({
			organizationId: "org-1",
			provider: "telegram",
			impactDigest: "a".repeat(64),
		});
		mocks.getChatInstallationRecoveryState.mockResolvedValue({
			organizationId: "org-1",
			provider: "telegram",
			activeInstallation: null,
			restorableInstallations: [],
			pendingCleanupJobs: [],
		});
	});

	it("rejects non-admin members via organizationAction orgAdmin guard", async () => {
		mocks.caller = memberCaller;
		const res = await prepareTelegramCandidate();
		expect(res.success).toBe(false);
		expect(mocks.prepareTelegramCandidateInstallation).not.toHaveBeenCalled();
	});

	it("loads Telegram lifecycle state and prepares a candidate for org admins", async () => {
		const loaded = await getTelegramLifecycleState();
		expect(loaded.success).toBe(true);
		expect(mocks.getTelegramCandidateSetupView).toHaveBeenCalledWith("org-1", expect.anything());

		mocks.prepareTelegramCandidateInstallation.mockResolvedValue({
			installationId: "11111111-1111-4111-8111-111111111111",
		});
		const prepared = await prepareTelegramCandidate();
		expect(prepared.success).toBe(true);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/notification-channels");
	});

	it("surfaces stale switch impact preview in ValidationError details on impact_changed refusal", async () => {
		const freshPreview = {
			organizationId: "org-1",
			provider: "telegram",
			impactDigest: "b".repeat(64),
		};
		mocks.confirmChatInstallationSwitch.mockResolvedValue({
			kind: "refused",
			code: "impact_changed",
			message: "Impact changed",
			freshPreview,
		});

		const res = await confirmTelegramInstallationSwitch({
			candidateInstallationId: "11111111-1111-4111-8111-111111111111",
			reviewedCurrentInstallationId: null,
			reviewedCurrentCredentialRevisionId: null,
			reviewedCandidateCredentialRevisionId: "22222222-2222-4222-8222-222222222222",
			reviewedImpactDigest: "a".repeat(64),
			acknowledgeUnreadyEmployees: true,
		});

		expect(res.success).toBe(false);
		if (!res.success) {
			expect(res.refusal).toBe("impact_changed");
		}
	});

	it("retries commands and rotates credentials for org admins", async () => {
		mocks.retryTelegramCandidateCommandRegistration.mockResolvedValue({
			kind: "ok",
			view: { installationId: "11111111-1111-4111-8111-111111111111" },
		});
		const retried = await retryTelegramCandidateCommands({
			installationId: "11111111-1111-4111-8111-111111111111",
		});
		expect(retried.success).toBe(true);

		mocks.rotateTelegramInstallationCredentials.mockResolvedValue({
			kind: "refused",
			code: "external_identity_mismatch",
			message: "Different bot ID",
		});
		const rotated = await rotateTelegramCredentials({
			installationId: "11111111-1111-4111-8111-111111111111",
			botToken: "999999:AADifferentBotToken1234567890",
		});
		expect(rotated.success).toBe(false);
		if (!rotated.success) {
			expect(rotated.refusal).toBe("external_identity_mismatch");
		}
	});
});
