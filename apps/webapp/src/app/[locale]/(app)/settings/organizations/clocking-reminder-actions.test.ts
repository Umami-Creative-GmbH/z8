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
vi.mock("@/lib/time-tracking/clocking-reminders/settings", () => ({
	saveClockingReminderSettings: mocks.save,
}));

// The shared runtime over the real DatabaseServiceLive, which reads the mocked db.
vi.mock("@/lib/effect/runtime", async () => {
	const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(DatabaseServiceLive);
});

import { updateClockingReminderSettings } from "./clocking-reminder-actions";

const input = {
	organizationId: "org-1",
	missedClockIn: { enabled: true, graceMinutes: 20 },
	forgottenClockOut: { enabled: false, graceMinutes: 30 },
	breakDue: { enabled: true, leadMinutes: 10 },
	roles: ["employee" as const, "manager" as const],
};
const saved = {
	missedClockIn: { enabled: true, graceMinutes: 20 },
	forgottenClockOut: { enabled: false, graceMinutes: 30 },
	breakDue: { enabled: true, leadMinutes: 10 },
	roles: ["employee", "manager"],
	revision: 1,
};

describe("updateClockingReminderSettings", () => {
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
			expect(await updateClockingReminderSettings(input)).toEqual({ success: true, data: saved });
			const sql = new PgDialect().sqlToQuery(mocks.member.mock.calls[0][0].where);
			expect(sql.params).toEqual(["user-1", "org-1", "approved"]);
			expect(mocks.save).toHaveBeenCalledWith(
				input,
				expect.objectContaining({ database: expect.anything(), clock: expect.anything() }),
			);
		},
	);

	it.each(["member", "manager"])("refuses a %s without writing", async (role) => {
		mocks.member.mockResolvedValue({ role, status: "approved" });
		expect((await updateClockingReminderSettings(input)).success).toBe(false);
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("refuses a submitted organization different from the active organization", async () => {
		expect(
			(await updateClockingReminderSettings({ ...input, organizationId: "org-other" })).success,
		).toBe(false);
		expect(mocks.member).not.toHaveBeenCalled();
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("refuses missing authentication", async () => {
		mocks.session.mockResolvedValue(null);
		expect((await updateClockingReminderSettings(input)).success).toBe(false);
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it.each([
		{ missedClockIn: { enabled: true, graceMinutes: -1 } },
		{ missedClockIn: { enabled: true, graceMinutes: 1441 } },
		{ forgottenClockOut: { enabled: true, graceMinutes: 2.5 } },
		{ breakDue: { enabled: true, leadMinutes: 0 } },
		{ breakDue: { enabled: true, leadMinutes: 1441 } },
		{ breakDue: undefined },
		{ roles: [] },
		{ roles: ["owner"] },
		{ roles: ["employee", "employee"] },
	])("rejects invalid settings %j before writing", async (overrides) => {
		expect(
			(
				await updateClockingReminderSettings({
					...input,
					...(overrides as Partial<typeof input>),
				})
			).success,
		).toBe(false);
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("does not expose persistence errors", async () => {
		mocks.save.mockRejectedValue(new Error("secret connection string"));
		expect(await updateClockingReminderSettings(input)).toMatchObject({
			success: false,
			error: "Database query failed: clockingReminders.saveSettings",
			code: "DatabaseError",
		});
	});
});
