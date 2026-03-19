import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	accessContext: {
		authContext: {
			user: { id: "user-1" },
		},
		accessTier: "manager" as const,
		organizationId: "org-1",
		canAccessShiftTemplates: true,
		manageableShiftTemplateSubareaIds: new Set(["subarea-team-1"]),
	},
	templateTarget: { id: "template-1", organizationId: "org-1", subareaId: "subarea-team-1" as string | null },
	runSchedulingActionResult: { success: true as const, data: { id: "template-1" } },
	createTemplate: vi.fn(),
	updateTemplate: vi.fn(),
	deleteTemplate: vi.fn(),
	getTemplates: vi.fn(async () => []),
}));

vi.mock("effect", async () => {
	const actual = await vi.importActual<typeof import("effect")>("effect");
	return actual;
});

vi.mock("@/lib/settings-scheduling-access", () => ({
	canManageScopedSchedulingSubarea: vi.fn(
		(_tier: string, manageableSubareaIds: Set<string> | null, subareaId: string | null | undefined) =>
			Boolean(subareaId && manageableSubareaIds?.has(subareaId)),
	),
	filterItemsToManageableSubareas: vi.fn((items: any[], manageableSubareaIds: Set<string> | null) =>
		manageableSubareaIds ? items.filter((item) => manageableSubareaIds.has(item.subareaId)) : items,
	),
	getSchedulingSettingsAccessContext: vi.fn(async () => mockState.accessContext),
	getShiftTemplateScopeTarget: vi.fn(async () => mockState.templateTarget),
}));

vi.mock("@/app/[locale]/(app)/scheduling/actions/shared", () => ({
	runSchedulingAction: vi.fn(async () => mockState.runSchedulingActionResult),
}));

vi.mock("@/lib/effect/services/shift.service", async () => {
	const { Context } = await import("effect");
	const ShiftService = Context.GenericTag<any>("ShiftService");
	return { ShiftService };
});

const { createShiftTemplate, deleteShiftTemplate, updateShiftTemplate } = await import("./template-actions");

describe("shift template manager scope", () => {
	beforeEach(() => {
		mockState.accessContext = {
			authContext: { user: { id: "user-1" } },
			accessTier: "manager",
			organizationId: "org-1",
			canAccessShiftTemplates: true,
			manageableShiftTemplateSubareaIds: new Set(["subarea-team-1"]),
		};
		mockState.templateTarget = {
			id: "template-1",
			organizationId: "org-1",
			subareaId: "subarea-team-1",
		};
	});

	it("rejects manager template creation outside own-team scope", async () => {
		const result = await createShiftTemplate({
			name: "Outside Team",
			startTime: "09:00",
			endTime: "17:00",
			subareaId: "subarea-team-2",
		});

		expect(result).toEqual({ success: false, error: "Unauthorized" });
	});

	it("rejects manager template updates when the target leaves own-team scope", async () => {
		const result = await updateShiftTemplate("template-1", { subareaId: "subarea-team-2" });

		expect(result).toEqual({ success: false, error: "Unauthorized" });
	});

	it("rejects manager template deletion for targets outside the active organization", async () => {
		mockState.templateTarget = {
			id: "template-1",
			organizationId: "org-2",
			subareaId: "subarea-team-1",
		};

		const result = await deleteShiftTemplate("template-1");

		expect(result).toEqual({ success: false, error: "Unauthorized" });
	});
});
