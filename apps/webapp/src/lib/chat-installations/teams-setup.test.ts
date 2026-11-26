import type { CloudAdapter, TurnContext } from "botbuilder";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SecretStoreUnavailableError } from "@/lib/vault/errors";
import { handleTeamsCandidateMessageRequest } from "./teams-candidate-routes";
import {
	buildTeamsAppPackageZip,
	computeTeamsCandidateSetupStatus,
	configureTeamsCandidateCredentials,
	generateTeamsAppPackage,
	prepareTeamsCandidateInstallation,
	sendTeamsCandidateProactiveTestMessage,
	TEAMS_MANIFEST_VERSION,
	type TeamsCandidateInstallationRecord,
	type TeamsSetupRepository,
	type TeamsSetupRuntimeDeps,
} from "./teams-setup";

const ORG_A = "org-teams-a";
const ORG_B = "org-teams-b";
const ADMIN_USER = "user-admin-a";
const EMP_USER = "user-emp-a";
const EMP_ID = "e2049000-0000-4000-8000-000000000001";
const APP_ID_A = "11111111-2222-4333-8444-555555555551";
const APP_ID_WRONG = "99999999-2222-4333-8444-555555555559";
const TENANT_ID_A = "aaaa1111-2222-4333-8444-555555555551";
const TENANT_ID_WRONG = "bbbb1111-2222-4333-8444-555555555552";
const AAD_ADMIN = "cccccccc-1111-4222-8333-444444444441";
const AAD_PROVEN_EMP = "cccccccc-1111-4222-8333-444444444442";
const AAD_UNLINKED_EMP = "cccccccc-1111-4222-8333-444444444443";

function createInMemoryTeamsHarness() {
	const installations = new Map<string, TeamsCandidateInstallationRecord>();
	const claims = new Map<string, { id: string; organizationId: string }>();
	const revisions = new Map<
		string,
		{
			id: string;
			installationId: string;
			organizationId: string;
			revisionNumber: number;
			secretStoreProvider: "vault" | "scaleway";
			secretKeyPrefix: string;
			secretKeys: string[];
			status:
				| "staged"
				| "verified"
				| "active"
				| "superseded"
				| "revoked"
				| "cleanup_pending"
				| "cleaned_up";
			externalIdentityFingerprint: string | null;
			verifiedAt: Date | null;
			revokedAt: Date | null;
			createdByUserId: string | null;
			createdAt: Date;
		}
	>();
	const secrets = new Map<string, string>();
	const conversations: Array<{
		organizationId: string;
		installationId: string;
		userId: string | null;
		employeeId: string | null;
		externalUserId: string | null;
		externalConversationId: string;
		conversationReference: Record<string, unknown>;
		reachabilityStatus: "reachable" | "unknown" | "action_needed" | "unreachable";
		verifiedAt: Date;
	}> = [];
	const candidateEnrollments: Array<{
		organizationId: string;
		installationId: string;
		userId: string;
		employeeId: string;
		externalUserId: string;
		externalScope: string;
		provenance: "link_proof" | "verified_same_scope_reuse";
	}> = [];
	const provenMembers = new Map<
		string,
		{ userId: string; employeeId: string; displayName: string | null }
	>();
	const audits: Array<{
		action: string;
		organizationId: string;
		metadata: Record<string, unknown>;
	}> = [];
	const evictedAdapters: Array<{ installationId: string; revisionId?: string }> = [];

	let seq = 1;
	let currentNow = new Date("2026-11-26T12:00:00.000Z");

	const repository: TeamsSetupRepository = {
		async findCandidateByOrg(organizationId) {
			return (
				[...installations.values()].find(
					(item) =>
						item.organizationId === organizationId &&
						item.provider === "teams" &&
						item.status === "candidate",
				) ?? null
			);
		},
		async findCandidateById(organizationId, installationId) {
			const item = installations.get(installationId);
			if (!item || item.organizationId !== organizationId || item.status !== "candidate") {
				return null;
			}
			return item;
		},
		async findInstallationByRouteId(routeId) {
			return [...installations.values()].find((item) => item.routeId === routeId) ?? null;
		},
		async insertCandidate(input) {
			const id = `20490000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
			const rec: TeamsCandidateInstallationRecord = {
				id,
				organizationId: input.organizationId,
				provider: "teams",
				credentialSource: "organization_owned",
				status: "candidate",
				routeId: input.routeId,
				externalAppId: null,
				externalBotId: null,
				externalBotUsername: null,
				externalDisplayName: null,
				externalSpaceId: null,
				externalSpaceName: null,
				receiverScope: null,
				spaceClaimId: null,
				botClaimId: null,
				activeCredentialRevisionId: null,
				verificationState: "unverified",
				verificationEvidence: null,
				lastVerifiedAt: null,
				endpointGeneration: 0,
				createdByUserId: input.createdByUserId,
				createdAt: currentNow,
				updatedAt: currentNow,
			};
			installations.set(id, rec);
			return rec;
		},
		async updateCandidate(organizationId, installationId, patch) {
			const existing = installations.get(installationId);
			if (!existing || existing.organizationId !== organizationId) {
				throw new Error("Installation not found");
			}
			const updated: TeamsCandidateInstallationRecord = {
				...existing,
				...patch,
				updatedAt: currentNow,
			};
			installations.set(installationId, updated);
			return updated;
		},
		async acquireClaim({ organizationId, claimKind, externalId }) {
			const key = `teams:${claimKind}:${externalId.toLowerCase()}`;
			const existing = claims.get(key);
			if (existing) {
				if (existing.organizationId !== organizationId) {
					return { kind: "conflict" };
				}
				return { kind: "acquired", claimId: existing.id };
			}
			const claimId = `c2049000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
			claims.set(key, { id: claimId, organizationId });
			return { kind: "acquired", claimId };
		},
		async findCandidatePersonalConversation({ organizationId, installationId, preferredUserId }) {
			const matching = conversations.filter(
				(c) => c.organizationId === organizationId && c.installationId === installationId,
			);
			const preferred = preferredUserId
				? matching.find((c) => c.userId === preferredUserId)
				: undefined;
			const picked = preferred ?? matching[matching.length - 1] ?? null;
			if (!picked) return null;
			return {
				externalConversationId: picked.externalConversationId,
				externalUserId: picked.externalUserId,
				userId: picked.userId,
				conversationReference: picked.conversationReference,
				verifiedAt: picked.verifiedAt,
			};
		},
		async upsertCandidatePersonalConversation(input) {
			const idx = conversations.findIndex(
				(c) =>
					c.organizationId === input.organizationId &&
					c.installationId === input.installationId &&
					c.externalConversationId === input.externalConversationId,
			);
			const record = {
				organizationId: input.organizationId,
				installationId: input.installationId,
				userId: input.userId ?? null,
				employeeId: input.employeeId ?? null,
				externalUserId: input.externalUserId ?? null,
				externalConversationId: input.externalConversationId,
				conversationReference: input.conversationReference,
				reachabilityStatus: input.reachabilityStatus,
				verifiedAt: input.verifiedAt,
			};
			if (idx >= 0) {
				conversations[idx] = record;
			} else {
				conversations.push(record);
			}
		},
		async findProvenSameTenantMember({ organizationId, tenantId, aadObjectId }) {
			return (
				provenMembers.get(
					`${organizationId}:${tenantId.toLowerCase()}:${aadObjectId.toLowerCase()}`,
				) ?? null
			);
		},
		async upsertCandidateMemberEnrollment(input) {
			candidateEnrollments.push({
				organizationId: input.organizationId,
				installationId: input.installationId,
				userId: input.userId,
				employeeId: input.employeeId,
				externalUserId: input.externalUserId,
				externalScope: input.externalScope,
				provenance: input.provenance,
			});
		},
		async getRevisionNumber(organizationId, installationId, revisionId) {
			const rev = revisions.get(revisionId);
			if (!rev || rev.organizationId !== organizationId || rev.installationId !== installationId) {
				return null;
			}
			return rev.revisionNumber;
		},
	};

	const revisionRepository = {
		async getLatestRevisionNumber(organizationId: string, installationId: string) {
			let max = 0;
			for (const rev of revisions.values()) {
				if (rev.organizationId === organizationId && rev.installationId === installationId) {
					max = Math.max(max, rev.revisionNumber);
				}
			}
			return max;
		},
		async insertRevision(input: {
			installationId: string;
			organizationId: string;
			revisionNumber: number;
			secretStoreProvider: "vault" | "scaleway";
			secretKeyPrefix: string;
			secretKeys: string[];
			status:
				| "staged"
				| "verified"
				| "active"
				| "superseded"
				| "revoked"
				| "cleanup_pending"
				| "cleaned_up";
			externalIdentityFingerprint: string | null;
			verifiedAt: Date | null;
			revokedAt: Date | null;
			createdByUserId: string | null;
		}) {
			const id = `r2049000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
			const record = { ...input, id, createdAt: currentNow };
			revisions.set(id, record);
			return record;
		},
		async findRevision(organizationId: string, installationId: string, revisionId: string) {
			const rev = revisions.get(revisionId);
			if (!rev || rev.organizationId !== organizationId || rev.installationId !== installationId) {
				return null;
			}
			return rev;
		},
		async getActiveRevisionId(organizationId: string, installationId: string) {
			const inst = installations.get(installationId);
			return inst && inst.organizationId === organizationId
				? inst.activeCredentialRevisionId
				: null;
		},
		async updateRevisionStatus(
			organizationId: string,
			installationId: string,
			revisionId: string,
			status:
				| "staged"
				| "verified"
				| "active"
				| "superseded"
				| "revoked"
				| "cleanup_pending"
				| "cleaned_up",
		) {
			const rev = revisions.get(revisionId);
			if (rev && rev.organizationId === organizationId && rev.installationId === installationId) {
				rev.status = status;
			}
		},
	};

	const deps: TeamsSetupRuntimeDeps = {
		repository,
		revisionRepository,
		secretStoreProvider: "vault",
		storeSecret: async (orgId, key, value) => {
			secrets.set(`${orgId}:${key}`, value);
		},
		readSecret: async (orgId, key) => secrets.get(`${orgId}:${key}`) ?? null,
		deleteSecret: async (orgId, key) => {
			secrets.delete(`${orgId}:${key}`);
		},
		evictAdapter: (installationId, revisionId) => {
			evictedAdapters.push({ installationId, revisionId });
			return 1;
		},
		recordAudit: async (event) => {
			audits.push({
				action: event.action,
				organizationId: event.organizationId,
				metadata: event.metadata,
			});
		},
		appUrl: "https://app.z8-time.test",
		now: () => currentNow,
	};

	return {
		installations,
		claims,
		revisions,
		secrets,
		conversations,
		candidateEnrollments,
		provenMembers,
		audits,
		evictedAdapters,
		deps,
		setNow: (d: Date) => {
			currentNow = d;
		},
	};
}

function makeFakeCloudAdapter(options: {
	claimsAppId?: string;
	claimsTenantId?: string;
	rejectAuth?: boolean;
	sentActivities?: unknown[];
}) {
	const BotIdentityKey = Symbol("BotIdentity");
	const sentActivities = options.sentActivities ?? [];
	const adapter = {
		BotIdentityKey,
		async process(
			req: { body: Record<string, unknown>; headers: Record<string, string> },
			res: { status: (code: number) => unknown; send: (data: unknown) => void },
			logic: (context: TurnContext) => Promise<void>,
		) {
			if (options.rejectAuth || !req.headers.authorization?.startsWith("Bearer ")) {
				res.status(401);
				res.send({ error: "Unauthorized" });
				return;
			}
			const turnState = new Map<unknown, unknown>();
			const claims: Array<{ type: string; value: string }> = [];
			if (options.claimsAppId) claims.push({ type: "appid", value: options.claimsAppId });
			if (options.claimsTenantId) claims.push({ type: "tid", value: options.claimsTenantId });
			turnState.set(BotIdentityKey, {
				isAuthenticated: true,
				claims,
				getClaimValue: (type: string) => claims.find((c) => c.type === type)?.value ?? null,
			});

			const context = {
				activity: req.body,
				turnState,
				sendActivity: async (activity: unknown) => {
					sentActivities.push(activity);
					return { id: `reply-${sentActivities.length}` };
				},
			} as unknown as TurnContext;

			await logic(context);
		},
	};

	return { adapter: adapter as unknown as CloudAdapter, sentActivities };
}

describe("Single-tenant Teams candidate prepare, verify, & test (#2049)", () => {
	let harness: ReturnType<typeof createInMemoryTeamsHarness>;

	beforeEach(() => {
		harness = createInMemoryTeamsHarness();
	});

	it("generates a v1.16 single-tenant Teams manifest with routeId endpoint, rollout instructions, and a valid .zip app package", async () => {
		const pkg = generateTeamsAppPackage({
			routeId: "route_teams_01",
			microsoftAppId: APP_ID_A,
			appUrl: "https://app.z8-time.test/",
			organizationName: "Acme GmbH",
		});

		expect(pkg.messagingEndpointUrl).toBe(
			"https://app.z8-time.test/api/teams/installations/route_teams_01/messages",
		);
		expect(pkg.manifest.manifestVersion).toBe(TEAMS_MANIFEST_VERSION);
		expect(pkg.manifest.id).toBe(APP_ID_A);
		expect(pkg.manifest.bots[0]?.botId).toBe(APP_ID_A);
		expect(pkg.manifest.bots[0]?.scopes).toEqual(["personal"]);
		expect(pkg.manifest.validDomains).toContain("app.z8-time.test");
		expect(pkg.usesPlaceholderAppId).toBe(false);
		expect(pkg.rolloutInstructions.length).toBeGreaterThanOrEqual(4);

		const zipBytes = await buildTeamsAppPackageZip(pkg.manifestJson);
		const zip = await JSZip.loadAsync(zipBytes);
		expect(Object.keys(zip.files).toSorted()).toEqual([
			"color.png",
			"manifest.json",
			"outline.png",
		]);
		const extractedManifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
		expect(extractedManifest.id).toBe(APP_ID_A);
	});

	it("validates single-tenant GUIDs & password, enforces cross-org claims, allows same-org tenant staging, and never leaks secrets", async () => {
		// Pre-existing legacy tenant claim owned by ORG_A
		harness.claims.set(`teams:tenant:${TENANT_ID_A}`, {
			id: "claim-existing-a",
			organizationId: ORG_A,
		});

		const preparedA = await prepareTeamsCandidateInstallation(
			{ organizationId: ORG_A, actorUserId: ADMIN_USER, organizationName: "Acme" },
			harness.deps,
		);
		expect(preparedA.routeId).toBeTruthy();
		expect(preparedA.readyForSwitch).toBe(false);

		// Invalid GUID rejected before any secret write
		const badGuid = await configureTeamsCandidateCredentials(
			{
				organizationId: ORG_A,
				actorUserId: ADMIN_USER,
				installationId: preparedA.installationId,
				microsoftAppId: "not-a-guid",
				microsoftTenantId: TENANT_ID_A,
				microsoftAppPassword: "super-secret-value-123",
			},
			harness.deps,
		);
		expect(badGuid).toMatchObject({ kind: "error", code: "invalid_app_id_format" });
		expect(harness.secrets.size).toBe(0);

		// Same org (ORG_A) CAN stage a single-tenant replacement in its OWN tenant
		const savedA = await configureTeamsCandidateCredentials(
			{
				organizationId: ORG_A,
				actorUserId: ADMIN_USER,
				installationId: preparedA.installationId,
				microsoftAppId: APP_ID_A,
				microsoftTenantId: TENANT_ID_A,
				microsoftAppPassword: "super-secret-value-123",
				tenantDisplayName: "Acme M365",
			},
			harness.deps,
		);
		expect(savedA.kind).toBe("ok");
		if (savedA.kind !== "ok") return;
		expect(savedA.view.hasStoredCredentials).toBe(true);
		expect(savedA.view.credentialRevisionNumber).toBe(1);
		expect(savedA.view.microsoftAppId).toBe(APP_ID_A);
		expect(savedA.view.microsoftTenantId).toBe(TENANT_ID_A);
		expect(savedA.view.readyForSwitch).toBe(false);
		expect(JSON.stringify(savedA.view)).not.toContain("super-secret-value-123");
		expect(JSON.stringify(harness.audits)).not.toContain("super-secret-value-123");
		expect(harness.evictedAdapters).toContainEqual({ installationId: preparedA.installationId });

		// Competing org (ORG_B) is BLOCKED from claiming ORG_A's Teams tenant
		const preparedB = await prepareTeamsCandidateInstallation(
			{ organizationId: ORG_B, actorUserId: "admin-b" },
			harness.deps,
		);
		const conflictTenant = await configureTeamsCandidateCredentials(
			{
				organizationId: ORG_B,
				actorUserId: "admin-b",
				installationId: preparedB.installationId,
				microsoftAppId: APP_ID_WRONG,
				microsoftTenantId: TENANT_ID_A,
				microsoftAppPassword: "other-secret-value-123",
			},
			harness.deps,
		);
		expect(conflictTenant).toMatchObject({ kind: "error", code: "tenant_claimed_by_other_org" });

		// Competing org (ORG_B) is ALSO BLOCKED from claiming ORG_A's Teams app ID in another tenant
		const conflictApp = await configureTeamsCandidateCredentials(
			{
				organizationId: ORG_B,
				actorUserId: "admin-b",
				installationId: preparedB.installationId,
				microsoftAppId: APP_ID_A,
				microsoftTenantId: TENANT_ID_WRONG,
				microsoftAppPassword: "other-secret-value-123",
			},
			harness.deps,
		);
		expect(conflictApp).toMatchObject({ kind: "error", code: "app_claimed_by_other_org" });
	});

	it("distinguishes secret store outage during credential save", async () => {
		const prepared = await prepareTeamsCandidateInstallation(
			{ organizationId: ORG_A, actorUserId: ADMIN_USER },
			harness.deps,
		);

		const result = await configureTeamsCandidateCredentials(
			{
				organizationId: ORG_A,
				actorUserId: ADMIN_USER,
				installationId: prepared.installationId,
				microsoftAppId: APP_ID_A,
				microsoftTenantId: TENANT_ID_A,
				microsoftAppPassword: "super-secret-value-123",
			},
			{
				...harness.deps,
				storeSecret: async () => {
					throw new SecretStoreUnavailableError("vault", "Vault sealed");
				},
			},
		);

		expect(result).toMatchObject({ kind: "error", code: "secret_store_unavailable" });
	});

	it("rejects unsigned requests, mismatched tenants, mismatched app IDs, and production invoke actions on the candidate route", async () => {
		const prepared = await prepareTeamsCandidateInstallation(
			{ organizationId: ORG_A, actorUserId: ADMIN_USER },
			harness.deps,
		);
		await configureTeamsCandidateCredentials(
			{
				organizationId: ORG_A,
				actorUserId: ADMIN_USER,
				installationId: prepared.installationId,
				microsoftAppId: APP_ID_A,
				microsoftTenantId: TENANT_ID_A,
				microsoftAppPassword: "super-secret-value-123",
			},
			harness.deps,
		);

		// 1. Unsigned request (missing Authorization header) rejected with 401
		const unsignedResp = await handleTeamsCandidateMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "message",
					text: "hello",
					conversation: { id: "conv-1", tenantId: TENANT_ID_A, conversationType: "personal" },
					recipient: { id: `28:${APP_ID_A}` },
					from: { id: "29:u1", aadObjectId: AAD_ADMIN },
				}),
				authorizationHeader: "",
			},
			harness.deps,
		);
		expect(unsignedResp.status).toBe(401);

		// 2. Mismatched tenantId rejected with 403 and fails inbound step
		const wrongTenantAdapter = makeFakeCloudAdapter({
			claimsAppId: APP_ID_A,
			claimsTenantId: TENANT_ID_WRONG,
		});
		const wrongTenantResp = await handleTeamsCandidateMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "message",
					text: "verify",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: { id: "conv-1", tenantId: TENANT_ID_WRONG, conversationType: "personal" },
					recipient: { id: `28:${APP_ID_A}` },
					from: { id: "29:u1", aadObjectId: AAD_ADMIN },
				}),
				authorizationHeader: "Bearer valid-jwt",
			},
			{ ...harness.deps, getAdapter: () => wrongTenantAdapter.adapter },
		);
		expect(wrongTenantResp.status).toBe(403);
		expect(
			harness.installations.get(prepared.installationId)?.verificationEvidence?.lastFailureCode,
		).toBe("tenant_mismatch");

		// 3. Mismatched appId rejected with 403
		const wrongAppAdapter = makeFakeCloudAdapter({
			claimsAppId: APP_ID_WRONG,
			claimsTenantId: TENANT_ID_A,
		});
		const wrongAppResp = await handleTeamsCandidateMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "message",
					text: "verify",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: { id: "conv-1", tenantId: TENANT_ID_A, conversationType: "personal" },
					recipient: { id: `28:${APP_ID_WRONG}` },
					from: { id: "29:u1", aadObjectId: AAD_ADMIN },
				}),
				authorizationHeader: "Bearer valid-jwt",
			},
			{ ...harness.deps, getAdapter: () => wrongAppAdapter.adapter },
		);
		expect(wrongAppResp.status).toBe(403);
		expect(
			harness.installations.get(prepared.installationId)?.verificationEvidence?.lastFailureCode,
		).toBe("app_mismatch");

		// 4. Production invoke (approval button) is strictly refused in candidate mode (403)
		const matchingAdapter = makeFakeCloudAdapter({
			claimsAppId: APP_ID_A,
			claimsTenantId: TENANT_ID_A,
		});
		const invokeResp = await handleTeamsCandidateMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "invoke",
					name: "adaptiveCard/action",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: { id: "conv-1", tenantId: TENANT_ID_A, conversationType: "personal" },
					recipient: { id: `28:${APP_ID_A}` },
					from: { id: "29:u1", aadObjectId: AAD_ADMIN },
					value: { action: { verb: "z8.approval.approve" } },
				}),
				authorizationHeader: "Bearer valid-jwt",
			},
			{ ...harness.deps, getAdapter: () => matchingAdapter.adapter },
		);
		expect(invokeResp.status).toBe(403);
	});

	it("fails proactive private test when personal reachability is missing, then passes end-to-end after authenticated inbound + proactive send, and expires stale proofs", async () => {
		const prepared = await prepareTeamsCandidateInstallation(
			{ organizationId: ORG_A, actorUserId: ADMIN_USER },
			harness.deps,
		);
		await configureTeamsCandidateCredentials(
			{
				organizationId: ORG_A,
				actorUserId: ADMIN_USER,
				installationId: prepared.installationId,
				microsoftAppId: APP_ID_A,
				microsoftTenantId: TENANT_ID_A,
				microsoftAppPassword: "super-secret-value-123",
			},
			harness.deps,
		);

		// Before any personal conversation is established, proactive test refuses clearly
		const missingReachability = await sendTeamsCandidateProactiveTestMessage(
			{
				organizationId: ORG_A,
				actorUserId: ADMIN_USER,
				installationId: prepared.installationId,
			},
			harness.deps,
		);
		expect(missingReachability).toMatchObject({
			kind: "error",
			code: "missing_private_reachability",
		});

		// Authenticated personal inbound activity establishes inbound proof + personal conversationReference
		const matchingAdapter = makeFakeCloudAdapter({
			claimsAppId: APP_ID_A,
			claimsTenantId: TENANT_ID_A,
		});
		const inboundResp = await handleTeamsCandidateMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "message",
					id: "act-1",
					text: "clockin", // production command must NOT execute in candidate mode
					channelId: "msteams",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: {
						id: "a:admin-personal-1",
						tenantId: TENANT_ID_A,
						conversationType: "personal",
					},
					recipient: { id: `28:${APP_ID_A}`, name: "Z8 Candidate" },
					from: { id: "29:admin", aadObjectId: AAD_ADMIN, name: "Org Admin" },
				}),
				authorizationHeader: "Bearer valid-jwt",
			},
			{ ...harness.deps, getAdapter: () => matchingAdapter.adapter },
		);
		expect(inboundResp.status).toBe(200);
		expect(harness.conversations).toHaveLength(1);
		expect(harness.conversations[0]?.externalConversationId).toBe("a:admin-personal-1");
		// Unlinked admin did NOT fabricate any member link
		expect(harness.candidateEnrollments).toHaveLength(0);

		// Now proactive private test succeeds using the installation-scoped adapter
		const sendProactive = vi.fn().mockResolvedValue({ kind: "ok", activityId: "proactive-act-1" });
		const proactiveResult = await sendTeamsCandidateProactiveTestMessage(
			{
				organizationId: ORG_A,
				actorUserId: ADMIN_USER,
				installationId: prepared.installationId,
			},
			{
				...harness.deps,
				getAdapter: () => matchingAdapter.adapter,
				sendProactiveTest: sendProactive,
			},
		);
		expect(proactiveResult.kind).toBe("ok");
		if (proactiveResult.kind !== "ok") return;
		expect(proactiveResult.view.readyForSwitch).toBe(true);
		expect(proactiveResult.view.verificationState).toBe("verified");
		expect(proactiveResult.view.steps.credentials.status).toBe("passed");
		expect(proactiveResult.view.steps.inboundProof.status).toBe("passed");
		expect(proactiveResult.view.steps.privateTest.status).toBe("passed");
		expect(sendProactive).toHaveBeenCalledWith(
			matchingAdapter.adapter,
			APP_ID_A,
			expect.objectContaining({
				serviceUrl: "https://smba.trafficmanager.net/emea/",
			}),
			expect.stringContaining("verification test"),
		);

		// 25 hours later, fresh proofs expire and readyForSwitch becomes false
		const expiredStatus = computeTeamsCandidateSetupStatus(
			harness.installations.get(prepared.installationId)!,
			new Date("2026-11-27T13:00:00.000Z"),
		);
		expect(expiredStatus.readyForSwitch).toBe(false);
		expect(expiredStatus.effectiveVerificationState).toBe("expired");
		expect(expiredStatus.steps.inboundProof.status).toBe("expired");
		expect(expiredStatus.steps.privateTest.status).toBe("expired");
	});

	it("enrolls proven same-tenant Entra employees into candidate scope and requires link proofs for other employees", async () => {
		const prepared = await prepareTeamsCandidateInstallation(
			{ organizationId: ORG_A, actorUserId: ADMIN_USER },
			harness.deps,
		);
		await configureTeamsCandidateCredentials(
			{
				organizationId: ORG_A,
				actorUserId: ADMIN_USER,
				installationId: prepared.installationId,
				microsoftAppId: APP_ID_A,
				microsoftTenantId: TENANT_ID_A,
				microsoftAppPassword: "super-secret-value-123",
			},
			harness.deps,
		);

		// Proven same-tenant Entra identity for EMP_USER in ORG_A / TENANT_ID_A
		harness.provenMembers.set(
			`${ORG_A}:${TENANT_ID_A.toLowerCase()}:${AAD_PROVEN_EMP.toLowerCase()}`,
			{ userId: EMP_USER, employeeId: EMP_ID, displayName: "Proven Employee" },
		);

		const matchingAdapter = makeFakeCloudAdapter({
			claimsAppId: APP_ID_A,
			claimsTenantId: TENANT_ID_A,
		});

		// 1. Proven same-tenant Entra employee opens private chat -> enrolled in candidate lane
		const provenResp = await handleTeamsCandidateMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "message",
					id: "act-emp-1",
					text: "hello",
					channelId: "msteams",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: {
						id: "a:emp-personal-1",
						tenantId: TENANT_ID_A,
						conversationType: "personal",
					},
					recipient: { id: `28:${APP_ID_A}` },
					from: { id: "29:emp", aadObjectId: AAD_PROVEN_EMP, name: "Proven Employee" },
				}),
				authorizationHeader: "Bearer valid-jwt",
			},
			{ ...harness.deps, getAdapter: () => matchingAdapter.adapter },
		);
		expect(provenResp.status).toBe(200);
		expect(harness.candidateEnrollments).toEqual([
			{
				organizationId: ORG_A,
				installationId: prepared.installationId,
				userId: EMP_USER,
				employeeId: EMP_ID,
				externalUserId: AAD_PROVEN_EMP,
				externalScope: `teams:tenant:${TENANT_ID_A}`,
				provenance: "verified_same_scope_reuse",
			},
		]);

		// 2. Unlinked employee uses organization- and installation-bound link proof
		const redeemLinkProof = vi.fn().mockResolvedValue({
			status: "success",
			userId: "user-emp-2",
			employeeId: "e2049000-0000-4000-8000-000000000002",
			linkId: "link-proof-1",
			installationId: prepared.installationId,
			isCandidateEnrollment: true,
		});
		const proofResp = await handleTeamsCandidateMessageRequest(
			{
				routeId: prepared.routeId,
				rawBody: JSON.stringify({
					type: "message",
					id: "act-emp-2",
					text: "link ABCD-EFGH-2345",
					channelId: "msteams",
					serviceUrl: "https://smba.trafficmanager.net/emea/",
					conversation: {
						id: "a:emp-personal-2",
						tenantId: TENANT_ID_A,
						conversationType: "personal",
					},
					recipient: { id: `28:${APP_ID_A}` },
					from: { id: "29:emp2", aadObjectId: AAD_UNLINKED_EMP, name: "Other Employee" },
				}),
				authorizationHeader: "Bearer valid-jwt",
			},
			{
				...harness.deps,
				getAdapter: () => matchingAdapter.adapter,
				redeemLinkProof,
			},
		);
		expect(proofResp.status).toBe(200);
		expect(redeemLinkProof).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: ORG_A,
				installationId: prepared.installationId,
				purpose: "candidate_enrollment",
				code: "ABCD-EFGH-2345",
				externalUserId: AAD_UNLINKED_EMP,
				externalConversationId: "a:emp-personal-2",
				conversationType: "personal",
			}),
		);
	});
});
