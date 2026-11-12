"use server";

import { and, asc, count, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import * as authSchema from "@/db/auth-schema";
import {
	absenceEntry,
	clockodoProjectMapping,
	clockodoUserMapping,
	customer,
	employee,
	holiday,
	project,
	surchargeModel,
	team,
	workCategory,
	workPeriod,
	workPolicy,
} from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { ClockodoClient } from "@/lib/clockodo/client";
import type { ClockodoDataPreview, ImportResult, SavedProjectMapping } from "@/lib/clockodo/types";
import { ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import {
	type DatabaseClient,
	type DatabaseQuery,
	DatabaseService,
} from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const logger = createLogger("ClockodoImportActions");

// ============================================
// TYPES
// ============================================

export interface ExistingDataCounts {
	employees: number;
	teams: number;
	workCategories: number;
	workPeriods: number;
	absences: number;
	workPolicies: number;
	holidays: number;
	surcharges: number;
}

export interface ClockodoUserInfo {
	id: number;
	name: string;
	email: string;
	active: boolean;
}

export interface Z8EmployeeInfo {
	id: string;
	userId: string;
	name: string;
	email: string;
}

export interface ClockodoProjectInfo {
	id: number;
	name: string;
	customerName: string | null;
	active: boolean;
}

export interface Z8ProjectInfo {
	id: string;
	name: string;
	customerName: string | null;
	isActive: boolean;
}

export interface ProjectMappingData {
	clockodoProjects: ClockodoProjectInfo[];
	z8Projects: Z8ProjectInfo[];
	savedMappings: SavedProjectMapping[];
}

// ============================================
// INPUT
// ============================================

const credentialsSchema = z.object({
	email: z.string().trim().min(1, "Email and API key are required"),
	apiKey: z.string().trim().min(1, "Email and API key are required"),
});

const userMappingsSchema = z.object({
	mappings: z.array(
		z.object({
			clockodoUserId: z.number(),
			clockodoUserName: z.string(),
			clockodoUserEmail: z.string(),
			mappingType: z.enum(["auto_email", "manual", "new_employee", "skipped"]),
			employeeId: z.string().nullable(),
			userId: z.string().nullable(),
		}),
	),
});

const projectMappingsSchema = z.object({
	mappings: z.array(
		z.object(
			{
				clockodoProjectId: z.number().int().refine(Number.isSafeInteger),
				clockodoProjectName: z.string(),
				projectId: z.uuid().nullable(),
			},
			"Invalid project mappings",
		),
		"Invalid project mappings",
	),
});

// ============================================
// HELPERS
// ============================================

/** A failed Clockodo call; its message is shown as before. */
function clockodo<T>(operation: string, fallback: string, run: () => Promise<T>) {
	return Effect.tryPromise({
		try: run,
		catch: (cause) =>
			new ExternalServiceError({
				message: cause instanceof Error ? cause.message : fallback,
				service: "clockodo",
				operation,
				cause,
			}),
	}).pipe(Effect.tapError((error) => Effect.sync(() => logger.error({ error }, fallback))));
}

/** Refuses employee IDs outside the organization (tampered client requests). */
function ensureOrganizationEmployees(
	dbService: { db: DatabaseClient; query: DatabaseQuery },
	employeeIds: string[],
	organizationId: string,
) {
	return Effect.gen(function* () {
		const uniqueIds = [...new Set(employeeIds)];
		if (uniqueIds.length === 0) return;
		const valid = yield* dbService.query("clockodoImport.organizationEmployees", () =>
			dbService.db
				.select({ id: employee.id })
				.from(employee)
				.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, uniqueIds))),
		);
		if (valid.length !== uniqueIds.length) {
			return yield* Effect.fail(
				new ValidationError({
					message: "One or more employee IDs do not belong to this organization",
					field: "mappings",
				}),
			);
		}
	});
}

/** Refuses project IDs outside the organization (tampered client requests). */
function ensureOrganizationProjects(
	dbService: { db: DatabaseClient; query: DatabaseQuery },
	projectIds: string[],
	organizationId: string,
) {
	return Effect.gen(function* () {
		const uniqueIds = [...new Set(projectIds)];
		if (uniqueIds.length === 0) return;
		const valid = yield* dbService.query("clockodoImport.organizationProjects", () =>
			dbService.db
				.select({ id: project.id })
				.from(project)
				.where(and(eq(project.organizationId, organizationId), inArray(project.id, uniqueIds))),
		);
		if (valid.length !== uniqueIds.length) {
			return yield* Effect.fail(
				new ValidationError({
					message: "One or more projects do not belong to this organization",
					field: "mappings",
				}),
			);
		}
	});
}

// ============================================
// VALIDATE CREDENTIALS & PREVIEW
// ============================================

export const validateClockodoCredentials = organizationAction(
	{ name: "clockodoImport.validateCredentials", requires: "orgAdmin", schema: credentialsSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const client = new ClockodoClient(input.email, input.apiKey);

			const connected = yield* clockodo("testConnection", "Failed to validate credentials", () =>
				client.testConnection(),
			);
			if (!connected) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Invalid credentials. Check your Clockodo email and API key.",
						field: "apiKey",
					}),
				);
			}

			const [
				users,
				teams,
				services,
				entriesCount,
				absencesCount,
				targetHours,
				holidayQuotas,
				nonBusinessDays,
				surcharges,
			] = yield* clockodo("preview", "Failed to validate credentials", () =>
				Promise.all([
					client.getUsers(),
					client.getTeams(),
					client.getServices(),
					client.getEntriesCount(),
					client.getAbsencesCount(),
					client.getTargetHours(),
					client.getHolidayQuotas(),
					client.getNonBusinessDays(),
					client.getSurcharges(),
				]),
			);

			const preview: ClockodoDataPreview = {
				users: users.length,
				teams: teams.length,
				services: services.length,
				entries: entriesCount,
				absences: absencesCount,
				targetHours: targetHours.length,
				holidayQuotas: holidayQuotas.length,
				nonBusinessDays: nonBusinessDays.length,
				surcharges: surcharges.length,
			};

			logger.info({ organizationId, preview }, "Clockodo credentials validated");
			return preview;
		}),
);

// ============================================
// FETCH USERS AND EMPLOYEES
// ============================================

export const fetchClockodoUsers = organizationAction(
	{ name: "clockodoImport.fetchClockodoUsers", requires: "orgAdmin", schema: credentialsSchema },
	({ input }) =>
		Effect.gen(function* () {
			const client = new ClockodoClient(input.email, input.apiKey);
			const users = yield* clockodo("getUsers", "Failed to fetch users", () => client.getUsers());
			return users.map(
				(u): ClockodoUserInfo => ({ id: u.id, name: u.name, email: u.email, active: u.active }),
			);
		}),
);

export const fetchZ8Employees = organizationAction(
	{ name: "clockodoImport.fetchZ8Employees", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const employees = yield* dbService.query("clockodoImport.fetchZ8Employees", () =>
				dbService.db
					.select({
						id: employee.id,
						userId: employee.userId,
						firstName: authSchema.user.firstName,
						lastName: authSchema.user.lastName,
						email: authSchema.user.email,
						userName: authSchema.user.name,
					})
					.from(employee)
					.innerJoin(authSchema.user, eq(employee.userId, authSchema.user.id))
					.where(eq(employee.organizationId, organizationId)),
			);

			return employees.map(
				(e): Z8EmployeeInfo => ({
					id: e.id,
					userId: e.userId,
					name: buildAuthUserDisplayName({
						firstName: e.firstName,
						lastName: e.lastName,
						name: e.userName,
						email: e.email,
					}),
					email: e.email,
				}),
			);
		}),
);

// ============================================
// SAVE USER MAPPINGS
// ============================================

export const saveUserMappings = organizationAction(
	{ name: "clockodoImport.saveUserMappings", requires: "orgAdmin", schema: userMappingsSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const { mappings } = input;
			yield* ensureOrganizationEmployees(
				dbService,
				mappings.flatMap((mapping) => (mapping.employeeId ? [mapping.employeeId] : [])),
				organizationId,
			);

			yield* dbService.query("clockodoImport.saveUserMappings", () =>
				Promise.all(
					mappings.map((mapping) =>
						dbService.db
							.insert(clockodoUserMapping)
							.values({
								organizationId,
								clockodoUserId: mapping.clockodoUserId,
								clockodoUserName: mapping.clockodoUserName,
								clockodoUserEmail: mapping.clockodoUserEmail,
								userId: mapping.userId,
								employeeId: mapping.employeeId,
								mappingType: mapping.mappingType,
								createdBy: actor.userId,
							})
							.onConflictDoUpdate({
								target: [clockodoUserMapping.organizationId, clockodoUserMapping.clockodoUserId],
								set: {
									clockodoUserName: mapping.clockodoUserName,
									clockodoUserEmail: mapping.clockodoUserEmail,
									userId: mapping.userId,
									employeeId: mapping.employeeId,
									mappingType: mapping.mappingType,
								},
							}),
					),
				),
			);

			logger.info({ organizationId, count: mappings.length }, "User mappings saved");
		}),
);

// ============================================
// PROJECT MAPPING (#907)
// ============================================

/**
 * Clockodo's projects, the organization's existing Z8 projects and the mappings
 * saved by earlier imports, for the project-mapping step.
 */
export const fetchProjectMappingData = organizationAction(
	{
		name: "clockodoImport.fetchProjectMappingData",
		requires: "orgAdmin",
		schema: credentialsSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const client = new ClockodoClient(input.email, input.apiKey);
			const [[clockodoProjects, clockodoCustomers], [z8Projects, savedMappings]] =
				yield* Effect.all(
					[
						clockodo("getProjects", "Failed to fetch projects", () =>
							Promise.all([client.getProjects(), client.getCustomers()]),
						),
						dbService.query("clockodoImport.projectMappingData", () =>
							Promise.all([
								dbService.db
									.select({
										id: project.id,
										name: project.name,
										customerName: customer.name,
										isActive: project.isActive,
									})
									.from(project)
									.leftJoin(
										customer,
										and(
											eq(customer.id, project.customerId),
											eq(customer.organizationId, organizationId),
										),
									)
									.where(eq(project.organizationId, organizationId))
									.orderBy(asc(project.name)),
								dbService.db
									.select({
										clockodoProjectId: clockodoProjectMapping.clockodoProjectId,
										projectId: clockodoProjectMapping.projectId,
									})
									.from(clockodoProjectMapping)
									.where(eq(clockodoProjectMapping.organizationId, organizationId)),
							]),
						),
					],
					{ concurrency: "unbounded" },
				);
			const customerNames = new Map(clockodoCustomers.map((entry) => [entry.id, entry.name]));

			return {
				clockodoProjects: clockodoProjects.map((entry) => ({
					id: entry.id,
					name: entry.name,
					customerName: customerNames.get(entry.customers_id) ?? null,
					active: entry.active,
				})),
				z8Projects,
				savedMappings,
			} satisfies ProjectMappingData;
		}),
);

/**
 * Saves the organization's Clockodo project mappings. Mapped projects must be
 * existing projects of the organization; an entry without a project removes its
 * mapping. Projects are never created.
 */
export const saveProjectMappings = organizationAction(
	{
		name: "clockodoImport.saveProjectMappings",
		requires: "orgAdmin",
		schema: projectMappingsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const mapped = input.mappings.flatMap((mapping) =>
				mapping.projectId === null ? [] : [{ ...mapping, projectId: mapping.projectId }],
			);
			const unmappedIds = input.mappings
				.filter((mapping) => mapping.projectId === null)
				.map((mapping) => mapping.clockodoProjectId);
			yield* ensureOrganizationProjects(
				dbService,
				mapped.map((mapping) => mapping.projectId),
				organizationId,
			);

			yield* dbService.query("clockodoImport.saveProjectMappings", () =>
				dbService.db.transaction(async (tx) => {
					if (unmappedIds.length > 0) {
						await tx
							.delete(clockodoProjectMapping)
							.where(
								and(
									eq(clockodoProjectMapping.organizationId, organizationId),
									inArray(clockodoProjectMapping.clockodoProjectId, unmappedIds),
								),
							);
					}
					for (const mapping of mapped) {
						await tx
							.insert(clockodoProjectMapping)
							.values({
								organizationId,
								clockodoProjectId: mapping.clockodoProjectId,
								clockodoProjectName: mapping.clockodoProjectName,
								projectId: mapping.projectId,
								createdBy: actor.userId,
							})
							.onConflictDoUpdate({
								target: [
									clockodoProjectMapping.organizationId,
									clockodoProjectMapping.clockodoProjectId,
								],
								set: {
									clockodoProjectName: mapping.clockodoProjectName,
									projectId: mapping.projectId,
								},
							});
					}
				}),
			);

			logger.info({ organizationId, mapped: mapped.length }, "Project mappings saved");
		}),
);

// ============================================
// RUN IMPORT
// ============================================

/** Direct imports are disabled; imports go through an import review scan. */
export const importClockodoData = organizationAction(
	{ name: "clockodoImport.importData", requires: "orgAdmin", schema: noInput },
	() =>
		Effect.fail(
			new ValidationError({
				message: "Direct Clockodo imports are disabled. Start an import review scan instead.",
			}),
		) as Effect.Effect<ImportResult, ValidationError>,
);

// ============================================
// GET EXISTING DATA COUNTS
// ============================================

export const getExistingDataCounts = organizationAction(
	{ name: "clockodoImport.getExistingDataCounts", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const db = dbService.db;
			const [
				employeeCount,
				teamCount,
				workCategoryCount,
				workPeriodCount,
				absenceCount,
				workPolicyCount,
				holidayCount,
				surchargeCount,
			] = yield* dbService.query("clockodoImport.existingDataCounts", () =>
				Promise.all([
					db
						.select({ count: count() })
						.from(employee)
						.where(eq(employee.organizationId, organizationId)),
					db.select({ count: count() }).from(team).where(eq(team.organizationId, organizationId)),
					db
						.select({ count: count() })
						.from(workCategory)
						.where(eq(workCategory.organizationId, organizationId)),
					db
						.select({ count: count() })
						.from(workPeriod)
						.where(eq(workPeriod.organizationId, organizationId)),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
						.where(eq(employee.organizationId, organizationId)),
					db
						.select({ count: count() })
						.from(workPolicy)
						.where(eq(workPolicy.organizationId, organizationId)),
					db
						.select({ count: count() })
						.from(holiday)
						.where(eq(holiday.organizationId, organizationId)),
					db
						.select({ count: count() })
						.from(surchargeModel)
						.where(eq(surchargeModel.organizationId, organizationId)),
				]),
			);

			return {
				employees: employeeCount[0].count,
				teams: teamCount[0].count,
				workCategories: workCategoryCount[0].count,
				workPeriods: workPeriodCount[0].count,
				absences: absenceCount[0].count,
				workPolicies: workPolicyCount[0].count,
				holidays: holidayCount[0].count,
				surcharges: surchargeCount[0].count,
			} satisfies ExistingDataCounts;
		}),
);
