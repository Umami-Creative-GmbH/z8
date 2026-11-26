import type { ConversationReference } from "botbuilder";
import { beforeEach, describe, expect, it, vi } from "vitest";

const botbuilderMocks = vi.hoisted(() => {
	const credentialFactoryCalls: Array<Record<string, unknown>> = [];
	const authCalls: Array<unknown[]> = [];
	const continueConversationAsync = vi.fn();
	const adapterInstances: Array<{
		auth: unknown;
		onTurnError: unknown;
		continueConversationAsync: typeof continueConversationAsync;
	}> = [];

	class MockConfigurationServiceClientCredentialFactory {
		config: Record<string, unknown>;
		constructor(config: Record<string, unknown>) {
			this.config = config;
			credentialFactoryCalls.push(config);
		}
	}

	class MockConfigurationBotFrameworkAuthentication {
		args: unknown[];
		constructor(...args: unknown[]) {
			this.args = args;
			authCalls.push(args);
		}
	}

	class MockCloudAdapter {
		auth: unknown;
		onTurnError: unknown = null;
		continueConversationAsync = continueConversationAsync;
		constructor(auth: unknown) {
			this.auth = auth;
			adapterInstances.push(this);
		}
	}

	return {
		credentialFactoryCalls,
		authCalls,
		continueConversationAsync,
		adapterInstances,
		MockConfigurationServiceClientCredentialFactory,
		MockConfigurationBotFrameworkAuthentication,
		MockCloudAdapter,
	};
});

vi.mock("botbuilder", () => ({
	CloudAdapter: botbuilderMocks.MockCloudAdapter,
	ConfigurationBotFrameworkAuthentication:
		botbuilderMocks.MockConfigurationBotFrameworkAuthentication,
	ConfigurationServiceClientCredentialFactory:
		botbuilderMocks.MockConfigurationServiceClientCredentialFactory,
}));

vi.mock("@/env", () => ({
	env: {
		MICROSOFT_APP_ID: "00000000-0000-4000-8000-000000000001",
		MICROSOFT_APP_PASSWORD: "legacy-deployment-secret",
		MICROSOFT_APP_TYPE: "MultiTenant",
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

import {
	evictTeamsInstallationBotAdapter,
	getBotAdapter,
	getTeamsInstallationBotAdapter,
	sendTeamsProactiveTestMessage,
} from "./bot-adapter";

const APP_A = "11111111-2222-4333-8444-555555555551";
const APP_B = "11111111-2222-4333-8444-555555555552";
const TENANT_A = "aaaa1111-2222-4333-8444-555555555551";
const TENANT_B = "bbbb1111-2222-4333-8444-555555555552";

describe("Teams installation & revision-scoped bot adapter (#2049)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		botbuilderMocks.credentialFactoryCalls.length = 0;
		botbuilderMocks.authCalls.length = 0;
		botbuilderMocks.adapterInstances.length = 0;
		evictTeamsInstallationBotAdapter("inst-1");
		evictTeamsInstallationBotAdapter("inst-2");
	});

	it("caches adapters strictly by (installationId, credentialRevisionId) with SingleTenant auth and never mixes credentials", () => {
		const adapter1Rev1 = getTeamsInstallationBotAdapter({
			installationId: "inst-1",
			credentialRevisionId: "rev-1",
			appId: APP_A,
			appPassword: "secret-inst1-rev1",
			tenantId: TENANT_A,
		});
		const adapter1Rev1Again = getTeamsInstallationBotAdapter({
			installationId: "inst-1",
			credentialRevisionId: "rev-1",
			appId: APP_A,
			appPassword: "secret-inst1-rev1",
			tenantId: TENANT_A,
		});
		const adapter1Rev2 = getTeamsInstallationBotAdapter({
			installationId: "inst-1",
			credentialRevisionId: "rev-2",
			appId: APP_A,
			appPassword: "secret-inst1-rev2",
			tenantId: TENANT_A,
		});
		const adapter2Rev1 = getTeamsInstallationBotAdapter({
			installationId: "inst-2",
			credentialRevisionId: "rev-1",
			appId: APP_B,
			appPassword: "secret-inst2-rev1",
			tenantId: TENANT_B,
		});

		expect(adapter1Rev1).toBe(adapter1Rev1Again);
		expect(adapter1Rev1).not.toBe(adapter1Rev2);
		expect(adapter1Rev1).not.toBe(adapter2Rev1);
		expect(adapter1Rev2).not.toBe(adapter2Rev1);

		expect(botbuilderMocks.credentialFactoryCalls).toEqual([
			{
				MicrosoftAppId: APP_A,
				MicrosoftAppPassword: "secret-inst1-rev1",
				MicrosoftAppType: "SingleTenant",
				MicrosoftAppTenantId: TENANT_A,
			},
			{
				MicrosoftAppId: APP_A,
				MicrosoftAppPassword: "secret-inst1-rev2",
				MicrosoftAppType: "SingleTenant",
				MicrosoftAppTenantId: TENANT_A,
			},
			{
				MicrosoftAppId: APP_B,
				MicrosoftAppPassword: "secret-inst2-rev1",
				MicrosoftAppType: "SingleTenant",
				MicrosoftAppTenantId: TENANT_B,
			},
		]);
	});

	it("keeps the legacy deployment-managed adapter isolated from installation-scoped adapters", () => {
		const legacyAdapter = getBotAdapter();
		const orgAdapter = getTeamsInstallationBotAdapter({
			installationId: "inst-1",
			credentialRevisionId: "rev-1",
			appId: APP_A,
			appPassword: "org-secret",
			tenantId: TENANT_A,
		});

		expect(orgAdapter).not.toBe(legacyAdapter);
		expect(botbuilderMocks.credentialFactoryCalls).toContainEqual({
			MicrosoftAppId: APP_A,
			MicrosoftAppPassword: "org-secret",
			MicrosoftAppType: "SingleTenant",
			MicrosoftAppTenantId: TENANT_A,
		});
	});

	it("evicts a specific revision or all revisions for an installation without affecting other installations", () => {
		const inst1Rev1 = getTeamsInstallationBotAdapter({
			installationId: "inst-1",
			credentialRevisionId: "rev-1",
			appId: APP_A,
			appPassword: "secret-1",
			tenantId: TENANT_A,
		});
		const inst1Rev2 = getTeamsInstallationBotAdapter({
			installationId: "inst-1",
			credentialRevisionId: "rev-2",
			appId: APP_A,
			appPassword: "secret-2",
			tenantId: TENANT_A,
		});
		const inst2Rev1 = getTeamsInstallationBotAdapter({
			installationId: "inst-2",
			credentialRevisionId: "rev-1",
			appId: APP_B,
			appPassword: "secret-b",
			tenantId: TENANT_B,
		});

		// Evict only rev-1 of inst-1
		expect(evictTeamsInstallationBotAdapter("inst-1", "rev-1")).toBe(1);
		const inst1Rev1Recreated = getTeamsInstallationBotAdapter({
			installationId: "inst-1",
			credentialRevisionId: "rev-1",
			appId: APP_A,
			appPassword: "secret-1",
			tenantId: TENANT_A,
		});
		expect(inst1Rev1Recreated).not.toBe(inst1Rev1);
		// rev-2 and inst-2 remain cached
		expect(
			getTeamsInstallationBotAdapter({
				installationId: "inst-1",
				credentialRevisionId: "rev-2",
				appId: APP_A,
				appPassword: "secret-2",
				tenantId: TENANT_A,
			}),
		).toBe(inst1Rev2);

		// Evict all revisions of inst-1
		expect(evictTeamsInstallationBotAdapter("inst-1")).toBe(2);
		expect(
			getTeamsInstallationBotAdapter({
				installationId: "inst-2",
				credentialRevisionId: "rev-1",
				appId: APP_B,
				appPassword: "secret-b",
				tenantId: TENANT_B,
			}),
		).toBe(inst2Rev1);
	});

	it("sends a synthetic proactive private test message using the installation-scoped adapter and conversation reference", async () => {
		const adapter = getTeamsInstallationBotAdapter({
			installationId: "inst-1",
			credentialRevisionId: "rev-1",
			appId: APP_A,
			appPassword: "secret-1",
			tenantId: TENANT_A,
		});
		const sendActivity = vi.fn().mockResolvedValue({ id: "activity-test-123" });
		botbuilderMocks.continueConversationAsync.mockImplementationOnce(
			async (
				_appId: string,
				_ref: ConversationReference,
				logic: (ctx: { sendActivity: typeof sendActivity }) => Promise<void>,
			) => {
				await logic({ sendActivity });
			},
		);

		const ref: ConversationReference = {
			serviceUrl: "https://smba.trafficmanager.net/emea/",
			channelId: "msteams",
			conversation: { id: "a:personal-conv-1", tenantId: TENANT_A, isGroup: false, name: "" },
			bot: { id: `28:${APP_A}`, name: "Z8 Candidate" },
			user: { id: "29:user-1", aadObjectId: "aad-user-1", name: "Admin" },
		};

		const result = await sendTeamsProactiveTestMessage(
			adapter,
			APP_A,
			ref,
			"Synthetic Teams test message",
		);

		expect(result).toEqual({ kind: "ok", activityId: "activity-test-123" });
		expect(botbuilderMocks.continueConversationAsync).toHaveBeenCalledWith(
			APP_A,
			ref,
			expect.any(Function),
		);
		expect(sendActivity).toHaveBeenCalledWith({
			type: "message",
			text: "Synthetic Teams test message",
		});
	});

	it("returns classified TeamsCallFailure when proactive test fails", async () => {
		const adapter = getTeamsInstallationBotAdapter({
			installationId: "inst-1",
			credentialRevisionId: "rev-1",
			appId: APP_A,
			appPassword: "secret-1",
			tenantId: TENANT_A,
		});
		botbuilderMocks.continueConversationAsync.mockRejectedValueOnce(
			Object.assign(new Error("Unauthorized"), { statusCode: 401, code: "Unauthorized" }),
		);

		const ref: ConversationReference = {
			serviceUrl: "https://smba.trafficmanager.net/emea/",
			channelId: "msteams",
			conversation: { id: "a:personal-conv-1", tenantId: TENANT_A, isGroup: false, name: "" },
		};

		const result = await sendTeamsProactiveTestMessage(adapter, APP_A, ref, "Test");
		expect(result).toEqual({ kind: "failed", status: 401, code: "Unauthorized" });
	});
});
