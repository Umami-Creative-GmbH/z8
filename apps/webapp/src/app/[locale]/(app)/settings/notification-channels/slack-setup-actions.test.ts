import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackCandidateSetupView } from "@/lib/chat-installations/slack-setup";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
	getSlackCandidateSetupView: vi.fn(),
	prepareSlackCandidateInstallation: vi.fn(),
	configureSlackCandidateCredentials: vi.fn(),
	sendSlackCandidateTestMessage: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/chat-installations/slack-setup", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-installations/slack-setup")>();
	return {
		...actual,
		getSlackCandidateSetupView: mocks.getSlackCandidateSetupView,
		prepareSlackCandidateInstallation: mocks.prepareSlackCandidateInstallation,
		configureSlackCandidateCredentials: mocks.configureSlackCandidateCredentials,
		sendSlackCandidateTestMessage: mocks.sendSlackCandidateTestMessage,
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
	getSlackCandidateSetup,
	prepareSlackCandidate,
	saveAndVerifySlackCandidateCredentials,
	sendSlackCandidatePrivateTest,
} from "./slack-setup-actions";

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

const sampleView: SlackCandidateSetupView = {
	installationId: "11111111-1111-4111-8111-111111111111",
	organizationId: "org-1",
	routeId: "route_test123",
	status: "candidate",
	verificationState: "pending",
	readyForSwitch: false,
	externalAppId: "A01CANDIDATE",
	externalBotId: "U01BOTUSER",
	externalBotUsername: "z8-org-bot",
	externalSpaceId: "T01WORKSPACE",
	externalSpaceName: "Acme Workspace",
	hasStoredCredentials: true,
	credentialRevisionNumber: 1,
	urls: {
		eventsUrl: "https://app.z8-time.test/api/slack/installations/route_test123/events",
		interactionsUrl: "https://app.z8-time.test/api/slack/installations/route_test123/interactions",
		commandsUrl: "https://app.z8-time.test/api/slack/installations/route_test123/commands",
	},
	manifestJson: "{}",
	manifestYaml: 'display_information:\n  name: "Z8"',
	steps: {
		credentials: {
			status: "passed",
			verifiedAt: "2026-11-26T12:00:00.000Z",
			expiresAt: null,
			detail: null,
			failureCode: null,
		},
		identity: {
			status: "passed",
			verifiedAt: "2026-11-26T12:00:00.000Z",
			expiresAt: null,
			detail: "A01CANDIDATE / Acme Workspace",
			failureCode: null,
		},
		signedEvent: {
			status: "pending",
			verifiedAt: null,
			expiresAt: null,
			detail: null,
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
	updatedAt: "2026-11-26T12:00:00.000Z",
};

describe("Slack candidate setup server actions (#2041)", () => {
	beforeEach(() => {
		mocks.caller = orgAdmin;
		vi.clearAllMocks();
		mocks.getSlackCandidateSetupView.mockResolvedValue(sampleView);
		mocks.prepareSlackCandidateInstallation.mockResolvedValue(sampleView);
		mocks.configureSlackCandidateCredentials.mockResolvedValue({
			kind: "ok",
			view: sampleView,
		});
		mocks.sendSlackCandidateTestMessage.mockResolvedValue({
			kind: "ok",
			view: { ...sampleView, verificationState: "verified", readyForSwitch: true },
			channelId: "D01TEST",
			messageTs: "1732622400.000100",
		});
	});

	it("rechecks org-admin access on every step and refuses mid-setup role demotion or departure", async () => {
		// Step 1: Prepare succeeds while caller is org admin
		const prepared = await prepareSlackCandidate();
		expect(prepared).toEqual({ success: true, data: sampleView });

		// Role changes mid-setup: demoted to regular member before saving credentials
		mocks.caller = demotedMember;
		const credResult = await saveAndVerifySlackCandidateCredentials({
			installationId: sampleView.installationId,
			botToken: "xoxb-1234567890-secret",
			signingSecret: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
		});
		expect(credResult).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.configureSlackCandidateCredentials).not.toHaveBeenCalled();

		// Former employee cannot send private test message
		mocks.caller = formerAdmin;
		const testResult = await sendSlackCandidatePrivateTest({
			installationId: sampleView.installationId,
			slackUserId: "UADMIN1234",
		});
		expect(testResult).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.sendSlackCandidateTestMessage).not.toHaveBeenCalled();
	});

	it("refuses signed-out callers across all Slack setup actions", async () => {
		mocks.caller = null;
		expect(await getSlackCandidateSetup()).toMatchObject({
			success: false,
			code: "AuthenticationError",
		});
		expect(await prepareSlackCandidate()).toMatchObject({
			success: false,
			code: "AuthenticationError",
		});
	});

	it("maps domain refusals (mismatched identity, workspace conflict) to ValidationError with refusal codes and secret store outages to ExternalServiceError", async () => {
		mocks.configureSlackCandidateCredentials.mockResolvedValueOnce({
			kind: "error",
			code: "workspace_claimed_by_other_org",
			message: "Workspace already claimed",
		});
		const conflict = await saveAndVerifySlackCandidateCredentials({
			installationId: sampleView.installationId,
			botToken: "xoxb-1234567890-secret",
			signingSecret: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
		});
		expect(conflict).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "workspace_claimed_by_other_org",
		});

		mocks.configureSlackCandidateCredentials.mockResolvedValueOnce({
			kind: "error",
			code: "secret_store_unavailable",
			message: "Secret store unavailable",
		});
		const outage = await saveAndVerifySlackCandidateCredentials({
			installationId: sampleView.installationId,
			botToken: "xoxb-1234567890-secret",
			signingSecret: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
		});
		expect(outage).toMatchObject({
			success: false,
			code: "ExternalServiceError",
		});
	});

	it("revalidates settings page after credential verification and private test", async () => {
		const credResult = await saveAndVerifySlackCandidateCredentials({
			installationId: sampleView.installationId,
			botToken: "xoxb-1234567890-secret",
			signingSecret: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
		});
		expect(credResult.success).toBe(true);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/notification-channels");

		const testResult = await sendSlackCandidatePrivateTest({
			installationId: sampleView.installationId,
			slackUserId: "UADMIN1234",
		});
		expect(testResult.success).toBe(true);
		expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
	});
});
