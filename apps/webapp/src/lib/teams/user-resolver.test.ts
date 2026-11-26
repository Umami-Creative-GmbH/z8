import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findMapping: vi.fn(),
	findUserByEmail: vi.fn(),
	findEmployee: vi.fn(),
	insertValues: vi.fn(),
	updateWhere: vi.fn(),
	resolveCommandActorEmployee: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			teamsUserMapping: { findFirst: mocks.findMapping },
			user: { findFirst: mocks.findUserByEmail },
			employee: { findFirst: mocks.findEmployee },
		},
		insert: () => ({ values: mocks.insertValues }),
		update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
	},
}));

vi.mock("@/lib/integrations/resolve-command-actor", () => ({
	resolveCommandActorEmployee: mocks.resolveCommandActorEmployee,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

import { resolveTeamsUser } from "./user-resolver";

describe("Teams user resolver identity provenance (#2049)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("never establishes member identity via email matching or cross-organization email lookup", async () => {
		mocks.findMapping.mockResolvedValueOnce(null);
		mocks.findUserByEmail.mockResolvedValueOnce({
			id: "user-other-org",
			email: "alice@example.com",
		});
		mocks.findEmployee.mockResolvedValueOnce({
			id: "emp-other-org",
			organizationId: "org-other",
		});

		const result = await resolveTeamsUser(
			"aad-obj-unlinked",
			"alice@example.com",
			"tenant-org-a",
			"Alice",
		);

		expect(result).toEqual({
			status: "not_linked",
			teamsUserId: "aad-obj-unlinked",
			teamsEmail: null,
		});
		expect(mocks.findUserByEmail).not.toHaveBeenCalled();
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("resolves an existing verified same-tenant mapping when employee is active and refuses cross-org mismatch", async () => {
		mocks.findMapping.mockResolvedValueOnce({
			id: "map-1",
			userId: "user-a",
			organizationId: "org-a",
			teamsUserId: "aad-obj-1",
			teamsEmail: "alice@org-a.test",
			teamsTenantId: "tenant-org-a",
		});
		mocks.resolveCommandActorEmployee.mockResolvedValueOnce({ id: "emp-a" });

		const found = await resolveTeamsUser("aad-obj-1", null, "tenant-org-a", "Alice", "org-a");
		expect(found).toEqual({
			status: "found",
			user: {
				userId: "user-a",
				employeeId: "emp-a",
				organizationId: "org-a",
				teamsUserId: "aad-obj-1",
				teamsEmail: "alice@org-a.test",
				teamsTenantId: "tenant-org-a",
				isNewMapping: false,
			},
		});

		// Cross-organization expectedOrganizationId mismatch must not resolve
		mocks.findMapping.mockResolvedValueOnce({
			id: "map-1",
			userId: "user-a",
			organizationId: "org-a",
			teamsUserId: "aad-obj-1",
			teamsEmail: "alice@org-a.test",
			teamsTenantId: "tenant-org-a",
		});
		const crossOrg = await resolveTeamsUser("aad-obj-1", null, "tenant-org-a", "Alice", "org-b");
		expect(crossOrg).toEqual({
			status: "not_linked",
			teamsUserId: "aad-obj-1",
			teamsEmail: null,
		});
	});
});
