import type { CloudAdapter, TurnContext } from "botbuilder";
import { describe, expect, it, vi } from "vitest";
import { handleTeamsInstallationMessageRequest } from "./teams-candidate-routes";
import type { TeamsCandidateInstallationRecord, TeamsSetupRepository } from "./teams-setup";
import {
	computeTeamsSwitchImpactDigest,
	hasTeamsSwitchImpactChanged,
	proposeTeamsReplacementSettings,
	type TeamsSwitchImpactDigestInput,
} from "./teams-switch";
import type { ChatEffectiveSettings } from "./types";

const BASE_SETTINGS: ChatEffectiveSettings = {
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: true,
	enableEscalations: true,
	digestTime: "08:00",
	digestTimezone: "Europe/Berlin",
	escalationTimeoutHours: 24,
};

const ALT_SETTINGS: ChatEffectiveSettings = {
	enableApprovals: true,
	enableCommands: false,
	enableDailyDigest: false,
	enableEscalations: true,
	digestTime: "09:30",
	digestTimezone: "UTC",
	escalationTimeoutHours: 48,
};

function makeDigestInput(
	overrides: Partial<TeamsSwitchImpactDigestInput> = {},
): TeamsSwitchImpactDigestInput {
	return {
		organizationId: "org-1",
		affectedTenants: [
			{
				installationId: "inst-b",
				legacyRecordId: "legacy-b",
				tenantId: "bbbb1111-2222-4333-8444-555555555552",
				status: "legacy_active",
				activeCredentialRevisionId: null,
				effectiveSettings: ALT_SETTINGS,
			},
			{
				installationId: "inst-a",
				legacyRecordId: "legacy-a",
				tenantId: "aaaa1111-2222-4333-8444-555555555551",
				status: "legacy_active",
				activeCredentialRevisionId: null,
				effectiveSettings: BASE_SETTINGS,
			},
		],
		candidateInstallationId: "inst-cand",
		candidateCredentialRevisionId: "rev-cand-1",
		hasSettingsDisagreements: true,
		disagreementFields: [
			"enableCommands",
			"enableDailyDigest",
			"digestTime",
			"digestTimezone",
			"escalationTimeoutHours",
		],
		confirmedReplacementSettings: BASE_SETTINGS,
		materialCounts: {
			totalActiveEmployees: 5,
			verifiedReachableEmployees: 2,
			actionNeededEmployees: 2,
			unknownReachabilityEmployees: 1,
			carryForwardIdentityEmployees: 1,
			outstandingApprovalCards: 3,
			outstandingApprovalWork: 1,
			pendingLegacyApprovalCards: 2,
			inFlightDurableDispatches: 1,
			uncertainDurableDispatches: 0,
		},
		...overrides,
	};
}

function makeVerifiedAdapter(claimsAppId: string, claimsTenantId: string): CloudAdapter {
	const BotIdentityKey = Symbol("BotIdentity");
	return {
		BotIdentityKey,
		async process(
			req: { body: Record<string, unknown> },
			_res: unknown,
			logic: (context: TurnContext) => Promise<void>,
		) {
			const turnState = new Map<unknown, unknown>();
			const claims = [
				{ type: "appid", value: claimsAppId },
				{ type: "tid", value: claimsTenantId },
			];
			turnState.set(BotIdentityKey, {
				isAuthenticated: true,
				claims,
				getClaimValue: (type: string) => claims.find((c) => c.type === type)?.value ?? null,
			});
			const context = {
				activity: req.body,
				turnState,
				sendActivity: async () => ({ id: "reply-1" }),
			} as unknown as TurnContext;
			await logic(context);
		},
	} as unknown as CloudAdapter;
}

describe("teams-switch pure domain helpers", () => {
	it("computes deterministic impactDigest regardless of tenant array order", () => {
		const a = computeTeamsSwitchImpactDigest(makeDigestInput());
		const b = computeTeamsSwitchImpactDigest(
			makeDigestInput({
				affectedTenants: [...makeDigestInput().affectedTenants].reverse(),
				disagreementFields: [...makeDigestInput().disagreementFields].reverse(),
			}),
		);
		expect(a).toBe(b);
		expect(a).toMatch(/^[a-f0-9]{64}$/);
	});

	it("changes impactDigest when affected tenant set, status, revision, disagreement, replacement settings, or counts change", () => {
		const baseline = computeTeamsSwitchImpactDigest(makeDigestInput());

		const removedTenant = computeTeamsSwitchImpactDigest(
			makeDigestInput({
				affectedTenants: [makeDigestInput().affectedTenants[0]!],
			}),
		);
		expect(removedTenant).not.toBe(baseline);

		const statusChanged = computeTeamsSwitchImpactDigest(
			makeDigestInput({
				affectedTenants: makeDigestInput().affectedTenants.map((t, idx) =>
					idx === 0 ? { ...t, status: "retiring" } : t,
				),
			}),
		);
		expect(statusChanged).not.toBe(baseline);

		const revisionChanged = computeTeamsSwitchImpactDigest(
			makeDigestInput({ candidateCredentialRevisionId: "rev-cand-2" }),
		);
		expect(revisionChanged).not.toBe(baseline);

		const settingsChanged = computeTeamsSwitchImpactDigest(
			makeDigestInput({
				confirmedReplacementSettings: { ...BASE_SETTINGS, escalationTimeoutHours: 72 },
			}),
		);
		expect(settingsChanged).not.toBe(baseline);

		const countsChanged = computeTeamsSwitchImpactDigest(
			makeDigestInput({
				materialCounts: { ...makeDigestInput().materialCounts, outstandingApprovalCards: 4 },
			}),
		);
		expect(countsChanged).not.toBe(baseline);
	});

	it("detects drift via hasTeamsSwitchImpactChanged on tenant list, revision, or digest mismatch", () => {
		const digest = computeTeamsSwitchImpactDigest(makeDigestInput());
		expect(
			hasTeamsSwitchImpactChanged({
				reviewedAffectedInstallationIds: ["inst-b", "inst-a"],
				reviewedCandidateCredentialRevisionId: "rev-cand-1",
				reviewedImpactDigest: digest,
				freshAffectedInstallationIds: ["inst-a", "inst-b"],
				freshCandidateCredentialRevisionId: "rev-cand-1",
				freshImpactDigest: digest,
			}),
		).toBe(false);

		expect(
			hasTeamsSwitchImpactChanged({
				reviewedAffectedInstallationIds: ["inst-a"],
				reviewedCandidateCredentialRevisionId: "rev-cand-1",
				reviewedImpactDigest: digest,
				freshAffectedInstallationIds: ["inst-a", "inst-b"],
				freshCandidateCredentialRevisionId: "rev-cand-1",
				freshImpactDigest: digest,
			}),
		).toBe(true);
	});

	it("proposes authoritative settings when present, else primary live tenant settings, else defaults", () => {
		expect(
			proposeTeamsReplacementSettings({
				authoritativeSettings: ALT_SETTINGS,
				liveTenantSettings: [BASE_SETTINGS],
			}),
		).toEqual(ALT_SETTINGS);

		expect(
			proposeTeamsReplacementSettings({
				authoritativeSettings: null,
				liveTenantSettings: [BASE_SETTINGS, ALT_SETTINGS],
			}),
		).toEqual(BASE_SETTINGS);

		expect(
			proposeTeamsReplacementSettings({
				authoritativeSettings: null,
				liveTenantSettings: [],
			}),
		).toEqual({
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		});
	});
});

describe("Teams installation route lifecycle modes (#2050)", () => {
	const APP_ID = "11111111-2222-4333-8444-555555555551";
	const TENANT_ID = "aaaa1111-2222-4333-8444-555555555551";
	const REV_ID = "33333333-3333-4333-8333-333333333333";

	function buildInstallation(
		overrides: Partial<TeamsCandidateInstallationRecord>,
	): TeamsCandidateInstallationRecord {
		const now = new Date("2026-11-26T12:00:00Z");
		return {
			id: "22222222-2222-4222-8222-222222222222",
			organizationId: "org-1",
			provider: "teams",
			credentialSource: "organization_owned",
			status: "active",
			routeId: "route-teams-active",
			externalAppId: APP_ID,
			externalBotId: APP_ID,
			externalBotUsername: null,
			externalDisplayName: "Contoso Teams",
			externalSpaceId: TENANT_ID,
			externalSpaceName: "Contoso Teams",
			receiverScope: `teams-bot:${APP_ID}:tenant:${TENANT_ID}`,
			spaceClaimId: null,
			botClaimId: null,
			activeCredentialRevisionId: REV_ID,
			verificationState: "verified",
			verificationEvidence: null,
			lastVerifiedAt: now,
			retirementDeadlineAt: null,
			retiredAt: null,
			revokedAt: null,
			endpointGeneration: 1,
			createdByUserId: "admin-1",
			createdAt: now,
			updatedAt: now,
			...overrides,
		};
	}

	function makeDeps(installation: TeamsCandidateInstallationRecord, now: Date) {
		const dispatchSpy = vi.fn().mockResolvedValue(undefined);
		const repository = {
			findInstallationByRouteId: async (routeId: string) =>
				routeId === installation.routeId ? installation : null,
		} as unknown as TeamsSetupRepository;

		const revisionRepository = {
			findRevision: async () => ({
				id: REV_ID,
				installationId: installation.id,
				organizationId: installation.organizationId,
				revisionNumber: 1,
				secretStoreProvider: "vault" as const,
				secretKeyPrefix: `chat/teams/${installation.id}/v1`,
				secretKeys: ["microsoft_app_password"],
				status: "active" as const,
				externalIdentityFingerprint: `teams:${TENANT_ID}:${APP_ID}`,
				verifiedAt: now,
				revokedAt: null,
				createdByUserId: "admin-1",
				createdAt: now,
			}),
		};

		return {
			dispatchSpy,
			deps: {
				repository,
				revisionRepository: revisionRepository as never,
				readSecret: async () => "org-owned-client-secret-123",
				getAdapter: () => makeVerifiedAdapter(APP_ID, TENANT_ID),
				loadEffectiveSettings: async () => BASE_SETTINGS,
				handleProductionActivity: dispatchSpy,
				now: () => now,
			},
		};
	}

	it("dispatches active org-owned Teams traffic to handleProductionActivity with authoritative settings", async () => {
		const now = new Date("2026-11-26T12:00:00Z");
		const inst = buildInstallation({ status: "active" });
		const { deps, dispatchSpy } = makeDeps(inst, now);

		const resp = await handleTeamsInstallationMessageRequest(
			{
				routeId: inst.routeId,
				rawBody: JSON.stringify({
					type: "message",
					text: "status",
					channelId: "msteams",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: { id: "a:conv-1", tenantId: TENANT_ID, conversationType: "personal" },
					recipient: { id: `28:${APP_ID}` },
					from: { id: "29:u1", aadObjectId: "aad-1" },
				}),
				authorizationHeader: "Bearer valid-jwt",
			},
			deps,
		);

		expect(resp.status).toBe(200);
		expect(dispatchSpy).toHaveBeenCalledTimes(1);
		expect(dispatchSpy.mock.calls[0]?.[1]).toMatchObject({
			organizationId: "org-1",
			installationId: inst.id,
			microsoftAppId: APP_ID,
			installationStatus: "active",
			digestTimezone: "Europe/Berlin",
		});
	});

	it("services eligible retiring Teams installation before deadline and rejects after deadline or revocation", async () => {
		const now = new Date("2026-11-26T12:00:00Z");
		const retiringValid = buildInstallation({
			status: "retiring",
			retirementDeadlineAt: new Date("2026-12-26T12:00:00Z"),
		});
		const validHarness = makeDeps(retiringValid, now);
		const okResp = await handleTeamsInstallationMessageRequest(
			{
				routeId: retiringValid.routeId,
				rawBody: JSON.stringify({
					type: "invoke",
					name: "adaptiveCard/action",
					channelId: "msteams",
					conversation: { id: "a:conv-1", tenantId: TENANT_ID, conversationType: "personal" },
					recipient: { id: `28:${APP_ID}` },
					from: { id: "29:u1", aadObjectId: "aad-1" },
				}),
				authorizationHeader: "Bearer valid-jwt",
			},
			validHarness.deps,
		);
		expect(okResp.status).toBe(200);
		expect(validHarness.dispatchSpy).toHaveBeenCalledTimes(1);
		expect(validHarness.dispatchSpy.mock.calls[0]?.[1]).toMatchObject({
			installationStatus: "retiring",
		});

		const retiringExpired = buildInstallation({
			status: "retiring",
			retirementDeadlineAt: new Date("2026-11-25T12:00:00Z"),
		});
		const expiredHarness = makeDeps(retiringExpired, now);
		const expiredResp = await handleTeamsInstallationMessageRequest(
			{
				routeId: retiringExpired.routeId,
				rawBody: "{}",
				authorizationHeader: "Bearer valid-jwt",
			},
			expiredHarness.deps,
		);
		expect(expiredResp.status).toBe(403);
		expect(expiredHarness.dispatchSpy).not.toHaveBeenCalled();

		const revoked = buildInstallation({ status: "revoked", revokedAt: now });
		const revokedHarness = makeDeps(revoked, now);
		const revokedResp = await handleTeamsInstallationMessageRequest(
			{
				routeId: revoked.routeId,
				rawBody: "{}",
				authorizationHeader: "Bearer valid-jwt",
			},
			revokedHarness.deps,
		);
		expect(revokedResp.status).toBe(403);
		expect(revokedHarness.dispatchSpy).not.toHaveBeenCalled();
	});
});
