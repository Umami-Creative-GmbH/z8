import { describe, expect, it, vi } from "vitest";
import { createApprovalInboxActorContext } from "@/lib/approvals/inbox/current-actor";

describe("createApprovalInboxActorContext", () => {
	it("marks manage-Approval users as org-wide approval viewers", async () => {
		const loadEligibleApprovalScopes = vi.fn(async () => [
			{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1"] },
		]);

		const context = await createApprovalInboxActorContext({
			session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
			ability: { cannot: vi.fn((action: string) => action !== "manage") },
			findCurrentEmployee: vi.fn(async () => ({ id: "employee-1", organizationId: "org-1" })),
			loadEligibleApprovalScopes,
		});

		expect(context.includeAllApprovers).toBe(true);
		expect(context.eligibleApprovalScopes).toEqual([]);
		expect(loadEligibleApprovalScopes).not.toHaveBeenCalled();
	});

	it("loads eligible manager scopes for approval users without manage permission", async () => {
		const context = await createApprovalInboxActorContext({
			session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
			ability: { cannot: vi.fn((action: string) => action === "manage") },
			findCurrentEmployee: vi.fn(async () => ({ id: "employee-1", organizationId: "org-1" })),
			loadEligibleApprovalScopes: vi.fn(async () => [{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1"] }]),
		});

		expect(context.includeAllApprovers).toBe(false);
		expect(context.eligibleApprovalScopes).toEqual([
			{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1"] },
		]);
	});

	it("rejects users without approve or manage permission", async () => {
		await expect(
			createApprovalInboxActorContext({
				session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
				ability: { cannot: vi.fn(() => true) },
				findCurrentEmployee: vi.fn(async () => ({ id: "employee-1", organizationId: "org-1" })),
				loadEligibleApprovalScopes: vi.fn(async () => []),
			}),
		).rejects.toThrow("Forbidden");
	});

	it("rejects null sessions as unauthorized", async () => {
		await expect(
			createApprovalInboxActorContext({
				session: null,
				ability: { cannot: vi.fn(() => false) },
				findCurrentEmployee: vi.fn(async () => ({ id: "employee-1", organizationId: "org-1" })),
				loadEligibleApprovalScopes: vi.fn(async () => []),
			}),
		).rejects.toThrow("Unauthorized");
	});

	it("rejects sessions without an active organization", async () => {
		await expect(
			createApprovalInboxActorContext({
				session: { user: { id: "user-1" }, session: { activeOrganizationId: null } },
				ability: { cannot: vi.fn(() => false) },
				findCurrentEmployee: vi.fn(async () => ({ id: "employee-1", organizationId: "org-1" })),
				loadEligibleApprovalScopes: vi.fn(async () => []),
			}),
		).rejects.toThrow("No active organization");
	});

	it("rejects null abilities as forbidden", async () => {
		await expect(
			createApprovalInboxActorContext({
				session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
				ability: null,
				findCurrentEmployee: vi.fn(async () => ({ id: "employee-1", organizationId: "org-1" })),
				loadEligibleApprovalScopes: vi.fn(async () => []),
			}),
		).rejects.toThrow("Forbidden");
	});

	it("rejects missing employees", async () => {
		await expect(
			createApprovalInboxActorContext({
				session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
				ability: { cannot: vi.fn(() => false) },
				findCurrentEmployee: vi.fn(async () => null),
				loadEligibleApprovalScopes: vi.fn(async () => []),
			}),
		).rejects.toThrow("Employee not found");
	});

	it("rejects employees from a different organization", async () => {
		await expect(
			createApprovalInboxActorContext({
				session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
				ability: { cannot: vi.fn(() => false) },
				findCurrentEmployee: vi.fn(async () => ({ id: "employee-1", organizationId: "org-2" })),
				loadEligibleApprovalScopes: vi.fn(async () => []),
			}),
		).rejects.toThrow("Employee organization mismatch");
	});
});
