import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { readPeriodSubmissionOverview } from "./actions";

const auth = vi.hoisted(() => ({ caller: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getCurrentSettingsAccess: auth.caller }));
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
	auth.caller.mockReset();
});
const caller = (
	settingsAccess: "member" | "scopedManager" | "orgAdmin" | "owner" | null,
	employee: { id: string; role: "admin" | "manager" | "employee" } | null = null,
) => ({
	userId: ownerUserId,
	organizationId,
	settingsAccess,
	membershipRole: settingsAccess ? "admin" : null,
	employee,
});
it("reads real cadence-off guidance for an admitted owner without an employee", async () => {
	auth.caller.mockResolvedValue(caller("owner"));
	expect(await readPeriodSubmissionOverview(null, { userId: ownerUserId, organizationId })).toEqual(
		{ status: "ok", scope: "all", overview: { kind: "off" } },
	);
});
it("refuses queued organization and actor expectations using the current server session", async () => {
	auth.caller.mockResolvedValue(caller("orgAdmin"));
	expect(
		await readPeriodSubmissionOverview(null, { userId: ownerUserId, organizationId: "other" }),
	).toEqual({ status: "forbidden" });
	expect(
		await readPeriodSubmissionOverview(null, { userId: "old-reader", organizationId }),
	).toEqual({ status: "forbidden" });
});
it("refuses an employee, a former employee, and a scoped manager without an employee", async () => {
	for (const ctx of [caller("member"), caller(null), caller("scopedManager")]) {
		auth.caller.mockResolvedValue(ctx);
		expect(
			await readPeriodSubmissionOverview(null, { userId: ownerUserId, organizationId }),
		).toEqual({ status: "forbidden" });
	}
});
it("returns a recoverable generic result on session transport failure and rereads on retry", async () => {
	auth.caller.mockRejectedValueOnce(new Error("private failure"));
	expect(await readPeriodSubmissionOverview(null, { userId: ownerUserId, organizationId })).toEqual(
		{ status: "unavailable" },
	);
	auth.caller.mockResolvedValue(caller("orgAdmin"));
	expect(
		(await readPeriodSubmissionOverview(null, { userId: ownerUserId, organizationId })).status,
	).toBe("ok");
});
