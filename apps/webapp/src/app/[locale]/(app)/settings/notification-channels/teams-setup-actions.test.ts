import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamsCandidateSetupView } from "@/lib/chat-installations/teams-app-package";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
	getTeamsCandidateSetupView: vi.fn(),
	prepareTeamsCandidateInstallation: vi.fn(),
	configureTeamsCandidateCredentials: vi.fn(),
	sendTeamsCandidateProactiveTestMessage: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/chat-installations/teams-setup", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-installations/teams-setup")>();
	return {
		...actual,
		getTeamsCandidateSetupView: mocks.getTeamsCandidateSetupView,
		prepareTeamsCandidateInstallation: mocks.prepareTeamsCandidateInstallation,
		configureTeamsCandidateCredentials: mocks.configureTeamsCandidateCredentials,
		sendTeamsCandidateProactiveTestMessage: mocks.sendTeamsCandidateProactiveTestMessage,
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
	getTeamsCandidateSetup,
	prepareTeamsCandidate,
	saveTeamsCandidateCredentials,
	sendTeamsCandidateProactiveTest,
} from "./teams-setup-actions";

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

const sampleView: TeamsCandidateSetupView = {
	installationId: "22222222-2222-4222-8222-222222222222",
	organizationId: "org-1",
	routeId: "route_teams_abc",
	status: "candidate",
	verificationState: "pending",
	readyForSwitch: false,
	microsoftAppId: "11111111-2222-4333-8444-555555555551",
	microsoftTenantId: "aaaa1111-2222-4333-8444-555555555551",
	tenantDisplayName: "Acme M365",
	hasStoredCredentials: true,
	credentialRevisionNumber: 1,
	messagingEndpointUrl: "https://app.z8-time.test/api/teams/installations/route_teams_abc/messages",
	manifestJson: '{"manifestVersion":"1.16"}',
	manifestFileName: "manifest.json",
	packageFileName: "z8-teams-single-tenant-app.zip",
	usesPlaceholderAppId: false,
	rolloutInstructions: [],
	hasPrivateReachability: true,
	privateReachabilityUpdatedAt: "2026-11-26T12:00:00.000Z",
	enrollmentProofCount: 1,
	steps: {
		credentials: {
			status: "passed",
			verifiedAt: "2026-11-26T12:00:00.000Z",
			expiresAt: null,
			detail: "11111111-2222-4333-8444-555555555551 / Acme M365",
			failureCode: null,
		},
		inboundProof: {
			status: "passed",
			verifiedAt: "2026-11-26T12:01:00.000Z",
			expiresAt: "2026-11-27T12:01:00.000Z",
			detail: "message",
			failureCode: null,
		},
		privateTest: {
			status: "pending",
			verifiedAt: null,
			expiresAt: null,
			detail: null,
			failureCode: null,
		},
	},
	lastVerifiedAt: null,
	updatedAt: "2026-11-26T12:01:00.000Z",
};

describe("Teams candidate setup server actions (#2049)", () => {
	beforeEach(() => {
		mocks.caller = orgAdmin;
		vi.clearAllMocks();
		mocks.getTeamsCandidateSetupView.mockResolvedValue(sampleView);
		mocks.prepareTeamsCandidateInstallation.mockResolvedValue(sampleView);
		mocks.configureTeamsCandidateCredentials.mockResolvedValue({
			kind: "ok",
			view: sampleView,
		});
		mocks.sendTeamsCandidateProactiveTestMessage.mockResolvedValue({
			kind: "ok",
			view: { ...sampleView, verificationState: "verified", readyForSwitch: true },
			conversationId: "a:personal-conv-1",
			activityId: "act-123",
		});
	});

	it("rechecks org-admin access on every step and refuses mid-setup role demotion or departure", async () => {
		const prepared = await prepareTeamsCandidate();
		expect(prepared).toEqual({ success: true, data: sampleView });

		mocks.caller = demotedMember;
		const credResult = await saveTeamsCandidateCredentials({
			installationId: sampleView.installationId,
			microsoftAppId: "11111111-2222-4333-8444-555555555551",
			microsoftTenantId: "aaaa1111-2222-4333-8444-555555555551",
			microsoftAppPassword: "client-secret-value-123",
		});
		expect(credResult).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.configureTeamsCandidateCredentials).not.toHaveBeenCalled();

		mocks.caller = formerAdmin;
		const testResult = await sendTeamsCandidateProactiveTest({
			installationId: sampleView.installationId,
		});
		expect(testResult).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.sendTeamsCandidateProactiveTestMessage).not.toHaveBeenCalled();
	});

	it("refuses signed-out callers across all Teams setup actions", async () => {
		mocks.caller = null;
		expect(await getTeamsCandidateSetup()).toMatchObject({
			success: false,
			code: "AuthenticationError",
		});
		expect(await prepareTeamsCandidate()).toMatchObject({
			success: false,
			code: "AuthenticationError",
		});
	});

	it("maps tenant/reachability refusals to ValidationError and secret store outages to ExternalServiceError", async () => {
		mocks.configureTeamsCandidateCredentials.mockResolvedValueOnce({
			kind: "error",
			code: "tenant_claimed_by_other_org",
			message: "Tenant already claimed",
		});
		const conflict = await saveTeamsCandidateCredentials({
			installationId: sampleView.installationId,
			microsoftAppId: "11111111-2222-4333-8444-555555555551",
			microsoftTenantId: "aaaa1111-2222-4333-8444-555555555551",
			microsoftAppPassword: "client-secret-value-123",
		});
		expect(conflict).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "tenant_claimed_by_other_org",
		});

		mocks.sendTeamsCandidateProactiveTestMessage.mockResolvedValueOnce({
			kind: "error",
			code: "missing_private_reachability",
			message: "Missing personal chat",
		});
		const missingReachability = await sendTeamsCandidateProactiveTest({
			installationId: sampleView.installationId,
		});
		expect(missingReachability).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "missing_private_reachability",
		});

		mocks.configureTeamsCandidateCredentials.mockResolvedValueOnce({
			kind: "error",
			code: "secret_store_unavailable",
			message: "Vault unavailable",
		});
		const outage = await saveTeamsCandidateCredentials({
			installationId: sampleView.installationId,
			microsoftAppId: "11111111-2222-4333-8444-555555555551",
			microsoftTenantId: "aaaa1111-2222-4333-8444-555555555551",
			microsoftAppPassword: "client-secret-value-123",
		});
		expect(outage).toMatchObject({
			success: false,
			code: "ExternalServiceError",
		});
	});

	it("revalidates settings page after credential save and proactive test", async () => {
		const credResult = await saveTeamsCandidateCredentials({
			installationId: sampleView.installationId,
			microsoftAppId: "11111111-2222-4333-8444-555555555551",
			microsoftTenantId: "aaaa1111-2222-4333-8444-555555555551",
			microsoftAppPassword: "client-secret-value-123",
		});
		expect(credResult.success).toBe(true);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/notification-channels");

		const testResult = await sendTeamsCandidateProactiveTest({
			installationId: sampleView.installationId,
		});
		expect(testResult.success).toBe(true);
		expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
	});
});
