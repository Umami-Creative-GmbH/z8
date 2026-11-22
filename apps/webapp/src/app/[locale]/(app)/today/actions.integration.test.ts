import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { readTodayBriefing } from "./actions";

const request = vi.hoisted(() => ({
	session: undefined as
		| undefined
		| { user: { id: string }; session: { activeOrganizationId: string } },
}));
vi.mock("@/lib/auth/request-session", () => ({ getRequestSession: () => request.session }));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);

describe("Today public read action with the real organization roster", () => {
	let fixture: LifecycleDatabaseFixture;
	let employee: SeededEmployee;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		employee = await fixture.seedEmployee();
	});
	afterAll(async () => {
		await fixture?.close();
	});
	it("returns the admitted admin's real organization snapshot", async () => {
		request.session = {
			user: { id: fixture.ownerUserId },
			session: { activeOrganizationId: fixture.organizationId },
		};
		const result = await readTodayBriefing({
			userId: fixture.ownerUserId,
			organizationId: fixture.organizationId,
		});
		expect(result.status).toBe("ready");
		if (result.status !== "ready") throw Error("Expected admitted read");
		expect(result.briefing.sections.payroll.items.map((item) => item.href)).toEqual([
			"/payroll",
		]);
	});
	it("refuses employee access rather than interpreting an empty manager scope as all-clear", async () => {
		request.session = {
			user: { id: employee.userId },
			session: { activeOrganizationId: fixture.organizationId },
		};
		expect(
			await readTodayBriefing({ userId: employee.userId, organizationId: fixture.organizationId }),
		).toEqual({ status: "unavailable" });
	});
	it("refuses a stale organization and a stale actor without exposing a snapshot", async () => {
		request.session = {
			user: { id: fixture.ownerUserId },
			session: { activeOrganizationId: fixture.organizationId },
		};
		expect(
			await readTodayBriefing({ userId: fixture.ownerUserId, organizationId: "other-org" }),
		).toEqual({ status: "unavailable" });
		expect(
			await readTodayBriefing({ userId: employee.userId, organizationId: fixture.organizationId }),
		).toEqual({ status: "unavailable" });
	});
	it("refuses a missing session", async () => {
		request.session = undefined;
		expect(
			await readTodayBriefing({
				userId: fixture.ownerUserId,
				organizationId: fixture.organizationId,
			}),
		).toEqual({ status: "unavailable" });
	});
});
