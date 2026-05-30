import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	revalidatePath: vi.fn(),
	requireAccess: vi.fn(),
	findFirst: {
		holiday: vi.fn(),
		holidayAssignment: vi.fn(),
		holidayPresetAssignment: vi.fn(),
		workPolicy: vi.fn(),
		workPolicyAssignment: vi.fn(),
		slackWorkspaceConfig: vi.fn(),
		discordBotConfig: vi.fn(),
		teamsTenantConfig: vi.fn(),
		telegramBotConfig: vi.fn(),
		webhookEndpoint: vi.fn(),
		notificationPreference: vi.fn(),
		employee: vi.fn(),
		implementationChecklistManualState: vi.fn(),
	},
	insert: vi.fn(),
	values: vi.fn(),
	onConflictDoUpdate: vi.fn(),
	delete: vi.fn(),
	where: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("server-only", () => ({}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	ne: vi.fn((left: unknown, right: unknown) => ({ ne: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			holiday: { findFirst: mocks.findFirst.holiday },
			holidayAssignment: { findFirst: mocks.findFirst.holidayAssignment },
			holidayPresetAssignment: { findFirst: mocks.findFirst.holidayPresetAssignment },
			workPolicy: { findFirst: mocks.findFirst.workPolicy },
			workPolicyAssignment: { findFirst: mocks.findFirst.workPolicyAssignment },
			slackWorkspaceConfig: { findFirst: mocks.findFirst.slackWorkspaceConfig },
			discordBotConfig: { findFirst: mocks.findFirst.discordBotConfig },
			teamsTenantConfig: { findFirst: mocks.findFirst.teamsTenantConfig },
			telegramBotConfig: { findFirst: mocks.findFirst.telegramBotConfig },
			webhookEndpoint: { findFirst: mocks.findFirst.webhookEndpoint },
			notificationPreference: { findFirst: mocks.findFirst.notificationPreference },
			employee: { findFirst: mocks.findFirst.employee },
			implementationChecklistManualState: {
				findFirst: mocks.findFirst.implementationChecklistManualState,
			},
		},
		insert: mocks.insert,
		delete: mocks.delete,
	},
}));

vi.mock("@/db/schema", () => ({
	discordBotConfig: {
		organizationId: "discord.organizationId",
		setupStatus: "discord.setupStatus",
	},
	employee: {
		organizationId: "employee.organizationId",
		isActive: "employee.isActive",
		userId: "employee.userId",
	},
	holiday: { organizationId: "holiday.organizationId", isActive: "holiday.isActive" },
	holidayAssignment: {
		organizationId: "holidayAssignment.organizationId",
		isActive: "holidayAssignment.isActive",
	},
	holidayPresetAssignment: {
		organizationId: "holidayPresetAssignment.organizationId",
		isActive: "holidayPresetAssignment.isActive",
	},
	implementationChecklistManualState: {
		organizationId: "manualState.organizationId",
		itemId: "manualState.itemId",
		status: "manualState.status",
		completedAt: "manualState.completedAt",
		completedByUserId: "manualState.completedByUserId",
	},
	notificationPreference: {
		organizationId: "notificationPreference.organizationId",
		enabled: "notificationPreference.enabled",
	},
	slackWorkspaceConfig: {
		organizationId: "slack.organizationId",
		setupStatus: "slack.setupStatus",
	},
	teamsTenantConfig: { organizationId: "teams.organizationId", setupStatus: "teams.setupStatus" },
	telegramBotConfig: {
		organizationId: "telegram.organizationId",
		setupStatus: "telegram.setupStatus",
	},
	webhookEndpoint: { organizationId: "webhook.organizationId", isActive: "webhook.isActive" },
	workPolicy: { organizationId: "workPolicy.organizationId", isActive: "workPolicy.isActive" },
	workPolicyAssignment: {
		organizationId: "workPolicyAssignment.organizationId",
		isActive: "workPolicyAssignment.isActive",
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.requireAccess,
}));

import {
	getImplementationChecklist,
	markImplementationChecklistItemComplete,
	markImplementationChecklistItemIncomplete,
} from "./actions";
import { loadImplementationChecklistForContext } from "./queries";

const checklistPath = "/settings/implementation-checklist";

describe("implementation checklist actions", () => {
	beforeEach(() => {
		mocks.revalidatePath.mockReset();
		mocks.requireAccess.mockReset();
		mocks.requireAccess.mockResolvedValue({
			authContext: { user: { id: "user-admin" } },
			organizationId: "org-active",
		});

		for (const findFirst of Object.values(mocks.findFirst)) {
			findFirst.mockReset();
			findFirst.mockResolvedValue(undefined);
		}

		mocks.insert.mockReset();
		mocks.values.mockReset();
		mocks.onConflictDoUpdate.mockReset();
		mocks.delete.mockReset();
		mocks.where.mockReset();

		mocks.onConflictDoUpdate.mockResolvedValue(undefined);
		mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.onConflictDoUpdate });
		mocks.insert.mockReturnValue({ values: mocks.values });
		mocks.where.mockResolvedValue(undefined);
		mocks.delete.mockReturnValue({ where: mocks.where });
	});

	it("loads statuses scoped to the active organization", async () => {
		mocks.findFirst.holiday.mockResolvedValue({ id: "holiday-1" });
		mocks.findFirst.implementationChecklistManualState.mockImplementation(({ where }) => {
			if (JSON.stringify(where).includes("organization-structure")) {
				return Promise.resolve({ itemId: "organization-structure" });
			}

			return Promise.resolve(undefined);
		});

		const result = await getImplementationChecklist();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(result.data.items.find((item) => item.id === "holidays")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(result.data.items.find((item) => item.id === "organization-structure")).toMatchObject({
			status: "complete",
			completionSource: "manual",
		});
		expect(mocks.findFirst.holiday).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					and: expect.arrayContaining([{ eq: ["holiday.organizationId", "org-active"] }]),
				}),
			}),
		);
		expect(mocks.findFirst.implementationChecklistManualState).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					and: expect.arrayContaining([
						{ eq: ["manualState.organizationId", "org-active"] },
						{ eq: ["manualState.status", "complete"] },
					]),
				}),
			}),
		);
	});

	it("loads statuses from an existing org-admin context without resolving access again", async () => {
		mocks.findFirst.employee.mockResolvedValue({ id: "employee-1" });

		const result = await loadImplementationChecklistForContext({
			authContext: {
				user: {
					id: "user-from-page",
					email: "admin@example.com",
					name: "Admin User",
					canCreateOrganizations: true,
					canUseWebapp: true,
					canUseDesktop: true,
					canUseMobile: true,
				},
				session: { activeOrganizationId: "org-from-page" },
				employee: null,
			},
			organizationId: "org-from-page",
		});

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(mocks.requireAccess).not.toHaveBeenCalled();
		expect(mocks.findFirst.employee).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					and: expect.arrayContaining([
						{ eq: ["employee.organizationId", "org-from-page"] },
						{ ne: ["employee.userId", "user-from-page"] },
					]),
				}),
			}),
		);
	});

	it("automatically completes holidays, work policies, and employee import from org-scoped data", async () => {
		mocks.findFirst.holidayAssignment.mockResolvedValue({ id: "holiday-assignment-1" });
		mocks.findFirst.workPolicyAssignment.mockResolvedValue({ id: "policy-assignment-1" });
		mocks.findFirst.employee.mockResolvedValue({ id: "employee-1" });

		const result = await getImplementationChecklist();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(result.data.items.find((item) => item.id === "holidays")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(result.data.items.find((item) => item.id === "work-policies")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(result.data.items.find((item) => item.id === "employee-import")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(mocks.findFirst.employee).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					and: expect.arrayContaining([
						{ eq: ["employee.organizationId", "org-active"] },
						{ eq: ["employee.isActive", true] },
						{ ne: ["employee.userId", "user-admin"] },
					]),
				}),
			}),
		);
	});

	it("completes integrations from active channels and notifications from preferences or active channels", async () => {
		mocks.findFirst.discordBotConfig.mockResolvedValue({ id: "discord-1" });

		const result = await getImplementationChecklist();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(result.data.items.find((item) => item.id === "integrations")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(result.data.items.find((item) => item.id === "notifications")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(mocks.findFirst.discordBotConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					and: expect.arrayContaining([
						{ eq: ["discord.organizationId", "org-active"] },
						{ eq: ["discord.setupStatus", "active"] },
					]),
				}),
			}),
		);
	});

	it("only completes notifications from enabled notification preferences", async () => {
		mocks.findFirst.notificationPreference.mockResolvedValue({ id: "preference-1" });

		const result = await getImplementationChecklist();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(result.data.items.find((item) => item.id === "notifications")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(mocks.findFirst.notificationPreference).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					and: expect.arrayContaining([
						{ eq: ["notificationPreference.organizationId", "org-active"] },
						{ eq: ["notificationPreference.enabled", true] },
					]),
				}),
			}),
		);
	});

	it("fails closed for a detector when its query throws", async () => {
		mocks.findFirst.holiday.mockRejectedValue(new Error("database unavailable"));

		const result = await getImplementationChecklist();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(result.data.items.find((item) => item.id === "holidays")).toMatchObject({
			status: "not-started",
			completionSource: null,
		});
	});

	it("requires access before rejecting invalid or non-manual item ids for manual mutations", async () => {
		expect(await markImplementationChecklistItemComplete("not-a-real-item")).toEqual({
			success: false,
			error: "Unknown implementation checklist item",
		});
		expect(await markImplementationChecklistItemComplete("holidays")).toEqual({
			success: false,
			error: "Implementation checklist item cannot be manually completed",
		});
		expect(await markImplementationChecklistItemIncomplete("employee-import")).toEqual({
			success: false,
			error: "Implementation checklist item cannot be manually completed",
		});
		expect(mocks.requireAccess).toHaveBeenCalledTimes(3);
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.delete).not.toHaveBeenCalled();
	});

	it("marks a manual item complete with active organization and completing user", async () => {
		const result = await markImplementationChecklistItemComplete("approval-rules");

		expect(result).toEqual({ success: true });
		expect(mocks.values).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-active",
				itemId: "approval-rules",
				status: "complete",
				completedAt: expect.any(Date),
				completedByUserId: "user-admin",
			}),
		);
		expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				target: ["manualState.organizationId", "manualState.itemId"],
				set: expect.objectContaining({
					status: "complete",
					completedAt: expect.any(Date),
					completedByUserId: "user-admin",
				}),
			}),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith(checklistPath);
	});

	it("returns a failure result without revalidating when marking complete fails", async () => {
		mocks.onConflictDoUpdate.mockRejectedValue(new Error("duplicate key details"));

		const result = await markImplementationChecklistItemComplete("approval-rules");

		expect(result).toEqual({
			success: false,
			error: "Failed to update checklist item.",
		});
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("marks a manual item incomplete by deleting only active organization state", async () => {
		const result = await markImplementationChecklistItemIncomplete("payroll-readiness");

		expect(result).toEqual({ success: true });
		expect(mocks.where).toHaveBeenCalledWith({
			and: [
				{ eq: ["manualState.organizationId", "org-active"] },
				{ eq: ["manualState.itemId", "payroll-readiness"] },
			],
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith(checklistPath);
	});

	it("returns a failure result without revalidating when marking incomplete fails", async () => {
		mocks.where.mockRejectedValue(new Error("delete failed"));

		const result = await markImplementationChecklistItemIncomplete("payroll-readiness");

		expect(result).toEqual({
			success: false,
			error: "Failed to update checklist item.",
		});
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});
});
