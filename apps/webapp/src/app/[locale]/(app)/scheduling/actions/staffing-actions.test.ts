import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	role: "manager" as "employee" | "manager" | "admin",
	loadSelectableEmployeePage: vi.fn(),
	loadOrganizationTimezone: vi.fn(),
	suggestForShift: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	return runtimeModuleOver(
		Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: { scoped: true } as never,
				query: (_name, query) => Effect.promise(query),
			}),
		),
	);
});

vi.mock("./shared", async (importOriginal) => {
	const { Effect } = await import("effect");
	const { AuthorizationError } = await import("@/lib/effect/errors");
	const original = await importOriginal<typeof import("./shared")>();
	return {
		...original,
		requireManagerEmployee: vi.fn((input: { message: string }) =>
			mockState.role === "employee"
				? Effect.fail(new AuthorizationError({ message: input.message, userId: "user-1" }))
				: Effect.succeed({
						currentEmployee: { id: "planner-1", organizationId: "org-1", role: mockState.role },
						session: { user: { id: "user-1" } },
					}),
		),
	};
});

vi.mock("@/app/[locale]/(app)/settings/employees/selectable-employees", () => ({
	loadSelectableEmployeePage: mockState.loadSelectableEmployeePage,
}));

vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: mockState.loadOrganizationTimezone,
}));

vi.mock("@/lib/effect/services/staffing-suggestion.service", async () => {
	const { Context, Effect, Layer } = await import("effect");
	const StaffingSuggestionService = Context.Service<any>("StaffingSuggestionService");
	return {
		StaffingSuggestionService,
		StaffingSuggestionServiceLive: Layer.succeed(StaffingSuggestionService, {
			suggestForShift: (input: unknown) => Effect.sync(() => mockState.suggestForShift(input)),
		}),
	};
});

const { Effect } = await import("effect");
const { suggestStaffingForShift } = await import("./staffing-actions");

const shiftInput = {
	subareaId: "subarea-1",
	templateId: null,
	date: "2026-10-09",
	startTime: "08:00",
	endTime: "16:00",
	shiftId: "shift-1",
};

describe("suggestStaffingForShift", () => {
	beforeEach(() => {
		mockState.role = "manager";
		mockState.loadSelectableEmployeePage.mockReset().mockReturnValue(
			Effect.succeed({
				employees: [
					{
						id: "employee-1",
						isActive: true,
						user: { firstName: "Anna", lastName: "Berg", name: "Anna", email: "a@example.com" },
					},
					{
						id: "employee-2",
						isActive: false,
						user: { firstName: null, lastName: null, name: "", email: "" },
					},
				],
				total: 2,
				hasMore: false,
			}),
		);
		mockState.loadOrganizationTimezone.mockReset().mockResolvedValue("Europe/Berlin");
		mockState.suggestForShift.mockReset().mockReturnValue([{ employeeId: "employee-1" }]);
	});

	it("suggests among the picker's employees in the planner's organization and zone", async () => {
		await expect(suggestStaffingForShift(shiftInput)).resolves.toEqual({
			success: true,
			data: [{ employeeId: "employee-1" }],
		});

		expect(mockState.loadSelectableEmployeePage).toHaveBeenCalledWith({ limit: 1000 });
		expect(mockState.loadOrganizationTimezone).toHaveBeenCalledWith({ scoped: true }, "org-1");
		expect(mockState.suggestForShift).toHaveBeenCalledWith({
			organizationId: "org-1",
			timezone: "Europe/Berlin",
			candidates: [
				{ employeeId: "employee-1", displayName: "Anna Berg", isActive: true },
				{ employeeId: "employee-2", displayName: "employee-2", isActive: false },
			],
			shift: shiftInput,
		});
	});

	it("refuses non-planners before loading anything", async () => {
		mockState.role = "employee";

		const result = await suggestStaffingForShift(shiftInput);

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.loadSelectableEmployeePage).not.toHaveBeenCalled();
		expect(mockState.suggestForShift).not.toHaveBeenCalled();
	});
});
