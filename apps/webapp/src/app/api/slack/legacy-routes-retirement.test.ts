import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	checkActor: vi.fn(),
	disconnectLegacySlackInstallation: vi.fn(),
	membershipRows: [] as Array<{ role: string }>,
}));

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));
vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
}));
vi.mock("@/env", () => ({ env: { APP_URL: "https://app.test" } }));
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/auth/organization-action-authorization", () => ({
	runActiveOrganizationActionActorCheck: mocks.checkActor,
}));
vi.mock("@/lib/chat-installations/switch-lifecycle", () => ({
	disconnectLegacySlackInstallation: mocks.disconnectLegacySlackInstallation,
}));
vi.mock("@/db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => mocks.membershipRows,
				}),
			}),
		}),
	},
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST as authorizePost } from "./oauth/authorize/route";
import { GET as callbackGet } from "./oauth/callback/route";
import { DELETE as setupDelete } from "./setup/route";

describe("superseded Slack deployment OAuth & legacy setup retirement (#2045)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSession.mockResolvedValue({ user: { id: "user-admin" } });
		mocks.checkActor.mockResolvedValue(undefined);
		mocks.membershipRows = [{ role: "admin" }];
		mocks.disconnectLegacySlackInstallation.mockResolvedValue({
			kind: "disconnected",
			disconnectedLegacyConfigId: "cfg-1",
			installationId: "inst-legacy-1",
		});
	});

	it("retires POST /api/slack/oauth/authorize with 410 Gone and structured refusal code", async () => {
		const res = await authorizePost();
		expect(res.status).toBe(410);
		await expect(res.json()).resolves.toMatchObject({
			code: "legacy_slack_oauth_retired",
		});
	});

	it("retires GET /api/slack/oauth/callback with 410 Gone for code/state attempts", async () => {
		const res = await callbackGet(
			new Request("https://app.test/api/slack/oauth/callback?code=abc&state=xyz") as never,
		);
		expect(res.status).toBe(410);
		await expect(res.json()).resolves.toMatchObject({
			code: "legacy_slack_oauth_retired",
		});
	});

	it("routes DELETE /api/slack/setup through disconnectLegacySlackInstallation and refuses superseded org-owned installations with 410", async () => {
		mocks.disconnectLegacySlackInstallation.mockResolvedValueOnce({
			kind: "refused",
			code: "legacy_setup_superseded",
			status: 410,
			message: "Superseded by org-owned Slack installation",
		});

		const res = await setupDelete(
			new Request("https://app.test/api/slack/setup?organizationId=org-1", {
				method: "DELETE",
			}) as never,
		);
		expect(res.status).toBe(410);
		await expect(res.json()).resolves.toMatchObject({
			code: "legacy_setup_superseded",
		});
		expect(mocks.disconnectLegacySlackInstallation).toHaveBeenCalledWith({
			organizationId: "org-1",
			actorUserId: "user-admin",
		});
	});

	it("allows authorized admin disconnect on DELETE /api/slack/setup for an eligible unswitched legacy installation", async () => {
		const res = await setupDelete(
			new Request("https://app.test/api/slack/setup?organizationId=org-1", {
				method: "DELETE",
			}) as never,
		);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ success: true });
	});
});
