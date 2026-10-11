import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	session: vi.fn(),
	member: vi.fn(),
	employee: vi.fn(),
	sso: vi.fn(),
	save: vi.fn(),
}));
vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: mocks.session,
}));
vi.mock("@/lib/enterprise-identity/session-sso-store", () => ({
	canAccessOrganizationWithSso: mocks.sso,
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: mocks.member },
			employee: { findFirst: mocks.employee },
		},
	},
}));
vi.mock("@/lib/time-tracking/period-submissions/settings", () => ({
	savePeriodSubmissionSettings: mocks.save,
}));

// The shared runtime over the real DatabaseServiceLive, which reads the mocked db.
vi.mock("@/lib/effect/runtime", async () => {
	const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(DatabaseServiceLive);
});

import { updatePeriodSubmissionSettings } from "./period-submission-actions";

const input = {
	organizationId: "org-1",
	cadence: { kind: "weekly" as const, weekStartDay: "monday" as const },
	secondReminderDelayDays: 3,
};
const saved = {
	cadence: { kind: "weekly", weekStartDay: "monday" },
	inEffect: { kind: "off" },
	upcoming: { cadence: { kind: "weekly", weekStartDay: "monday" }, fromDate: "2026-03-09" },
	secondReminderDelayDays: 3,
	revision: 1,
};

describe("updatePeriodSubmissionSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.session.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mocks.member.mockResolvedValue({ role: "admin", status: "approved" });
		mocks.employee.mockResolvedValue({ isActive: true });
		mocks.sso.mockResolvedValue(true);
		mocks.save.mockResolvedValue(saved);
	});

	it.each(["admin", "owner"])(
		"lets an approved %s save the active organization's settings",
		async (role) => {
			mocks.member.mockResolvedValue({ role, status: "approved" });
			expect(await updatePeriodSubmissionSettings(input)).toEqual({ success: true, data: saved });
			const sql = new PgDialect().sqlToQuery(mocks.member.mock.calls[0][0].where);
			expect(sql.params).toEqual(["user-1", "org-1", "approved"]);
			expect(mocks.save).toHaveBeenCalledWith(
				{ ...input, actorUserId: "user-1" },
				expect.objectContaining({ database: expect.anything(), clock: expect.anything() }),
			);
		},
	);

	it("refuses a manager or ordinary member without writing", async () => {
		// Managers are ordinary organization members whose employee role is manager.
		mocks.member.mockResolvedValue({ role: "member", status: "approved" });
		mocks.employee.mockResolvedValue({ isActive: true, role: "manager" });
		expect((await updatePeriodSubmissionSettings(input)).success).toBe(false);
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("refuses a departed admin, missing membership and missing authentication", async () => {
		mocks.employee.mockResolvedValue({ isActive: false });
		expect((await updatePeriodSubmissionSettings(input)).success).toBe(false);
		mocks.employee.mockResolvedValue({ isActive: true });
		mocks.member.mockResolvedValue(undefined);
		expect((await updatePeriodSubmissionSettings(input)).success).toBe(false);
		mocks.session.mockResolvedValue(null);
		expect((await updatePeriodSubmissionSettings(input)).success).toBe(false);
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("refuses an organization other than the active one", async () => {
		expect(
			(await updatePeriodSubmissionSettings({ ...input, organizationId: "org-other" })).success,
		).toBe(false);
		expect(mocks.member).not.toHaveBeenCalled();
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("saves a monthly cadence and switching off without a week start", async () => {
		await updatePeriodSubmissionSettings({ ...input, cadence: { kind: "monthly" } });
		await updatePeriodSubmissionSettings({ ...input, cadence: { kind: "off" } });
		expect(mocks.save.mock.calls.map(([saveInput]) => saveInput.cadence)).toEqual([
			{ kind: "monthly" },
			{ kind: "off" },
		]);
	});

	it.each([
		["a weekly cadence without a week start", { ...input, cadence: { kind: "weekly" } }],
		["an unknown week start", { ...input, cadence: { kind: "weekly", weekStartDay: "someday" } }],
		["an unknown cadence", { ...input, cadence: { kind: "daily" } }],
		["a delay of 0 days", { ...input, secondReminderDelayDays: 0 }],
		["a delay of 31 days", { ...input, secondReminderDelayDays: 31 }],
		["a fractional delay", { ...input, secondReminderDelayDays: 1.5 }],
	])("rejects %s before writing", async (_label, invalid) => {
		expect(
			(
				await updatePeriodSubmissionSettings(
					invalid as unknown as Parameters<typeof updatePeriodSubmissionSettings>[0],
				)
			).success,
		).toBe(false);
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("does not expose persistence errors", async () => {
		mocks.save.mockRejectedValue(new Error("secret connection string"));
		expect(await updatePeriodSubmissionSettings(input)).toMatchObject({
			success: false,
			error: "Database query failed: periodSubmissions.saveSettings",
		});
	});
});
