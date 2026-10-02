import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	getSession: vi.fn(),
	findMember: vi.fn(),
	findEmployee: vi.fn(),
	findSettings: vi.fn(),
	canAccessSso: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: state.getSession,
}));
vi.mock("@/lib/enterprise-identity/session-sso-store", () => ({
	canAccessOrganizationWithSso: state.canAccessSso,
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: state.findMember },
			employee: { findFirst: state.findEmployee },
			userSettings: { findFirst: state.findSettings },
		},
	},
}));
vi.mock("@/db/auth-schema", () => ({
	member: {
		userId: "member.userId",
		organizationId: "member.organizationId",
		status: "member.status",
	},
}));
vi.mock("@/db/schema", () => ({
	employee: {
		userId: "employee.userId",
		organizationId: "employee.organizationId",
		isActive: "employee.isActive",
	},
	userSettings: { userId: "userSettings.userId" },
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
}));

import { getCurrentEmployee } from "./actions/auth";
import { getTimeTrackingRenderContext } from "./render-context";

function session(activeOrganizationId: string | null = "org-1") {
	return {
		user: { id: "user-1", name: "Test Employee" },
		session: { id: "session-1", userId: "user-1", activeOrganizationId },
	};
}

describe("getTimeTrackingRenderContext", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		state.getSession.mockResolvedValue(session());
		state.canAccessSso.mockResolvedValue(true);
		state.findMember.mockResolvedValue({ id: "member-1", role: "owner" });
		state.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			userId: "user-1",
			isActive: true,
		});
		state.findSettings.mockResolvedValue(undefined);
	});

	it.each([
		["absent", null],
		["banned", { ...session(), user: { ...session().user, banned: true } }],
		["SSO-required", { ...session(), ssoRequired: true }],
	])("denies a %s session without employee I/O", async (_name, value) => {
		state.getSession.mockResolvedValue(value);
		expect(await getTimeTrackingRenderContext()).toBeNull();
		expect(state.findMember).not.toHaveBeenCalled();
		expect(state.findEmployee).not.toHaveBeenCalled();
		expect(state.findSettings).not.toHaveBeenCalled();
	});

	it("denies failed organization SSO before employee I/O", async () => {
		state.canAccessSso.mockResolvedValue(false);
		expect(await getTimeTrackingRenderContext()).toBeNull();
		expect(state.canAccessSso).toHaveBeenCalledWith(session().session, "org-1");
		expect(state.findEmployee).not.toHaveBeenCalled();
	});

	it("keeps the authenticated no-employee state when no organization is active", async () => {
		state.getSession.mockResolvedValue(session(null));
		expect(await getTimeTrackingRenderContext()).toMatchObject({
			userId: "user-1",
			employee: null,
			membershipRole: null,
		});
		expect(state.findMember).not.toHaveBeenCalled();
		expect(state.findEmployee).not.toHaveBeenCalled();
	});

	it("does not return employee data for an unapproved or revoked membership", async () => {
		state.findMember.mockResolvedValue(undefined);
		expect(await getTimeTrackingRenderContext()).toMatchObject({
			employee: null,
			membershipRole: null,
		});
		expect(state.findMember).toHaveBeenCalledWith({
			columns: { id: true, role: true },
			where: {
				type: "and",
				conditions: [
					{ type: "eq", column: "member.userId", value: "user-1" },
					{ type: "eq", column: "member.organizationId", value: "org-1" },
					{ type: "eq", column: "member.status", value: "approved" },
				],
			},
		});
	});

	it("keeps the no-employee state for missing or ineligible employee records", async () => {
		state.findEmployee.mockResolvedValue(undefined);
		expect(await getTimeTrackingRenderContext()).toMatchObject({
			employee: null,
			membershipRole: null,
		});
		expect(state.findEmployee).toHaveBeenCalledWith({
			where: {
				type: "and",
				conditions: [
					{ type: "eq", column: "employee.userId", value: "user-1" },
					{ type: "eq", column: "employee.organizationId", value: "org-1" },
					{ type: "eq", column: "employee.isActive", value: true },
				],
			},
		});
	});

	it.each(["owner", "admin", "employee"])(
		"resolves approved %s membership once with existing defaults",
		async (role) => {
			state.findMember.mockResolvedValue({ id: "member-1", role });
			const context = await getTimeTrackingRenderContext();
			expect(context).toMatchObject({
				userId: "user-1",
				employeeName: "Test Employee",
				employee: { id: "employee-1", organizationId: "org-1" },
				membershipRole: role,
				timezone: "UTC",
				weekStartDay: "sunday",
				timeFormat: "24h",
			});
			expect(context).not.toHaveProperty("session");
			expect(context).not.toHaveProperty("token");
			expect(state.findMember).toHaveBeenCalledTimes(1);
			expect(state.findEmployee).toHaveBeenCalledTimes(1);
			expect(state.findSettings).toHaveBeenCalledTimes(1);
		},
	);

	it("normalizes invalid presentation settings and preserves saved settings", async () => {
		state.findSettings.mockResolvedValueOnce({
			timezone: "",
			weekStartDay: "invalid",
			timeFormat: "invalid",
		});
		expect(await getTimeTrackingRenderContext()).toMatchObject({
			timezone: "UTC",
			weekStartDay: "sunday",
			timeFormat: "24h",
		});
		state.findSettings.mockResolvedValueOnce({
			timezone: "Europe/Berlin",
			weekStartDay: "monday",
			timeFormat: "12h",
		});
		expect(await getTimeTrackingRenderContext()).toMatchObject({
			timezone: "Europe/Berlin",
			weekStartDay: "monday",
			timeFormat: "12h",
		});
	});

	it("does not authorize a later action with rendering membership after revocation", async () => {
		expect(await getTimeTrackingRenderContext()).toMatchObject({
			employee: { id: "employee-1" },
		});
		state.findMember.mockResolvedValue(undefined);
		expect(await getCurrentEmployee()).toBeNull();
		expect(state.getSession).toHaveBeenCalledTimes(2);
		expect(state.findMember).toHaveBeenCalledTimes(2);
	});
});
