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
		organization: vi.fn(),
	},
	runGoLiveChecks: vi.fn(),
	loadGoLiveGroupSettings: vi.fn(),
	loadFirstWorkflowEvidence: vi.fn(),
	computeConfirmationFingerprint: vi.fn(),
	confirm: vi.fn(),
	unconfirm: vi.fn(),
}));

vi.mock("@/lib/implementation-checklist/confirmation/fingerprint", () => ({
	computeConfirmationFingerprint: mocks.computeConfirmationFingerprint,
}));

vi.mock("@/lib/implementation-checklist/confirmation/store", () => ({
	confirmImplementationChecklistItem: mocks.confirm,
	unconfirmImplementationChecklistItem: mocks.unconfirm,
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/env", () => ({ env: { BILLING_ENABLED: "false" } }));

vi.mock("@/lib/implementation-checklist/go-live/run", () => ({
	goLiveAsOf: (instant: unknown, timezone: string) => ({ instant, timezone, today: null }),
	runGoLiveChecks: mocks.runGoLiveChecks,
	unavailableGoLiveRun: () => ({
		results: [
			{
				outcome: "unavailable",
				checkId: "work-policy",
				itemId: "work-policies",
				severity: "mandatory",
				checkedMemberCount: 0,
			},
		],
		memberCount: null,
		group: null,
	}),
}));

vi.mock("@/lib/implementation-checklist/go-live/group-settings", () => ({
	loadGoLiveGroupSettings: mocks.loadGoLiveGroupSettings,
}));

vi.mock("@/lib/implementation-checklist/go-live/first-workflows-evidence", () => ({
	loadFirstWorkflowEvidence: mocks.loadFirstWorkflowEvidence,
}));

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
			organization: { findFirst: mocks.findFirst.organization },
		},
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

const passingWorkPolicyCheck = {
	outcome: "passed",
	configured: true,
	failures: [],
	warnings: [],
	notes: [],
	checkId: "work-policy",
	itemId: "work-policies",
	severity: "mandatory",
	checkedMemberCount: 3,
};

const goLiveGroupSettings = {
	teams: [{ id: "team-1", name: "Warehouse" }],
	chosenTeamIds: ["team-1"],
	exclusions: [],
};

const goLiveGroup = {
	members: [
		{ kind: "employee", employeeId: "employee-1", primaryTeamId: null, displayName: "Ada" },
	],
	teamNames: new Map(),
};

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

		mocks.findFirst.organization.mockResolvedValue({
			id: "org-active",
			timezone: "Europe/Berlin",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			worksCouncilEnabled: false,
			billableTimeEnabled: false,
			personnelFilesEnabled: false,
			deletedAt: null,
		});
		mocks.loadGoLiveGroupSettings.mockReset();
		mocks.loadGoLiveGroupSettings.mockResolvedValue(goLiveGroupSettings);
		mocks.runGoLiveChecks.mockReset();
		mocks.runGoLiveChecks.mockResolvedValue({
			results: [passingWorkPolicyCheck],
			memberCount: 3,
			group: goLiveGroup,
		});
		mocks.loadFirstWorkflowEvidence.mockReset();
		mocks.loadFirstWorkflowEvidence.mockResolvedValue({
			clockIn: { state: "not-yet" },
			decidedApproval: { state: "not-yet" },
			payrollExport: { state: "not-yet" },
		});

		mocks.computeConfirmationFingerprint.mockReset();
		mocks.confirm.mockReset();
		mocks.confirm.mockResolvedValue(undefined);
		mocks.unconfirm.mockReset();
		mocks.unconfirm.mockResolvedValue({ removed: true });
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
			status: "configured",
			completionSource: "automatic",
		});
		expect(result.data.items.find((item) => item.id === "organization-structure")).toMatchObject({
			status: "configured",
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

	it("detects holidays and employee import from org-scoped data", async () => {
		mocks.findFirst.holidayAssignment.mockResolvedValue({ id: "holiday-assignment-1" });
		mocks.findFirst.employee.mockResolvedValue({ id: "employee-1" });

		const result = await getImplementationChecklist();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(result.data.items.find((item) => item.id === "holidays")).toMatchObject({
			status: "configured",
			completionSource: "automatic",
		});
		expect(result.data.items.find((item) => item.id === "employee-import")).toMatchObject({
			status: "configured",
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
			status: "configured",
			completionSource: "automatic",
		});
		expect(result.data.items.find((item) => item.id === "notifications")).toMatchObject({
			status: "configured",
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
			status: "configured",
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
			status: "not-set-up",
			completionSource: null,
		});
	});

	it("runs the go-live checks for the active organization and reports readiness", async () => {
		const result = await getImplementationChecklist();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(mocks.runGoLiveChecks).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-active",
				asOf: expect.objectContaining({ timezone: "Europe/Berlin" }),
			}),
		);
		const { fixLink } = mocks.runGoLiveChecks.mock.calls[0]?.[0] ?? {};
		const label = { key: "k", fallback: "f" };
		expect(fixLink("/settings/work-policies?tab=work&view=assignments", label)).toEqual({
			href: "/settings/work-policies?tab=work&view=assignments",
			label,
		});
		expect(result.data.items.find((item) => item.id === "work-policies")).toMatchObject({
			status: "verified",
			goLive: { checkId: "work-policy", outcome: "passed" },
		});
		expect(result.data.goLive).toEqual({
			readiness: { status: "ready", warnings: [] },
			checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			timezone: "Europe/Berlin",
			memberCount: 3,
			group: goLiveGroupSettings,
		});
		expect(mocks.loadGoLiveGroupSettings).toHaveBeenCalledWith(
			expect.anything(),
			"org-active",
			expect.objectContaining({ timezone: "Europe/Berlin" }),
		);
		expect(mocks.findFirst.workPolicy).not.toHaveBeenCalled();
		expect(mocks.findFirst.workPolicyAssignment).not.toHaveBeenCalled();
	});

	it("reports go-live readiness unavailable, never ready, when the organization lookup fails", async () => {
		mocks.findFirst.organization.mockRejectedValue(new Error("database unavailable"));

		const result = await getImplementationChecklist();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(mocks.runGoLiveChecks).not.toHaveBeenCalled();
		expect(result.data.goLive.readiness).toEqual({ status: "unavailable" });
		expect(result.data.items.find((item) => item.id === "work-policies")?.status).toBe(
			"unavailable",
		);
	});

	it("leaves the group settings out, but keeps the checks, when they can't be loaded", async () => {
		mocks.loadGoLiveGroupSettings.mockRejectedValue(new Error("database unavailable"));

		const result = await getImplementationChecklist();

		if (!result.success) throw new Error(result.error);
		expect(result.data.goLive.group).toBeNull();
		expect(result.data.goLive.readiness).toEqual({ status: "ready", warnings: [] });
	});

	it("never runs go-live checks for a viewer without org-admin settings access", async () => {
		mocks.requireAccess.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(getImplementationChecklist()).rejects.toThrow("NEXT_REDIRECT");
		expect(mocks.runGoLiveChecks).not.toHaveBeenCalled();
		expect(mocks.findFirst.organization).not.toHaveBeenCalled();
		expect(mocks.loadFirstWorkflowEvidence).not.toHaveBeenCalled();
	});

	it("shows first-workflow evidence for the go-live group without affecting readiness", async () => {
		const clockIn = {
			state: "seen",
			at: "2026-06-02T07:30:00Z",
			actor: { employeeId: "employee-1", displayName: "Ada", former: false },
		};
		mocks.loadFirstWorkflowEvidence.mockResolvedValue({
			clockIn,
			decidedApproval: { state: "not-yet" },
			payrollExport: { state: "unavailable" },
		});

		const result = await getImplementationChecklist();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(mocks.loadFirstWorkflowEvidence).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-active",
				group: goLiveGroup,
				asOf: expect.objectContaining({ timezone: "Europe/Berlin" }),
			}),
		);
		expect(result.data.items.find((item) => item.id === "first-workflows")).toMatchObject({
			status: "unavailable",
			firstWorkflows: { clockIn, payrollExport: { state: "unavailable" } },
		});
		expect(result.data.goLive.readiness).toEqual({ status: "ready", warnings: [] });
	});

	it("shows first-workflow evidence as unavailable when the go-live group could not be resolved", async () => {
		mocks.findFirst.organization.mockRejectedValue(new Error("database unavailable"));

		const result = await getImplementationChecklist();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(mocks.loadFirstWorkflowEvidence).not.toHaveBeenCalled();
		expect(result.data.items.find((item) => item.id === "first-workflows")).toMatchObject({
			status: "unavailable",
			firstWorkflows: {
				clockIn: { state: "unavailable" },
				decidedApproval: { state: "unavailable" },
				payrollExport: { state: "unavailable" },
			},
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
		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.unconfirm).not.toHaveBeenCalled();
	});

	it("marks a manual item complete with active organization and completing user", async () => {
		const result = await markImplementationChecklistItemComplete("approval-rules");

		expect(result).toEqual({ success: true });
		expect(mocks.confirm).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-active",
			itemId: "approval-rules",
			actorUserId: "user-admin",
			confirmedAt: expect.any(Date),
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith(checklistPath);
	});

	it("shows a confirmation whose settings changed as stale and stops counting it", async () => {
		mocks.findFirst.implementationChecklistManualState.mockImplementation(({ where }) =>
			Promise.resolve(
				JSON.stringify(where).includes("organization-structure")
					? {
							itemId: "organization-structure",
							completedAt: new Date("2026-10-30T09:00:00Z"),
							configurationFingerprint: "confirmed-fingerprint",
						}
					: undefined,
			),
		);
		mocks.computeConfirmationFingerprint.mockResolvedValue("changed-fingerprint");

		const result = await getImplementationChecklist();

		if (!result.success) throw new Error(result.error);
		expect(mocks.computeConfirmationFingerprint).toHaveBeenCalledWith(
			expect.anything(),
			"org-active",
			"organization-structure",
		);
		expect(result.data.items.find((item) => item.id === "organization-structure")).toMatchObject({
			status: "not-set-up",
			countsTowardProgress: false,
			manualConfirmation: { confirmedAt: "2026-10-30T09:00:00.000Z", freshness: "stale" },
		});
	});

	it("fails closed when a confirmation's fingerprint can't be worked out", async () => {
		mocks.findFirst.implementationChecklistManualState.mockImplementation(({ where }) =>
			Promise.resolve(
				JSON.stringify(where).includes("payroll-readiness")
					? {
							itemId: "payroll-readiness",
							completedAt: new Date("2026-10-30T09:00:00Z"),
							configurationFingerprint: "confirmed-fingerprint",
						}
					: undefined,
			),
		);
		mocks.computeConfirmationFingerprint.mockRejectedValue(new Error("database unavailable"));

		const result = await getImplementationChecklist();

		if (!result.success) throw new Error(result.error);
		expect(result.data.items.find((item) => item.id === "payroll-readiness")).toMatchObject({
			status: "not-set-up",
			manualConfirmation: { freshness: "unchecked" },
		});
	});

	it("returns a failure result without revalidating when marking complete fails", async () => {
		mocks.confirm.mockRejectedValue(new Error("duplicate key details"));

		const result = await markImplementationChecklistItemComplete("approval-rules");

		expect(result).toEqual({
			success: false,
			error: "Failed to update checklist item.",
		});
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("marks a manual item incomplete for the active organization only", async () => {
		const result = await markImplementationChecklistItemIncomplete("payroll-readiness");

		expect(result).toEqual({ success: true });
		expect(mocks.unconfirm).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-active",
			itemId: "payroll-readiness",
			actorUserId: "user-admin",
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith(checklistPath);
	});

	it("returns a failure result without revalidating when marking incomplete fails", async () => {
		mocks.unconfirm.mockRejectedValue(new Error("delete failed"));

		const result = await markImplementationChecklistItemIncomplete("payroll-readiness");

		expect(result).toEqual({
			success: false,
			error: "Failed to update checklist item.",
		});
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});
});
