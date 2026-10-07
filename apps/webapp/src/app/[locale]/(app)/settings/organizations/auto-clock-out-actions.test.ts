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
vi.mock("@/lib/time-tracking/automatic-clock-out/settings", () => ({
	saveAutoClockOutSettings: mocks.save,
}));

// The shared runtime over the real DatabaseServiceLive, which reads the mocked db.
vi.mock("@/lib/effect/runtime", async () => {
	const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(DatabaseServiceLive);
});

import { updateAutoClockOutSettings } from "./auto-clock-out-actions";

const input = {
	organizationId: "org-1",
	autoClockOutEnabled: true,
	maxUninterruptedMinutes: 720,
};
describe("updateAutoClockOutSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.session.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mocks.member.mockResolvedValue({ role: "admin", status: "approved" });
		mocks.employee.mockResolvedValue({ isActive: true });
		mocks.sso.mockResolvedValue(true);
		mocks.save.mockResolvedValue({
			autoClockOutEnabled: true,
			maxUninterruptedMinutes: 720,
			revision: 1,
		});
	});
	it.each(["admin", "owner"])(
		"allows an approved %s and scopes authorization before save",
		async (role) => {
			mocks.member.mockResolvedValue({ role, status: "approved" });
			expect(await updateAutoClockOutSettings(input)).toEqual({
				success: true,
				data: {
					autoClockOutEnabled: true,
					maxUninterruptedMinutes: 720,
					revision: 1,
				},
			});
			const sql = new PgDialect().sqlToQuery(mocks.member.mock.calls[0][0].where);
			expect(sql.params).toEqual(["user-1", "org-1", "approved"]);
			expect(mocks.save).toHaveBeenCalledWith(
				input,
				expect.objectContaining({
					database: expect.anything(),
					clock: expect.anything(),
				}),
			);
		},
	);
	it.each(["member", "manager"])("refuses %s without writing", async (role) => {
		mocks.member.mockResolvedValue({ role, status: "approved" });
		expect((await updateAutoClockOutSettings(input)).success).toBe(false);
		expect(mocks.save).not.toHaveBeenCalled();
	});
	it("refuses unapproved or absent membership", async () => {
		mocks.member.mockResolvedValue(undefined);
		expect((await updateAutoClockOutSettings(input)).success).toBe(false);
		expect(mocks.save).not.toHaveBeenCalled();
	});
	it("refuses departed admins", async () => {
		mocks.employee.mockResolvedValue({ isActive: false });
		expect((await updateAutoClockOutSettings(input)).success).toBe(false);
		expect(mocks.save).not.toHaveBeenCalled();
	});
	it("refuses a submitted organization different from the active organization", async () => {
		expect(
			(
				await updateAutoClockOutSettings({
					...input,
					organizationId: "org-other",
				})
			).success,
		).toBe(false);
		expect(mocks.member).not.toHaveBeenCalled();
		expect(mocks.save).not.toHaveBeenCalled();
	});
	it("refuses missing authentication and SSO access", async () => {
		mocks.session.mockResolvedValue(null);
		expect((await updateAutoClockOutSettings(input)).success).toBe(false);
		mocks.session.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mocks.sso.mockResolvedValue(false);
		expect((await updateAutoClockOutSettings(input)).success).toBe(false);
		expect(mocks.save).not.toHaveBeenCalled();
	});
	it.each([0, -1, 0.5, NaN, Infinity, 2_147_483_648])(
		"rejects invalid duration %s before writing",
		async (maxUninterruptedMinutes) => {
			expect(
				(
					await updateAutoClockOutSettings({
						...input,
						maxUninterruptedMinutes,
					})
				).success,
			).toBe(false);
			expect(mocks.save).not.toHaveBeenCalled();
		},
	);
	it("saves a retained duration while disabled", async () => {
		await updateAutoClockOutSettings({
			...input,
			autoClockOutEnabled: false,
			maxUninterruptedMinutes: 485,
		});
		expect(mocks.save).toHaveBeenCalledWith(
			{ ...input, autoClockOutEnabled: false, maxUninterruptedMinutes: 485 },
			expect.anything(),
		);
	});
	it("does not expose persistence errors", async () => {
		mocks.save.mockRejectedValue(new Error("secret connection string"));
		expect(await updateAutoClockOutSettings(input)).toMatchObject({
			success: false,
			error: "Failed to update automatic clock-out settings",
		});
	});
});
