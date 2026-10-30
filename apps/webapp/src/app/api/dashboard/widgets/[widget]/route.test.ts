import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORGANIZATION_CONTEXT_HEADERS } from "@/lib/auth/organization-display-context";

const boundary = vi.hoisted(() => ({
	auth: vi.fn(),
	read: vi.fn(),
	billing: vi.fn(),
	billingEnabled: "false",
}));
vi.mock("@/lib/auth-helpers", () => ({ getAuthContext: boundary.auth }));
vi.mock("@/env", () => ({
	env: {
		get BILLING_ENABLED() {
			return boundary.billingEnabled;
		},
	},
}));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForRead: boundary.billing,
	createBillingForbiddenResponse: () =>
		NextResponse.json({ error: "billing_required" }, { status: 402 }),
}));
vi.mock("@/components/dashboard/dashboard-reads", () => ({
	readDashboardWidget: boundary.read,
}));

import { GET } from "./route";

const scope = { userId: "user-a", organizationId: "org-a" };
const subject = {
	...scope,
	employee: {
		id: "employee-a",
		organizationId: "org-a",
		role: "manager",
		teamId: null,
	},
};
function request(userId = scope.userId, organizationId = scope.organizationId) {
	return new Request(
		"https://fixture.test/api/dashboard/widgets/manager-today?organizationId=untrusted",
		{
			headers: {
				[ORGANIZATION_CONTEXT_HEADERS.user]: userId,
				[ORGANIZATION_CONTEXT_HEADERS.organization]: organizationId,
			},
		},
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	boundary.billingEnabled = "false";
	boundary.auth.mockResolvedValue({
		user: { id: scope.userId },
		session: { activeOrganizationId: scope.organizationId },
		employee: subject.employee,
	});
	boundary.read.mockResolvedValue({
		scope,
		updatedAt: 1234,
		result: {
			success: true,
			data: { role: "manager", summary: { openApprovals: 5 } },
		},
	});
});

describe("Dashboard widget GET", () => {
	it.each([
		"manager-today",
		"quick-stats",
		"upcoming-shifts",
		"covering-for",
		"whos-out-today",
		"upcoming-time-off",
		"birthday-reminders",
		"hydration",
		"vacation-balance",
		"presence-status",
		"managed-employees",
		"team-overview",
		"pending-approvals",
		"recently-approved",
	])(
		"derives the %s subject from fresh authorization, ignoring requested tenant input",
		async (widget) => {
			const response = await GET(request(), {
				params: Promise.resolve({ widget }),
			});
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toContain("no-store");
			expect((await response.json()).result.data.summary.openApprovals).toBe(5);
			expect(boundary.auth).toHaveBeenCalledTimes(1);
			expect(boundary.read).toHaveBeenCalledWith(widget, subject);
		},
	);

	it.each([
		["other-user", "org-a"],
		["user-a", "other-org"],
	])("rejects a replaced scope before reading widget data", async (userId, organizationId) => {
		const response = await GET(request(userId, organizationId), {
			params: Promise.resolve({ widget: "quick-stats" }),
		});
		expect(response.status).toBe(409);
		expect(boundary.read).not.toHaveBeenCalled();
	});

	it.each([
		"upcoming-shifts",
		"covering-for",
		"whos-out-today",
		"upcoming-time-off",
		"birthday-reminders",
		"hydration",
		"vacation-balance",
		"presence-status",
		"managed-employees",
		"team-overview",
		"pending-approvals",
		"recently-approved",
	])(
		"denies signed-out or held identities and missing eligible employee access for %s",
		async (widget) => {
			boundary.auth.mockResolvedValueOnce(null);
			expect(
				(
					await GET(request(), {
						params: Promise.resolve({ widget }),
					})
				).status,
			).toBe(401);
			boundary.auth.mockResolvedValueOnce({
				user: { id: scope.userId },
				session: { activeOrganizationId: scope.organizationId },
				employee: null,
			});
			expect(
				(
					await GET(request(), {
						params: Promise.resolve({ widget }),
					})
				).status,
			).toBe(403);
			expect(boundary.read).not.toHaveBeenCalled();
		},
	);

	it("keeps enabled billing enforcement fresh and fails closed", async () => {
		boundary.billingEnabled = "true";
		boundary.billing.mockResolvedValue({
			canAccess: false,
			reason: "subscription_required",
		});
		expect(
			(
				await GET(request(), {
					params: Promise.resolve({ widget: "quick-stats" }),
				})
			).status,
		).toBe(402);
		expect(boundary.billing).toHaveBeenCalledWith(scope.organizationId);
		expect(boundary.read).not.toHaveBeenCalled();
	});

	it.each([
		"upcoming-shifts",
		"covering-for",
		"whos-out-today",
		"upcoming-time-off",
		"birthday-reminders",
		"hydration",
		"vacation-balance",
		"presence-status",
		"managed-employees",
		"team-overview",
		"pending-approvals",
		"recently-approved",
	])("does not queue an independent GET behind pending %s", async (widget) => {
		let finish: () => void = () => {};
		const pending = new Promise<void>((resolve) => {
			finish = resolve;
		});
		boundary.read.mockImplementation(async (id: string) => {
			if (id === widget) await pending;
			return { scope, updatedAt: 1234, result: { success: true, data: null } };
		});
		const manager = GET(request(), {
			params: Promise.resolve({ widget }),
		});
		try {
			const quick = await Promise.race([
				GET(request(), { params: Promise.resolve({ widget: "quick-stats" }) }),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("Independent GET was queued")), 500),
				),
			]);
			expect(quick.status).toBe(200);
			expect(boundary.auth).toHaveBeenCalledTimes(2);
		} finally {
			finish();
			await manager;
		}
	});
});
