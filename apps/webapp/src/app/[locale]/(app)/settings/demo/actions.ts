"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { employee } from "@/db/schema";
import { deleteNonAdminEmployeesData } from "@/lib/demo/delete-non-admin";
import {
	assignWorkCategoriesToPeriods,
	clearOrganizationTimeData,
	type DemoDataOptions,
	generateDemoAbsences,
	generateDemoChangePolicies,
	generateDemoData,
	generateDemoLocations,
	generateDemoManagerAssignments,
	generateDemoPendingAbsenceApprovals,
	generateDemoPendingTimeCorrectionApprovals,
	generateDemoProjects,
	generateDemoShifts,
	generateDemoShiftTemplates,
	generateDemoTeams,
	generateDemoTimeEntries,
	generateDemoVehicles,
	generateDemoWorkCategories,
} from "@/lib/demo/demo-data.service";
import { assignDemoVehicleUseToPeriods } from "@/lib/demo/demo-vehicle-use-generator";
import { generateDemoEmployees } from "@/lib/demo/employee-generator";
import { AuthorizationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { isDemoDataEnabledForOrganization } from "./demo-data-enabled";

const dateRangeTypeSchema = z.enum(["last30", "last60", "last90", "thisYear"]);
const countSchema = z.number().int().min(0).optional();

const generateDemoDataSchema = z.strictObject({
	dateRangeType: dateRangeTypeSchema,
	includeTimeEntries: z.boolean(),
	includeAbsences: z.boolean(),
	includeTeams: z.boolean(),
	teamCount: countSchema,
	includeProjects: z.boolean(),
	projectCount: countSchema,
	employeeIds: z.array(z.string()).optional(),
});

export type GenerateDemoDataInput = z.input<typeof generateDemoDataSchema>;

// Step-by-step generation actions for real progress tracking
const stepGenerationSchema = z.strictObject({
	dateRangeType: dateRangeTypeSchema,
	teamCount: countSchema,
	projectCount: countSchema,
	employeeIds: z.array(z.string()).optional(),
	locationCount: countSchema,
	subareasPerLocation: countSchema,
	workCategorySetCount: countSchema,
	workCategoryCount: countSchema,
	changePolicyCount: countSchema,
	shiftTemplateCount: countSchema,
	includePendingAbsenceApprovals: z.boolean().optional(),
	includePendingTimeCorrectionApprovals: z.boolean().optional(),
});

export type StepGenerationInput = z.input<typeof stepGenerationSchema>;
type StepInput = z.output<typeof stepGenerationSchema>;

const generateDemoEmployeesSchema = z.strictObject({
	count: z.number().int().min(0),
	includeManagers: z.boolean(),
});

export type GenerateDemoEmployeesInput = z.input<typeof generateDemoEmployeesSchema>;

/**
 * Helper to calculate date range from type
 */
function calculateDateRange(dateRangeType: StepInput["dateRangeType"]): {
	start: Date;
	end: Date;
} {
	const now = new Date();
	let startDate: Date;
	const endDate = new Date(now);

	switch (dateRangeType) {
		case "last30":
			startDate = new Date(now);
			startDate.setDate(startDate.getDate() - 30);
			break;
		case "last60":
			startDate = new Date(now);
			startDate.setDate(startDate.getDate() - 60);
			break;
		case "last90":
			startDate = new Date(now);
			startDate.setDate(startDate.getDate() - 90);
			break;
		case "thisYear":
			startDate = new Date(now.getFullYear(), 0, 1);
			break;
		default:
			startDate = new Date(now);
			startDate.setDate(startDate.getDate() - 30);
	}

	return { start: startDate, end: endDate };
}

/** Demo data tools stay off for an organization that turned them off. */
function demoDataFeatureGate(organizationId: string, userId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const enabled = yield* dbService.query("demoData.enabled", () =>
			isDemoDataEnabledForOrganization(organizationId, dbService.db),
		);
		if (!enabled) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Demo data is disabled for this organization",
					userId,
					resource: "demo_data",
					action: "use",
				}),
			);
		}
	});
}

/**
 * One step of the demo data wizard: an org-admin action on the session's
 * organization, behind the demo data feature gate.
 */
function demoStepAction<T>(
	name: string,
	options: (input: StepInput) => Partial<DemoDataOptions>,
	generate: (options: DemoDataOptions) => Promise<T>,
) {
	return organizationAction(
		{ name: `demoData.${name}`, requires: "orgAdmin", schema: stepGenerationSchema },
		({ actor, organizationId, input }) =>
			Effect.gen(function* () {
				yield* demoDataFeatureGate(organizationId, actor.userId);
				const stepOptions: DemoDataOptions = {
					organizationId,
					dateRange: calculateDateRange(input.dateRangeType),
					includeTimeEntries: false,
					includeAbsences: false,
					includeTeams: false,
					includeProjects: false,
					employeeIds: input.employeeIds,
					createdBy: actor.userId,
					...options(input),
				};
				return yield* Effect.promise(() => generate(stepOptions));
			}),
	);
}

/**
 * Generate demo data for an organization
 */
export const generateDemoDataAction = organizationAction(
	{ name: "demoData.generate", requires: "orgAdmin", schema: generateDemoDataSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* demoDataFeatureGate(organizationId, actor.userId);
			return yield* Effect.promise(() =>
				generateDemoData({
					organizationId,
					dateRange: calculateDateRange(input.dateRangeType),
					includeTimeEntries: input.includeTimeEntries,
					includeAbsences: input.includeAbsences,
					includeTeams: input.includeTeams,
					teamCount: input.teamCount,
					includeProjects: input.includeProjects,
					projectCount: input.projectCount,
					employeeIds: input.employeeIds,
					createdBy: actor.userId,
				}),
			);
		}),
);

/**
 * Generate demo teams (step 1)
 */
export const generateTeamsStepAction = demoStepAction(
	"generateTeams",
	(input) => ({ includeTeams: true, teamCount: input.teamCount }),
	generateDemoTeams,
);

/**
 * Generate demo projects (step 2)
 */
export const generateProjectsStepAction = demoStepAction(
	"generateProjects",
	(input) => ({ includeProjects: true, projectCount: input.projectCount }),
	generateDemoProjects,
);

/**
 * Generate manager assignments (step 3)
 */
export const generateManagersStepAction = demoStepAction(
	"generateManagers",
	() => ({}),
	generateDemoManagerAssignments,
);

/**
 * Generate time entries (step 4)
 */
export const generateTimeEntriesStepAction = demoStepAction(
	"generateTimeEntries",
	() => ({ includeTimeEntries: true }),
	generateDemoTimeEntries,
);

/**
 * Generate absences (step 5)
 */
export const generateAbsencesStepAction = demoStepAction(
	"generateAbsences",
	() => ({ includeAbsences: true }),
	generateDemoAbsences,
);

export const generatePendingAbsenceApprovalsStepAction = demoStepAction(
	"generatePendingAbsenceApprovals",
	() => ({ includePendingAbsenceApprovals: true }),
	generateDemoPendingAbsenceApprovals,
);

export const generatePendingTimeCorrectionApprovalsStepAction = demoStepAction(
	"generatePendingTimeCorrectionApprovals",
	() => ({ includePendingTimeCorrectionApprovals: true }),
	generateDemoPendingTimeCorrectionApprovals,
);

/**
 * Generate demo locations (step 6)
 */
export const generateLocationsStepAction = demoStepAction(
	"generateLocations",
	(input) => ({
		includeLocations: true,
		locationCount: input.locationCount,
		subareasPerLocation: input.subareasPerLocation,
	}),
	async (options) => {
		const result = await generateDemoLocations(options);
		// Organization vehicles come with the demo locations (#1118).
		const vehicles = await generateDemoVehicles(options);
		return { ...result, vehiclesCreated: vehicles.vehiclesCreated };
	},
);

/**
 * Generate demo work categories (step 7)
 */
export const generateWorkCategoriesStepAction = demoStepAction(
	"generateWorkCategories",
	(input) => ({
		includeWorkCategories: true,
		workCategorySetCount: input.workCategorySetCount,
		workCategoryCount: input.workCategoryCount,
	}),
	generateDemoWorkCategories,
);

/**
 * Generate demo change policies (step 8)
 */
export const generateChangePoliciesStepAction = demoStepAction(
	"generateChangePolicies",
	(input) => ({ includeChangePolicies: true, changePolicyCount: input.changePolicyCount }),
	generateDemoChangePolicies,
);

/**
 * Generate demo shift templates (step 9)
 */
export const generateShiftTemplatesStepAction = demoStepAction(
	"generateShiftTemplates",
	(input) => ({ includeShifts: true, shiftTemplateCount: input.shiftTemplateCount }),
	generateDemoShiftTemplates,
);

/**
 * Generate demo shifts with recurrence (step 10)
 */
export const generateShiftsStepAction = demoStepAction(
	"generateShifts",
	() => ({ includeShifts: true, generateShiftInstances: true }),
	generateDemoShifts,
);

/**
 * Assign work categories to existing work periods (step 11)
 */
export const assignWorkCategoriesToPeriodsStepAction = demoStepAction(
	"assignWorkCategoriesToPeriods",
	() => ({ assignWorkCategoriesToPeriods: true }),
	assignWorkCategoriesToPeriods,
);

/**
 * Records vehicle use on the demo work of the demo vehicles' team drivers, some of it with
 * driving details missing (#1132). Runs after the time entries and the locations, which bring
 * the demo vehicles.
 */
export const assignVehicleUseToPeriodsStepAction = demoStepAction(
	"assignVehicleUseToPeriods",
	() => ({ includeTimeEntries: true, includeLocations: true }),
	assignDemoVehicleUseToPeriods,
);

/**
 * Clear all time-related data for an organization
 */
export const clearTimeDataAction = organizationAction(
	{ name: "demoData.clearTimeData", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			yield* demoDataFeatureGate(organizationId, actor.userId);
			return yield* Effect.promise(() => clearOrganizationTimeData(organizationId, actor.userId));
		}),
);

/**
 * Get employees list for the organization (for the employee selector)
 */
export const getOrganizationEmployees = organizationAction(
	{ name: "demoData.listEmployees", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			yield* demoDataFeatureGate(organizationId, actor.userId);
			const dbService = yield* DatabaseService;
			const employees = yield* dbService.query("demoData.listEmployees", () =>
				dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, organizationId),
					with: { user: true },
				}),
			);

			return employees.map((emp) => ({
				id: emp.id,
				name: emp.user?.name || emp.userId,
			}));
		}),
);

/**
 * Generate demo employees with fake user accounts
 */
export const generateDemoEmployeesAction = organizationAction(
	{
		name: "demoData.generateEmployees",
		requires: "orgAdmin",
		schema: generateDemoEmployeesSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* demoDataFeatureGate(organizationId, actor.userId);
			return yield* Effect.promise(() =>
				generateDemoEmployees({
					organizationId,
					count: input.count,
					includeManagers: input.includeManagers,
				}),
			);
		}),
);

/**
 * Delete all non-admin employees and their data
 */
export const deleteNonAdminDataAction = organizationAction(
	{ name: "demoData.deleteNonAdminData", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			yield* demoDataFeatureGate(organizationId, actor.userId);
			return yield* Effect.promise(() => deleteNonAdminEmployeesData(organizationId, actor.userId));
		}),
);
