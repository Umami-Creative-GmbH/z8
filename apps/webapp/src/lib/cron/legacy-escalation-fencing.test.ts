import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRON_JOBS } from "./registry";

const mocks = vi.hoisted(() => ({
	readControl: vi.fn(),
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	send: vi.fn(),
	configs: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {
	query: { approvalEscalationControl: { findFirst: mocks.readControl } },
	select: mocks.select,
	insert: mocks.insert,
	update: mocks.update,
} }));
vi.mock("@/lib/slack/bot-config", () => ({ getAllActiveBotConfigs: mocks.configs }));
vi.mock("@/lib/telegram/bot-config", () => ({ getAllActiveBotConfigs: mocks.configs }));
vi.mock("@/lib/discord/bot-config", () => ({ getAllActiveBotConfigs: mocks.configs }));
vi.mock("@/lib/teams/tenant-resolver", () => ({ getAllActiveTenants: mocks.configs }));
vi.mock("@/lib/slack/approval-handler", () => ({ sendApprovalMessageToManager: mocks.send }));
vi.mock("@/lib/telegram/approval-handler", () => ({ sendApprovalMessageToManager: mocks.send }));
vi.mock("@/lib/discord/approval-handler", () => ({ sendApprovalMessageToManager: mocks.send }));
vi.mock("@/lib/teams/approval-handler", () => ({ sendApprovalCardToManager: mocks.send }));

const jobs = ["cron:slack-escalation", "cron:telegram-escalation", "cron:discord-escalation", "cron:teams-escalation"] as const;

describe.each(jobs)("%s execution fencing", (jobName) => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.configs.mockResolvedValue([
			{ organizationId: "moved-org", tenantId: "moved", enableEscalations: true },
			{ organizationId: "paused-org", tenantId: "paused", enableEscalations: true },
		]);
		mocks.readControl.mockImplementation(({ where }) => {
			const { params } = new PgDialect().sqlToQuery(where);
			if (params[0] === "moved-org") return { owner: "escalation", automationPaused: false };
			if (params[0] === "paused-org") return { owner: "legacy", automationPaused: true };
			throw new Error("Unscoped ownership read");
		});
	});

	it("suppresses surviving scheduled, queued and manual names using current organization ownership", async () => {
		// All three dispatch sources use this retained registry processor. No
		// ownership assertion from a historical job payload may authorize work.
		const result = await CRON_JOBS[jobName].processor();
		expect(result).toMatchObject({
			success: true,
			approvalsEscalated: 0,
			errors: [],
			suppressedOrganizations: [
				{ organizationId: "moved-org", reason: "ownership_moved" },
				{ organizationId: "paused-org", reason: "automation_paused" },
			],
		});
		expect(mocks.readControl).toHaveBeenCalledTimes(2);
		expect(mocks.select).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it("fails closed on an ownership read failure and reports infrastructure failure", async () => {
		mocks.readControl.mockRejectedValue(new Error("ownership database unavailable"));
		const result = await CRON_JOBS[jobName].processor();
		expect(result.success).toBe(false);
		expect(result.errors).toHaveLength(2);
		expect(result.errors.every((error) => error.includes("ownership database unavailable"))).toBe(true);
		expect(mocks.select).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it("retains unmigrated organization behavior, then rereads ownership on the next execution", async () => {
		mocks.configs.mockResolvedValue([
			{ organizationId: "legacy-org", tenantId: "legacy", enableEscalations: true, escalationTimeoutHours: 24 },
		]);
		const selection = { from: vi.fn(), leftJoin: vi.fn(), where: vi.fn().mockResolvedValue([]) };
		selection.from.mockReturnValue(selection);
		selection.leftJoin.mockReturnValue(selection);
		mocks.select.mockReturnValue(selection);
		mocks.readControl.mockResolvedValue(undefined);
		expect(await CRON_JOBS[jobName].processor()).toMatchObject({ success: true, suppressedOrganizations: [] });
		expect(mocks.select).toHaveBeenCalledTimes(1);

		mocks.readControl.mockResolvedValue({ owner: "escalation", automationPaused: true });
		expect(await CRON_JOBS[jobName].processor()).toMatchObject({
			success: true,
			suppressedOrganizations: [{ organizationId: "legacy-org", reason: "ownership_moved" }],
		});
		expect(mocks.select).toHaveBeenCalledTimes(1);
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.send).not.toHaveBeenCalled();
	});
});
