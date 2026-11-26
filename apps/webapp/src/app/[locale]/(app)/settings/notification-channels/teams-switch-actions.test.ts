import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamsSwitchImpactPreview } from "@/lib/chat-installations/teams-switch";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
	buildTeamsSwitchImpactPreview: vi.fn(),
	confirmTeamsOrganizationSwitch: vi.fn(),
	revokeLegacyTeamsTenantInstallation: vi.fn(),
	rotateTeamsInstallationCredentials: vi.fn(),
	beginTeamsInstallationRestore: vi.fn(),
	verifyRestoredTeamsInstallation: vi.fn(),
	confirmTeamsInstallationRestore: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/chat-installations", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-installations")>();
	return {
		...actual,
		buildTeamsSwitchImpactPreview: mocks.buildTeamsSwitchImpactPreview,
		confirmTeamsOrganizationSwitch: mocks.confirmTeamsOrganizationSwitch,
		revokeLegacyTeamsTenantInstallation: mocks.revokeLegacyTeamsTenantInstallation,
		rotateTeamsInstallationCredentials: mocks.rotateTeamsInstallationCredentials,
		beginTeamsInstallationRestore: mocks.beginTeamsInstallationRestore,
		verifyRestoredTeamsInstallation: mocks.verifyRestoredTeamsInstallation,
		confirmTeamsInstallationRestore: mocks.confirmTeamsInstallationRestore,
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
	confirmTeamsRestore,
	confirmTeamsSwitch,
	getTeamsSwitchImpactPreview,
	prepareTeamsRestore,
	revokeTeamsTenant,
	rotateTeamsCredentials,
	verifyTeamsRestore,
} from "./teams-switch-actions";

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

const DIGEST_A = "a".repeat(64);
const CAND_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_INST_A = "33333333-3333-4333-8333-333333333331";
const TENANT_INST_B = "33333333-3333-4333-8333-333333333332";
const REV_ID = "44444444-4444-4444-8444-444444444444";

const samplePreview: TeamsSwitchImpactPreview = {
	organizationId: "org-1",
	provider: "teams",
	generatedAt: "2026-11-26T12:00:00.000Z",
	switchControlEnabled: true,
	blockers: [],
	hasHardBlockers: false,
	affectedTenants: [],
	discoveredLegacyTenants: [],
	settingsDisagreements: [],
	hasSettingsDisagreements: false,
	proposedReplacementSettings: {
		enableApprovals: true,
		enableCommands: true,
		enableDailyDigest: true,
		enableEscalations: true,
		digestTime: "08:00",
		digestTimezone: "UTC",
		escalationTimeoutHours: 24,
	},
	candidateInstallation: null,
	candidateReady: true,
	candidateVerificationState: "verified",
	retiringTenants: [],
	activeOrgOwnedInstallation: null,
	restorableInstallations: [],
	pendingCleanupJobs: [],
	rotationGuidance: {
		provider: "teams",
		hasProviderInterruption: false,
		interruptionKind: "overlapping_secret_rollover",
		summary: "Zero-downtime secret rollover",
		interruptionDetails: "Add a second secret first",
		verificationSteps: [],
	},
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
	inFlightNotificationImpact: {
		intentRecorded: 0,
		reconciliationRequired: 0,
		total: 0,
	},
	requiresUnreadyAcknowledgement: false,
	requiresSettingsConfirmation: false,
	canConfirm: true,
	impactDigest: DIGEST_A,
};

describe("Teams multi-tenant switch & recovery server actions (#2050)", () => {
	beforeEach(() => {
		mocks.caller = orgAdmin;
		vi.clearAllMocks();
		mocks.buildTeamsSwitchImpactPreview.mockResolvedValue(samplePreview);
		mocks.confirmTeamsOrganizationSwitch.mockResolvedValue({
			kind: "switched",
			activeInstallationId: CAND_ID,
			retiredInstallationIds: [TENANT_INST_A, TENANT_INST_B],
			retiredTenantIds: ["t-a", "t-b"],
			retirementDeadlineAt: "2026-12-26T12:00:00.000Z",
			carriedForwardIdentityCount: 1,
			promotedEnrollmentCount: 1,
			effectiveSettings: samplePreview.proposedReplacementSettings,
			preview: samplePreview,
		});
		mocks.revokeLegacyTeamsTenantInstallation.mockResolvedValue({
			kind: "revoked",
			installationId: TENANT_INST_A,
			provider: "teams",
			endpointGeneration: 1,
			queuedCredentialCleanupCount: 0,
			queuedEndpointCleanup: false,
		});
		mocks.rotateTeamsInstallationCredentials.mockResolvedValue({
			kind: "rotated",
			installationId: CAND_ID,
			routeId: "route-1",
			provider: "teams",
			previousRevisionId: REV_ID,
			newRevisionId: "55555555-5555-4555-8555-555555555555",
			newRevisionNumber: 2,
			queuedCleanupJobId: "job-1",
			guidance: samplePreview.rotationGuidance,
		});
		mocks.beginTeamsInstallationRestore.mockResolvedValue({
			kind: "restore_started",
			installationId: CAND_ID,
			routeId: "route-1",
			provider: "teams",
			endpointGeneration: 2,
			endpointState: "synced",
			requiresCredentials: true,
			status: "candidate",
		});
		mocks.verifyRestoredTeamsInstallation.mockResolvedValue({
			kind: "verified_step",
			installationId: CAND_ID,
			readyForSwitch: true,
			verificationState: "verified",
			activeCredentialRevisionId: REV_ID,
			preview: samplePreview,
		});
		mocks.confirmTeamsInstallationRestore.mockResolvedValue({
			kind: "switched",
			activeInstallationId: CAND_ID,
			retiredInstallationIds: [],
			retiredTenantIds: [],
			retirementDeadlineAt: "2026-12-26T12:00:00.000Z",
			carriedForwardIdentityCount: 0,
			promotedEnrollmentCount: 0,
			effectiveSettings: samplePreview.proposedReplacementSettings,
			preview: samplePreview,
		});
	});

	it("enforces orgAdmin access across preview, confirm, revoke, rotate, and restore actions", async () => {
		mocks.caller = memberCaller;
		expect(await getTeamsSwitchImpactPreview()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			await confirmTeamsSwitch({
				candidateInstallationId: CAND_ID,
				reviewedAffectedInstallationIds: [TENANT_INST_A, TENANT_INST_B],
				reviewedCandidateCredentialRevisionId: REV_ID,
				reviewedImpactDigest: DIGEST_A,
				acknowledgeUnreadyEmployees: false,
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(await revokeTeamsTenant({ installationId: TENANT_INST_A })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			await rotateTeamsCredentials({
				installationId: CAND_ID,
				microsoftAppId: "11111111-2222-4333-8444-555555555551",
				microsoftTenantId: "aaaa1111-2222-4333-8444-555555555551",
				microsoftAppPassword: "new-secret-value-123",
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(await prepareTeamsRestore({ installationId: CAND_ID })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await verifyTeamsRestore({ installationId: CAND_ID })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			await confirmTeamsRestore({
				candidateInstallationId: CAND_ID,
				reviewedAffectedInstallationIds: [],
				reviewedCandidateCredentialRevisionId: REV_ID,
				reviewedImpactDigest: DIGEST_A,
				acknowledgeUnreadyEmployees: false,
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("returns freshPreview in details when confirmTeamsSwitch refuses with impact_changed", async () => {
		const fresh = { ...samplePreview, impactDigest: "b".repeat(64) };
		mocks.confirmTeamsOrganizationSwitch.mockResolvedValueOnce({
			kind: "refused",
			code: "impact_changed",
			message: "Affected tenants changed",
			freshPreview: fresh,
		});

		const result = await confirmTeamsSwitch({
			candidateInstallationId: CAND_ID,
			reviewedAffectedInstallationIds: [TENANT_INST_A],
			reviewedCandidateCredentialRevisionId: REV_ID,
			reviewedImpactDigest: DIGEST_A,
			acknowledgeUnreadyEmployees: false,
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "impact_changed",
			details: { preview: fresh },
		});
	});

	it("revalidates settings page after confirm, per-tenant revoke, rotation, and restore", async () => {
		const switched = await confirmTeamsSwitch({
			candidateInstallationId: CAND_ID,
			reviewedAffectedInstallationIds: [TENANT_INST_A, TENANT_INST_B],
			reviewedCandidateCredentialRevisionId: REV_ID,
			reviewedImpactDigest: DIGEST_A,
			acknowledgeUnreadyEmployees: false,
			confirmedReplacementSettings: samplePreview.proposedReplacementSettings,
		});
		expect(switched.success).toBe(true);

		const revoked = await revokeTeamsTenant({ installationId: TENANT_INST_A });
		expect(revoked.success).toBe(true);

		const rotated = await rotateTeamsCredentials({
			installationId: CAND_ID,
			microsoftAppId: "11111111-2222-4333-8444-555555555551",
			microsoftTenantId: "aaaa1111-2222-4333-8444-555555555551",
			microsoftAppPassword: "rotated-secret-value-123",
		});
		expect(rotated.success).toBe(true);

		const restored = await confirmTeamsRestore({
			candidateInstallationId: CAND_ID,
			reviewedAffectedInstallationIds: [],
			reviewedCandidateCredentialRevisionId: REV_ID,
			reviewedImpactDigest: DIGEST_A,
			acknowledgeUnreadyEmployees: false,
		});
		expect(restored.success).toBe(true);

		expect(mocks.revalidatePath).toHaveBeenCalledTimes(4);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/notification-channels");
	});
});
