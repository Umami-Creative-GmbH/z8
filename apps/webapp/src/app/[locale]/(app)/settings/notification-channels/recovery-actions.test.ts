import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ChatInstallationRecoveryState,
	ChatSwitchImpactPreview,
} from "@/lib/chat-installations";
import { getProviderRotationGuidance } from "@/lib/chat-installations";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
	getChatInstallationRecoveryState: vi.fn(),
	rotateChatInstallationCredentials: vi.fn(),
	revokeChatInstallation: vi.fn(),
	beginChatInstallationRestore: vi.fn(),
	verifyRestoredChatInstallation: vi.fn(),
	confirmChatInstallationRestore: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/chat-installations", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-installations")>();
	return {
		...actual,
		getChatInstallationRecoveryState: mocks.getChatInstallationRecoveryState,
		rotateChatInstallationCredentials: mocks.rotateChatInstallationCredentials,
		revokeChatInstallation: mocks.revokeChatInstallation,
		beginChatInstallationRestore: mocks.beginChatInstallationRestore,
		verifyRestoredChatInstallation: mocks.verifyRestoredChatInstallation,
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
	confirmSlackInstallationRestore,
	getSlackRecoveryState,
	prepareSlackInstallationRestore,
	revokeSlackInstallation,
	rotateSlackInstallationCredentials,
	verifySlackInstallationRestore,
} from "./recovery-actions";

const orgAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};

const demotedMember: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-1", role: "employee", former: false },
};

const formerAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "emp-1", role: "admin", former: true },
};

const sampleInstId = "11111111-1111-4111-8111-111111111111";
const sampleRevId = "22222222-2222-4222-8222-222222222222";
const sampleDigest = "c".repeat(64);

const sampleRecoveryState: ChatInstallationRecoveryState = {
	organizationId: "org-1",
	provider: "slack",
	activeInstallation: {
		id: sampleInstId,
		provider: "slack",
		credentialSource: "organization_owned",
		status: "active",
		routeId: "route-slack-1",
		externalAppId: "A_SLACK_1",
		externalBotId: "U_BOT_1",
		externalBotUsername: "z8-acme",
		externalDisplayName: "Z8 Acme",
		externalSpaceId: "T_ORG",
		externalSpaceName: "Acme",
		activeCredentialRevisionId: sampleRevId,
		verificationState: "verified",
		endpointGeneration: 1,
		endpointState: "synced",
		lastVerifiedAt: "2026-11-26T12:00:00.000Z",
		rotatedAt: null,
		retiredAt: null,
		revokedAt: null,
		canRotate: true,
		canRevoke: true,
		canRestore: false,
	},
	restorableInstallations: [],
	restoreCandidateSetup: null,
	restoreCandidatePreview: null,
	pendingCleanupJobs: [],
	rotationGuidance: getProviderRotationGuidance("slack"),
};

const samplePreview: ChatSwitchImpactPreview = {
	organizationId: "org-1",
	provider: "slack",
	generatedAt: "2026-11-26T12:10:00.000Z",
	switchControlEnabled: true,
	blockers: [],
	hasHardBlockers: false,
	currentInstallations: [],
	primaryCurrentInstallationId: null,
	primaryCurrentCredentialRevisionId: null,
	candidateInstallation: null,
	candidateReady: true,
	candidateVerificationState: "verified",
	retiringInstallations: [],
	employeeImpact: {
		totalActiveEmployees: 2,
		verifiedReachableEmployees: 2,
		actionNeededEmployees: 0,
		unknownReachabilityEmployees: 0,
		carryForwardIdentityEmployees: 0,
		unreadyEmployees: 0,
	},
	approvalImpact: {
		openCanonicalCards: 0,
		openLegacyOwnerCards: 0,
		outstandingDeliveryWork: 0,
		outstandingRefreshWork: 0,
		uncertainApprovalWork: 0,
		pendingLegacyCards: 0,
		totalOutstanding: 0,
	},
	inFlightNotificationImpact: { total: 0, intentRecorded: 0, reconciliationRequired: 0 },
	effectiveSettings: {
		enableApprovals: true,
		enableCommands: true,
		enableDailyDigest: true,
		enableEscalations: true,
		digestTime: "08:00",
		digestTimezone: "UTC",
		escalationTimeoutHours: 24,
	},
	requiresUnreadyAcknowledgement: false,
	canConfirm: true,
	impactDigest: sampleDigest,
};

describe("Slack recovery server actions (#2046)", () => {
	beforeEach(() => {
		mocks.caller = orgAdmin;
		vi.clearAllMocks();
		mocks.getChatInstallationRecoveryState.mockResolvedValue(sampleRecoveryState);
		mocks.rotateChatInstallationCredentials.mockResolvedValue({
			kind: "rotated",
			installationId: sampleInstId,
			routeId: "route-slack-1",
			provider: "slack",
			previousRevisionId: sampleRevId,
			newRevisionId: "33333333-3333-4333-8333-333333333333",
			newRevisionNumber: 2,
			queuedCleanupJobId: "44444444-4444-4444-8444-444444444444",
			guidance: getProviderRotationGuidance("slack"),
		});
		mocks.revokeChatInstallation.mockResolvedValue({
			kind: "revoked",
			installationId: sampleInstId,
			provider: "slack",
			endpointGeneration: 2,
			queuedCredentialCleanupCount: 1,
			queuedEndpointCleanup: true,
		});
		mocks.beginChatInstallationRestore.mockResolvedValue({
			kind: "restore_started",
			installationId: sampleInstId,
			routeId: "route-slack-1",
			provider: "slack",
			endpointGeneration: 3,
			endpointState: "synced",
			requiresCredentials: true,
			status: "candidate",
		});
		mocks.verifyRestoredChatInstallation.mockResolvedValue({
			kind: "verified_step",
			installationId: sampleInstId,
			provider: "slack",
			readyForSwitch: true,
			verificationState: "verified",
			activeCredentialRevisionId: sampleRevId,
		});
		mocks.confirmChatInstallationRestore.mockResolvedValue({
			kind: "switched",
			activeInstallationId: sampleInstId,
			retiredInstallationIds: [],
			retirementDeadlineAt: "2026-12-26T12:10:00.000Z",
			carriedForwardIdentityCount: 0,
			promotedEnrollmentCount: 0,
			effectiveSettings: samplePreview.effectiveSettings,
			preview: samplePreview,
		});
	});

	it("rechecks current org-admin access and refuses demoted, former, or signed-out callers across rotate, revoke, and restore", async () => {
		expect(await getSlackRecoveryState()).toEqual({ success: true, data: sampleRecoveryState });

		mocks.caller = demotedMember;
		expect(
			await rotateSlackInstallationCredentials({
				installationId: sampleInstId,
				botToken: "xoxb-new-token-123456",
				signingSecret: "new_signing_secret_0123456789",
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(await revokeSlackInstallation({ installationId: sampleInstId })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await prepareSlackInstallationRestore({ installationId: sampleInstId })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});

		mocks.caller = formerAdmin;
		expect(
			await confirmSlackInstallationRestore({
				candidateInstallationId: sampleInstId,
				reviewedCurrentInstallationId: null,
				reviewedCurrentCredentialRevisionId: null,
				reviewedCandidateCredentialRevisionId: sampleRevId,
				reviewedImpactDigest: sampleDigest,
				acknowledgeUnreadyEmployees: false,
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });

		mocks.caller = null;
		expect(await verifySlackInstallationRestore({ installationId: sampleInstId })).toMatchObject({
			success: false,
			code: "AuthenticationError",
		});

		expect(mocks.rotateChatInstallationCredentials).not.toHaveBeenCalled();
		expect(mocks.revokeChatInstallation).not.toHaveBeenCalled();
		expect(mocks.beginChatInstallationRestore).not.toHaveBeenCalled();
		expect(mocks.confirmChatInstallationRestore).not.toHaveBeenCalled();
	});

	it("propagates external_identity_mismatch refusal on rotation without revalidating", async () => {
		mocks.rotateChatInstallationCredentials.mockResolvedValueOnce({
			kind: "refused",
			code: "external_identity_mismatch",
			message: "Different Slack app",
		});

		const result = await rotateSlackInstallationCredentials({
			installationId: sampleInstId,
			botToken: "xoxb-wrong-app-token",
			signingSecret: "signing_secret_0123456789abcdef",
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "external_identity_mismatch",
		});
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("rotates, revokes, prepares restore, verifies restore, and confirms restore with revalidation", async () => {
		const rotated = await rotateSlackInstallationCredentials({
			installationId: sampleInstId,
			botToken: "xoxb-valid-rotated-token",
			signingSecret: "rotated_signing_secret_0123456789",
		});
		expect(rotated.success).toBe(true);

		const revoked = await revokeSlackInstallation({
			installationId: sampleInstId,
			reason: "compromised_token",
		});
		expect(revoked.success).toBe(true);

		const prepared = await prepareSlackInstallationRestore({ installationId: sampleInstId });
		expect(prepared.success).toBe(true);

		const verified = await verifySlackInstallationRestore({
			installationId: sampleInstId,
			botToken: "xoxb-valid-restored-token",
			signingSecret: "restored_signing_secret_0123456789",
			slackUserId: "U01234567",
		});
		expect(verified.success).toBe(true);

		const confirmed = await confirmSlackInstallationRestore({
			candidateInstallationId: sampleInstId,
			reviewedCurrentInstallationId: null,
			reviewedCurrentCredentialRevisionId: null,
			reviewedCandidateCredentialRevisionId: sampleRevId,
			reviewedImpactDigest: sampleDigest,
			acknowledgeUnreadyEmployees: false,
		});
		expect(confirmed.success).toBe(true);
		expect(mocks.revalidatePath).toHaveBeenCalledTimes(5);
	});

	it("returns ValidationError with fresh preview details when restore impact drifts", async () => {
		mocks.confirmChatInstallationRestore.mockResolvedValueOnce({
			kind: "refused",
			code: "impact_changed",
			message: "Impact changed",
			freshPreview: samplePreview,
		});

		const result = await confirmSlackInstallationRestore({
			candidateInstallationId: sampleInstId,
			reviewedCurrentInstallationId: null,
			reviewedCurrentCredentialRevisionId: null,
			reviewedCandidateCredentialRevisionId: sampleRevId,
			reviewedImpactDigest: "d".repeat(64),
			acknowledgeUnreadyEmployees: false,
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "impact_changed",
			details: { preview: samplePreview },
		});
	});
});
