import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ChatSwitchImpactPreview,
	ProviderCapabilityDisclosure,
} from "@/lib/chat-installations";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
	buildChatSwitchImpactPreview: vi.fn(),
	confirmChatInstallationSwitch: vi.fn(),
	getProviderCapabilityDisclosure: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/chat-installations", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-installations")>();
	return {
		...actual,
		buildChatSwitchImpactPreview: mocks.buildChatSwitchImpactPreview,
		confirmChatInstallationSwitch: mocks.confirmChatInstallationSwitch,
		getProviderCapabilityDisclosure: mocks.getProviderCapabilityDisclosure,
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
	confirmSlackInstallationSwitch,
	getProviderCapabilityDisclosure,
	getSlackSwitchImpactPreview,
} from "./slack-switch-actions";

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

const sampleDigest = "a".repeat(64);
const sampleCandidateId = "11111111-1111-4111-8111-111111111111";
const sampleCurrentId = "22222222-2222-4222-8222-222222222222";
const sampleCandidateRevId = "33333333-3333-4333-8333-333333333333";

const samplePreview: ChatSwitchImpactPreview = {
	organizationId: "org-1",
	provider: "slack",
	generatedAt: "2026-11-26T12:00:00.000Z",
	switchControlEnabled: true,
	blockers: [],
	hasHardBlockers: false,
	currentInstallations: [
		{
			id: sampleCurrentId,
			status: "legacy_active",
			credentialSource: "deployment_managed",
			externalAppId: null,
			externalBotId: "U_OLD",
			externalBotUsername: null,
			externalDisplayName: "Legacy Slack",
			externalSpaceId: "T_ORG",
			externalSpaceName: "Acme",
			activeCredentialRevisionId: null,
			legacyTable: "slack_workspace_config",
			legacyRecordId: "44444444-4444-4444-8444-444444444444",
			verificationState: "unverified",
			lastVerifiedAt: null,
		},
	],
	primaryCurrentInstallationId: sampleCurrentId,
	primaryCurrentCredentialRevisionId: null,
	candidateInstallation: {
		id: sampleCandidateId,
		status: "candidate",
		credentialSource: "organization_owned",
		externalAppId: "A_NEW",
		externalBotId: "U_NEW",
		externalBotUsername: "z8-acme",
		externalDisplayName: "Z8 Acme",
		externalSpaceId: "T_ORG",
		externalSpaceName: "Acme",
		activeCredentialRevisionId: sampleCandidateRevId,
		legacyTable: null,
		legacyRecordId: null,
		verificationState: "verified",
		lastVerifiedAt: "2026-11-26T12:00:00.000Z",
	},
	candidateReady: true,
	candidateVerificationState: "verified",
	retiringInstallations: [],
	employeeImpact: {
		totalActiveEmployees: 4,
		verifiedReachableEmployees: 1,
		actionNeededEmployees: 1,
		unknownReachabilityEmployees: 2,
		carryForwardIdentityEmployees: 2,
		unreadyEmployees: 3,
	},
	approvalImpact: {
		openCanonicalCards: 2,
		openLegacyOwnerCards: 0,
		outstandingDeliveryWork: 1,
		outstandingRefreshWork: 1,
		uncertainApprovalWork: 0,
		pendingLegacyCards: 1,
		totalOutstanding: 4,
	},
	inFlightNotificationImpact: {
		total: 1,
		intentRecorded: 1,
		reconciliationRequired: 0,
	},
	effectiveSettings: {
		enableApprovals: true,
		enableCommands: true,
		enableDailyDigest: true,
		enableEscalations: true,
		digestTime: "08:00",
		digestTimezone: "UTC",
		escalationTimeoutHours: 24,
	},
	requiresUnreadyAcknowledgement: true,
	canConfirm: true,
	impactDigest: sampleDigest,
};

const sampleCapabilities: ProviderCapabilityDisclosure = {
	provider: "slack",
	escalationPolicy: {
		policyOwned: true,
		policyEnabled: true,
		responseWindowHours: 12,
		channelControlsDeliveryOnly: true,
	},
	capabilities: [
		{ capability: "notifications", enabled: true, supported: true, noteCode: null },
		{ capability: "approvals", enabled: true, supported: true, noteCode: "slack_review_in_z8" },
	],
	approvalKinds: [
		{
			workflowType: "absence",
			authority: "canonical",
			supportMode: "review_in_z8",
			deliveryActive: true,
		},
	],
};

describe("Slack switch & capability server actions (#2045)", () => {
	beforeEach(() => {
		mocks.caller = orgAdmin;
		vi.clearAllMocks();
		mocks.buildChatSwitchImpactPreview.mockResolvedValue(samplePreview);
		mocks.getProviderCapabilityDisclosure.mockResolvedValue(sampleCapabilities);
		mocks.confirmChatInstallationSwitch.mockResolvedValue({
			kind: "switched",
			activeInstallationId: sampleCandidateId,
			retiredInstallationIds: [sampleCurrentId],
			retirementDeadlineAt: "2026-12-26T12:00:00.000Z",
			carriedForwardIdentityCount: 2,
			promotedEnrollmentCount: 0,
			effectiveSettings: samplePreview.effectiveSettings,
			preview: { ...samplePreview, candidateInstallation: null },
		});
	});

	it("rechecks admin access and refuses when an admin loses access or departs before confirming switch", async () => {
		const preview = await getSlackSwitchImpactPreview();
		expect(preview).toEqual({ success: true, data: samplePreview });

		// Admin loses admin role right before confirming!
		mocks.caller = demotedMember;
		const demotedConfirm = await confirmSlackInstallationSwitch({
			candidateInstallationId: sampleCandidateId,
			reviewedCurrentInstallationId: sampleCurrentId,
			reviewedCurrentCredentialRevisionId: null,
			reviewedCandidateCredentialRevisionId: sampleCandidateRevId,
			reviewedImpactDigest: sampleDigest,
			acknowledgeUnreadyEmployees: true,
		});
		expect(demotedConfirm).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.confirmChatInstallationSwitch).not.toHaveBeenCalled();

		// Former admin is also refused
		mocks.caller = formerAdmin;
		const formerConfirm = await confirmSlackInstallationSwitch({
			candidateInstallationId: sampleCandidateId,
			reviewedCurrentInstallationId: sampleCurrentId,
			reviewedCurrentCredentialRevisionId: null,
			reviewedCandidateCredentialRevisionId: sampleCandidateRevId,
			reviewedImpactDigest: sampleDigest,
			acknowledgeUnreadyEmployees: true,
		});
		expect(formerConfirm).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.confirmChatInstallationSwitch).not.toHaveBeenCalled();

		// Signed-out caller is refused
		mocks.caller = null;
		const signedOutCaps = await getProviderCapabilityDisclosure({ provider: "slack" });
		expect(signedOutCaps).toMatchObject({ success: false, code: "AuthenticationError" });
	});

	it("returns ValidationError with refusal 'impact_changed' and fresh preview details when impact drifts", async () => {
		const freshPreview: ChatSwitchImpactPreview = {
			...samplePreview,
			impactDigest: "b".repeat(64),
			approvalImpact: {
				...samplePreview.approvalImpact,
				openCanonicalCards: 5,
				totalOutstanding: 7,
			},
		};
		mocks.confirmChatInstallationSwitch.mockResolvedValueOnce({
			kind: "refused",
			code: "impact_changed",
			message: "Switch impact changed since review",
			freshPreview,
		});

		const result = await confirmSlackInstallationSwitch({
			candidateInstallationId: sampleCandidateId,
			reviewedCurrentInstallationId: sampleCurrentId,
			reviewedCurrentCredentialRevisionId: null,
			reviewedCandidateCredentialRevisionId: sampleCandidateRevId,
			reviewedImpactDigest: sampleDigest,
			acknowledgeUnreadyEmployees: true,
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "impact_changed",
			details: { preview: freshPreview },
		});
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("switches successfully and revalidates /settings/notification-channels", async () => {
		const result = await confirmSlackInstallationSwitch({
			candidateInstallationId: sampleCandidateId,
			reviewedCurrentInstallationId: sampleCurrentId,
			reviewedCurrentCredentialRevisionId: null,
			reviewedCandidateCredentialRevisionId: sampleCandidateRevId,
			reviewedImpactDigest: sampleDigest,
			acknowledgeUnreadyEmployees: true,
		});

		expect(result.success).toBe(true);
		expect(mocks.confirmChatInstallationSwitch).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				provider: "slack",
				actorUserId: "user-admin",
				candidateInstallationId: sampleCandidateId,
				reviewedImpactDigest: sampleDigest,
				acknowledgeUnreadyEmployees: true,
			}),
			expect.anything(),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/notification-channels");
	});
});
