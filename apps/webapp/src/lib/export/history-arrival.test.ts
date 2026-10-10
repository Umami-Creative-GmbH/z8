import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	findMember: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: { query: { member: { findFirst: state.findMember } } },
}));

const { resolveExportHistoryArrival } = await import("./history-arrival");

describe("resolveExportHistoryArrival", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.findMember.mockResolvedValue({ role: "admin", organization: { name: "Acme" } });
	});

	it("leaves the active organization's history to the settings guard", async () => {
		await expect(
			resolveExportHistoryArrival({
				userId: "user-1",
				activeOrganizationId: "org-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual({ status: "active" });
		expect(state.findMember).not.toHaveBeenCalled();
	});

	it.each(["admin", "owner", "member,admin"])(
		"asks a %s of the export's organization to switch to it",
		async (role) => {
			state.findMember.mockResolvedValue({ role, organization: { name: "Acme" } });

			await expect(
				resolveExportHistoryArrival({
					userId: "user-1",
					activeOrganizationId: "org-2",
					organizationId: "org-1",
				}),
			).resolves.toEqual({
				status: "switch_organization",
				organizationId: "org-1",
				organizationName: "Acme",
			});
		},
	);

	it("asks a viewer without an active organization to switch to it", async () => {
		await expect(
			resolveExportHistoryArrival({
				userId: "user-1",
				activeOrganizationId: null,
				organizationId: "org-1",
			}),
		).resolves.toMatchObject({ status: "switch_organization" });
	});

	it("refuses a plain member of the export's organization", async () => {
		state.findMember.mockResolvedValue({ role: "member", organization: { name: "Acme" } });

		await expect(
			resolveExportHistoryArrival({
				userId: "user-1",
				activeOrganizationId: "org-2",
				organizationId: "org-1",
			}),
		).resolves.toEqual({ status: "unavailable" });
	});

	it("refuses a viewer without an approved membership in the export's organization", async () => {
		state.findMember.mockResolvedValue(undefined);

		await expect(
			resolveExportHistoryArrival({
				userId: "user-1",
				activeOrganizationId: "org-2",
				organizationId: "org-1",
			}),
		).resolves.toEqual({ status: "unavailable" });
	});
});
