import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { readPeriodSubmissionOverview } from "./actions";

const auth = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getCurrentSettingsRouteContext: auth.context }));
let fixture: ClosedMonthDatabaseFixture;
let organizationId: string;
let ownerUserId: string;
beforeAll(async () => {
	fixture = await createClosedMonthDatabaseFixture();
	await import("@/lib/calendar/work-policy-requirements");
}, 60000);
afterAll(async () => {
	await fixture.close();
});
beforeEach(async () => {
	({ organizationId, ownerUserId } = await fixture.organization("Europe/Berlin"));
	auth.context.mockReset();
});
const context = (
	accessTier: "member" | "manager" | "orgAdmin",
	employee: { id: string; organizationId: string } | null = null,
) => ({
	accessTier,
	authContext: {
		user: { id: ownerUserId },
		session: { activeOrganizationId: organizationId },
		employee,
	},
});
it("reads real cadence-off guidance for an admitted owner without an employee", async () => {
	auth.context.mockResolvedValue(context("orgAdmin"));
	expect(await readPeriodSubmissionOverview(null, { userId: ownerUserId, organizationId })).toEqual(
		{ status: "ok", scope: "all", overview: { kind: "off" } },
	);
});
it("refuses queued organization and actor expectations using the current server session", async () => {
	auth.context.mockResolvedValue(context("orgAdmin"));
	expect(
		await readPeriodSubmissionOverview(null, { userId: ownerUserId, organizationId: "other" }),
	).toEqual({ status: "forbidden" });
	expect(
		await readPeriodSubmissionOverview(null, { userId: "old-reader", organizationId }),
	).toEqual({ status: "forbidden" });
});
it("refuses an employee, a manager without an employee, and an employee belonging to another organization", async () => {
	for (const ctx of [
		context("member"),
		context("manager"),
		context("manager", { id: "foreign", organizationId: "other" }),
	]) {
		auth.context.mockResolvedValue(ctx);
		expect(
			await readPeriodSubmissionOverview(null, { userId: ownerUserId, organizationId }),
		).toEqual({ status: "forbidden" });
	}
});
it("returns a recoverable generic result on session transport failure and rereads on retry", async () => {
	auth.context.mockRejectedValueOnce(new Error("private failure"));
	expect(await readPeriodSubmissionOverview(null, { userId: ownerUserId, organizationId })).toEqual(
		{ status: "unavailable" },
	);
	auth.context.mockResolvedValue(context("orgAdmin"));
	expect(
		(await readPeriodSubmissionOverview(null, { userId: ownerUserId, organizationId })).status,
	).toBe("ok");
});
