import { createMongoAbility } from "@casl/ability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	requireActor: vi.fn(),
	getAbility: vi.fn(),
	ClockingAccessError: class extends Error {},
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async () => ({
	...(await vi.importActual("next/server")),
	connection: async () => {},
}));
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/auth-helpers", () => ({ getAbility: mocks.getAbility }));
vi.mock("@/lib/time-tracking/clocking-service", () => ({
	clockingService: { requireActor: mocks.requireActor },
	ClockingAccessError: mocks.ClockingAccessError,
}));
import { GET } from "./route";

describe("authenticated browser recovery context", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mocks.requireActor.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
		});
		mocks.getAbility.mockResolvedValue(createMongoAbility([]));
	});
	it("requires authentication and current approved organization access", async () => {
		mocks.getSession.mockResolvedValueOnce(null);
		expect((await GET()).status).toBe(401);
		expect(mocks.requireActor).not.toHaveBeenCalled();
		mocks.requireActor.mockRejectedValueOnce(new mocks.ClockingAccessError());
		expect((await GET()).status).toBe(403);
	});
	it.each([
		[{ organizationId: "org-1" }, true],
		[{ organizationId: "org-2" }, false],
		[{ organizationId: "org-1", employeeId: { $in: ["report-1"] } }, false],
	])(
		"only grants unattributed inspection with organization-wide management: %j",
		async (conditions, permitted) => {
			mocks.getAbility.mockResolvedValue(
				createMongoAbility([
					{ action: "manage", subject: "TimeEntry", conditions },
				]),
			);
			const response = await GET();
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(await response.json()).toEqual({
				userId: "user-1",
				organizationId: "org-1",
				canReviewLegacy: permitted,
			});
		},
	);
});
