import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findMember: vi.fn(),
	findOrganization: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: mocks.findMember },
			organization: { findFirst: mocks.findOrganization },
		},
	},
}));
vi.mock("@/db/auth-schema", () => ({
	member: {
		organizationId: "member.organizationId",
		status: "member.status",
		userId: "member.userId",
	},
	organization: { id: "organization.id" },
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions }),
	eq: (column: unknown, value: unknown) => ({ column, value }),
}));

const { getOrganizationSettings } = await import("./organization-settings");

describe("getOrganizationSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findOrganization.mockResolvedValue({
			id: "org-1",
			shiftsEnabled: null,
			projectsEnabled: true,
			surchargesEnabled: null,
			demoDataEnabled: null,
			worksCouncilEnabled: true,
			timezone: null,
			deletedAt: null,
		});
	});

	it("does not expose settings without approved membership", async () => {
		mocks.findMember.mockResolvedValue(null);

		expect(await getOrganizationSettings("org-1", "user-1")).toBeNull();
		expect(mocks.findOrganization).not.toHaveBeenCalled();
	});

	it("normalizes settings for an approved member", async () => {
		mocks.findMember.mockResolvedValue({ id: "member-1" });

		expect(await getOrganizationSettings("org-1", "user-1")).toEqual({
			organizationId: "org-1",
			shiftsEnabled: false,
			projectsEnabled: true,
			surchargesEnabled: false,
			demoDataEnabled: true,
			worksCouncilEnabled: true,
			timezone: "UTC",
			deletedAt: null,
		});
	});
});
