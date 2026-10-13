import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { z } from "zod";
import {
	type employeeSkill as EmployeeSkillTable,
	employee,
	employeeSkill,
	location,
	locationSubarea,
	type skillRequirementOverride as OverrideTable,
	type skill as SkillTable,
	type subareaSkillRequirement as SubareaSkillReqTable,
	shiftTemplate,
	shiftTemplateSkillRequirement,
	skill,
	skillRequirementOverride,
	subareaSkillRequirement,
	type shiftTemplateSkillRequirement as TemplateSkillReqTable,
} from "@/db/schema";
import { type DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "./database.service";

// Type definitions
type Skill = typeof SkillTable.$inferSelect;
type EmployeeSkill = typeof EmployeeSkillTable.$inferSelect;
type SubareaSkillReq = typeof SubareaSkillReqTable.$inferSelect;
type TemplateSkillReq = typeof TemplateSkillReqTable.$inferSelect;
type SkillOverride = typeof OverrideTable.$inferSelect;

const missingSkillIdsSchema = z.array(z.string().min(1)).min(1);

type SkillCategory = "safety" | "equipment" | "certification" | "training" | "language" | "custom";

// ============================================
// INPUT TYPES
// ============================================

export interface CreateSkillInput {
	organizationId: string;
	name: string;
	description?: string;
	category: SkillCategory;
	customCategoryName?: string;
	requiresExpiry: boolean;
	createdBy: string;
}

export interface UpdateSkillInput {
	name?: string;
	description?: string;
	category?: SkillCategory;
	customCategoryName?: string;
	requiresExpiry?: boolean;
	isActive?: boolean;
	updatedBy: string;
}

export interface AssignSkillInput {
	/** The actor's organization; the employee and the skill must both belong to it. */
	organizationId: string;
	employeeId: string;
	skillId: string;
	expiresAt?: Date;
	notes?: string;
	assignedBy: string;
}

export interface SetSkillRequirementsInput {
	/** The actor's organization; the target and every skill must belong to it. */
	organizationId: string;
	targetId: string; // subareaId or templateId
	requirements: Array<{
		skillId: string;
		isRequired: boolean;
	}>;
	createdBy: string;
}

export interface RecordOverrideInput {
	organizationId: string;
	shiftId: string;
	employeeId: string;
	missingSkillIds: string[];
	overrideReason: string;
	overriddenBy: string;
}

// ============================================
// OUTPUT TYPES
// ============================================

export interface SkillWithRelations extends Skill {
	employeeCount?: number;
}

export interface EmployeeSkillWithDetails extends EmployeeSkill {
	skill: Skill;
}

export interface SkillValidationResult {
	isQualified: boolean;
	missingSkills: Array<{
		id: string;
		name: string;
		category: SkillCategory;
		isRequired: boolean;
	}>;
	expiredSkills: Array<{
		id: string;
		name: string;
		expiresAt: Date;
	}>;
}

export interface OverrideHistoryEntry extends SkillOverride {
	shift?: {
		date: Date;
		startTime: string;
		endTime: string;
	};
	employee?: {
		firstName: string | null;
		lastName: string | null;
	};
	missingSkillNames: string[];
}

// ============================================
// SERVICE DEFINITION
// ============================================

/**
 * Every method is scoped to one organization: ids that belong to another
 * organization behave as if they did not exist (NotFoundError, or no rows).
 */
export class SkillService extends Context.Service<
	SkillService,
	{
		// Skill catalog operations
		readonly createSkill: (
			input: CreateSkillInput,
		) => Effect.Effect<Skill, ValidationError | DatabaseError>;

		readonly updateSkill: (
			organizationId: string,
			id: string,
			input: UpdateSkillInput,
		) => Effect.Effect<Skill, NotFoundError | ValidationError | DatabaseError>;

		readonly deleteSkill: (
			organizationId: string,
			id: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly getOrganizationSkills: (
			organizationId: string,
			options?: { includeInactive?: boolean },
		) => Effect.Effect<SkillWithRelations[], DatabaseError>;

		readonly getSkillById: (
			organizationId: string,
			id: string,
		) => Effect.Effect<Skill | null, DatabaseError>;

		// Employee skill assignments
		readonly assignSkillToEmployee: (
			input: AssignSkillInput,
		) => Effect.Effect<EmployeeSkill, ValidationError | NotFoundError | DatabaseError>;

		readonly removeSkillFromEmployee: (
			organizationId: string,
			employeeId: string,
			skillId: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly getEmployeeSkills: (
			organizationId: string,
			employeeId: string,
		) => Effect.Effect<EmployeeSkillWithDetails[], NotFoundError | DatabaseError>;

		readonly getQualifiedEmployeesForSkills: (
			organizationId: string,
			skillIds: string[],
		) => Effect.Effect<string[], DatabaseError>;

		// Subarea skill requirements
		readonly setSubareaSkillRequirements: (
			input: SetSkillRequirementsInput,
		) => Effect.Effect<SubareaSkillReq[], NotFoundError | DatabaseError>;

		readonly getSubareaSkillRequirements: (
			organizationId: string,
			subareaId: string,
		) => Effect.Effect<Array<SubareaSkillReq & { skill: Skill }>, NotFoundError | DatabaseError>;

		// Template skill requirements
		readonly setTemplateSkillRequirements: (
			input: SetSkillRequirementsInput,
		) => Effect.Effect<TemplateSkillReq[], NotFoundError | DatabaseError>;

		readonly getTemplateSkillRequirements: (
			organizationId: string,
			templateId: string,
		) => Effect.Effect<Array<TemplateSkillReq & { skill: Skill }>, NotFoundError | DatabaseError>;

		// Validation
		readonly validateEmployeeForShift: (
			organizationId: string,
			employeeId: string,
			shiftData: {
				subareaId: string;
				templateId?: string | null;
			},
		) => Effect.Effect<SkillValidationResult, NotFoundError | DatabaseError>;

		readonly validateEmployeeForSubarea: (
			organizationId: string,
			employeeId: string,
			subareaId: string,
		) => Effect.Effect<SkillValidationResult, NotFoundError | DatabaseError>;

		// Override recording
		readonly recordOverride: (
			input: RecordOverrideInput,
		) => Effect.Effect<SkillOverride, ValidationError | DatabaseError>;

		readonly getOverrideHistory: (
			organizationId: string,
			options?: {
				employeeId?: string;
				shiftId?: string;
				limit?: number;
			},
		) => Effect.Effect<OverrideHistoryEntry[], DatabaseError>;
	}
>()("SkillService") {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const SkillServiceLive = Layer.effect(
	SkillService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		// ----------------------------------------
		// Organization scoping
		// ----------------------------------------
		const organizationSkillWhere = (organizationId: string, id: string) =>
			and(eq(skill.id, id), eq(skill.organizationId, organizationId));

		const findOrganizationSkill = (organizationId: string, id: string, queryName: string) =>
			dbService.query(queryName, async () => {
				return (
					(await dbService.db.query.skill.findFirst({
						where: organizationSkillWhere(organizationId, id),
					})) ?? null
				);
			});

		const requireOrganizationSkill = (organizationId: string, id: string, queryName: string) =>
			findOrganizationSkill(organizationId, id, queryName).pipe(
				Effect.flatMap((existing) =>
					existing
						? Effect.succeed(existing)
						: Effect.fail(
								new NotFoundError({
									message: "Skill not found",
									entityType: "skill",
									entityId: id,
								}),
							),
				),
			);

		const requireOrganizationEmployee = (organizationId: string, employeeId: string) =>
			dbService
				.query("verifyEmployeeInOrganization", async () => {
					return await dbService.db.query.employee.findFirst({
						where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
						columns: { id: true },
					});
				})
				.pipe(
					Effect.flatMap((record) =>
						record
							? Effect.void
							: Effect.fail(
									new NotFoundError({
										message: "Employee not found",
										entityType: "employee",
										entityId: employeeId,
									}),
								),
					),
				);

		// A subarea belongs to the organization of its location.
		const requireOrganizationSubarea = (organizationId: string, subareaId: string) =>
			dbService
				.query("verifySubareaInOrganization", async () => {
					const [record] = await dbService.db
						.select({ id: locationSubarea.id })
						.from(locationSubarea)
						.innerJoin(location, eq(location.id, locationSubarea.locationId))
						.where(
							and(eq(locationSubarea.id, subareaId), eq(location.organizationId, organizationId)),
						)
						.limit(1);
					return record;
				})
				.pipe(
					Effect.flatMap((record) =>
						record
							? Effect.void
							: Effect.fail(
									new NotFoundError({
										message: "Subarea not found",
										entityType: "locationSubarea",
										entityId: subareaId,
									}),
								),
					),
				);

		const requireOrganizationTemplate = (organizationId: string, templateId: string) =>
			dbService
				.query("verifyTemplateInOrganization", async () => {
					return await dbService.db.query.shiftTemplate.findFirst({
						where: and(
							eq(shiftTemplate.id, templateId),
							eq(shiftTemplate.organizationId, organizationId),
						),
						columns: { id: true },
					});
				})
				.pipe(
					Effect.flatMap((record) =>
						record
							? Effect.void
							: Effect.fail(
									new NotFoundError({
										message: "Shift template not found",
										entityType: "shiftTemplate",
										entityId: templateId,
									}),
								),
					),
				);

		const requireOrganizationSkillIds = (organizationId: string, skillIds: readonly string[]) =>
			Effect.gen(function* () {
				const requested = [...new Set(skillIds)];
				if (requested.length === 0) return;

				const found = yield* dbService.query("verifySkillsInOrganization", async () => {
					return await dbService.db.query.skill.findMany({
						where: and(eq(skill.organizationId, organizationId), inArray(skill.id, requested)),
						columns: { id: true },
					});
				});

				const foundIds = new Set(found.map((row) => row.id));
				const missingId = requested.find((id) => !foundIds.has(id));
				if (missingId) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "Skill not found",
							entityType: "skill",
							entityId: missingId,
						}),
					);
				}
			});

		/** Drops rows whose skill belongs to another organization (pre-#1135 data). */
		const withOrganizationSkills = <Row extends { skill: Skill }>(
			organizationId: string,
			rows: Row[],
		) => rows.filter((row) => row.skill.organizationId === organizationId);

		return SkillService.of({
			// ----------------------------------------
			// Skill catalog operations
			// ----------------------------------------
			createSkill: (input) =>
				Effect.gen(function* () {
					// Validate custom category
					if (input.category === "custom" && !input.customCategoryName) {
						yield* Effect.fail(
							new ValidationError({
								message: "Custom category name is required when category is 'custom'",
								field: "customCategoryName",
							}),
						);
					}

					const createdSkill = yield* dbService.query("createSkill", async () => {
						const [newSkill] = await dbService.db
							.insert(skill)
							.values({
								organizationId: input.organizationId,
								name: input.name,
								description: input.description,
								category: input.category,
								customCategoryName: input.customCategoryName,
								requiresExpiry: input.requiresExpiry,
								createdBy: input.createdBy,
								updatedAt: new Date(),
							})
							.returning();
						return newSkill;
					});

					return createdSkill;
				}),

			updateSkill: (organizationId, id, input) =>
				Effect.gen(function* () {
					const existingSkill = yield* requireOrganizationSkill(organizationId, id, "getSkillById");

					// Validate custom category
					const newCategory = input.category ?? existingSkill.category;
					if (
						newCategory === "custom" &&
						!input.customCategoryName &&
						!existingSkill.customCategoryName
					) {
						yield* Effect.fail(
							new ValidationError({
								message: "Custom category name is required when category is 'custom'",
								field: "customCategoryName",
							}),
						);
					}

					const updatedSkill = yield* dbService.query("updateSkill", async () => {
						const [updated] = await dbService.db
							.update(skill)
							.set({
								...(input.name !== undefined && { name: input.name }),
								...(input.description !== undefined && {
									description: input.description,
								}),
								...(input.category !== undefined && {
									category: input.category,
								}),
								...(input.customCategoryName !== undefined && {
									customCategoryName: input.customCategoryName,
								}),
								...(input.requiresExpiry !== undefined && {
									requiresExpiry: input.requiresExpiry,
								}),
								...(input.isActive !== undefined && {
									isActive: input.isActive,
								}),
								updatedBy: input.updatedBy,
							})
							.where(organizationSkillWhere(organizationId, id))
							.returning();
						return updated;
					});

					return updatedSkill;
				}),

			deleteSkill: (organizationId, id) =>
				Effect.gen(function* () {
					yield* requireOrganizationSkill(organizationId, id, "getSkillById");

					// Soft delete by setting isActive to false
					yield* dbService.query("softDeleteSkill", async () => {
						await dbService.db
							.update(skill)
							.set({ isActive: false })
							.where(organizationSkillWhere(organizationId, id));
					});
				}),

			getOrganizationSkills: (organizationId, options) =>
				Effect.gen(function* () {
					const skills = yield* dbService.query("getOrganizationSkills", async () => {
						const conditions = [eq(skill.organizationId, organizationId)];

						if (!options?.includeInactive) {
							conditions.push(eq(skill.isActive, true));
						}

						return await dbService.db.query.skill.findMany({
							where: and(...conditions),
							orderBy: (skill, { asc }) => [asc(skill.category), asc(skill.name)],
						});
					});

					return skills as SkillWithRelations[];
				}),

			getSkillById: (organizationId, id) =>
				findOrganizationSkill(organizationId, id, "getSkillById"),

			// ----------------------------------------
			// Employee skill assignments
			// ----------------------------------------
			assignSkillToEmployee: (input) =>
				Effect.gen(function* () {
					// The employee and the skill must both belong to the actor's organization
					yield* requireOrganizationEmployee(input.organizationId, input.employeeId);

					const skillRecord = yield* dbService.query("verifySkillExists", async () => {
						return await dbService.db.query.skill.findFirst({
							where: and(
								organizationSkillWhere(input.organizationId, input.skillId),
								eq(skill.isActive, true),
							),
						});
					});

					if (!skillRecord) {
						return yield* Effect.fail(
							new NotFoundError({
								message: "Skill not found or inactive",
								entityType: "skill",
								entityId: input.skillId,
							}),
						);
					}

					const activeSkill = skillRecord;

					// Validate expiry if skill requires it
					if (activeSkill.requiresExpiry && !input.expiresAt) {
						yield* Effect.fail(
							new ValidationError({
								message: "This skill requires an expiry date",
								field: "expiresAt",
							}),
						);
					}

					// Upsert (update if exists, insert if not)
					const assignment = yield* dbService.query("assignSkillToEmployee", async () => {
						const [result] = await dbService.db
							.insert(employeeSkill)
							.values({
								employeeId: input.employeeId,
								skillId: input.skillId,
								expiresAt: input.expiresAt,
								notes: input.notes,
								assignedBy: input.assignedBy,
							})
							.onConflictDoUpdate({
								target: [employeeSkill.employeeId, employeeSkill.skillId],
								set: {
									expiresAt: input.expiresAt,
									notes: input.notes,
									assignedBy: input.assignedBy,
									assignedAt: new Date(),
								},
							})
							.returning();
						return result;
					});

					return assignment;
				}),

			removeSkillFromEmployee: (organizationId, employeeId, skillId) =>
				Effect.gen(function* () {
					// The assignment is the organization's only if its employee is
					yield* requireOrganizationEmployee(organizationId, employeeId);

					const existing = yield* dbService.query("getEmployeeSkill", async () => {
						return await dbService.db.query.employeeSkill.findFirst({
							where: and(
								eq(employeeSkill.employeeId, employeeId),
								eq(employeeSkill.skillId, skillId),
							),
						});
					});

					if (!existing) {
						yield* Effect.fail(
							new NotFoundError({
								message: "Employee skill assignment not found",
								entityType: "employeeSkill",
								entityId: `${employeeId}:${skillId}`,
							}),
						);
					}

					yield* dbService.query("removeSkillFromEmployee", async () => {
						await dbService.db
							.delete(employeeSkill)
							.where(
								and(eq(employeeSkill.employeeId, employeeId), eq(employeeSkill.skillId, skillId)),
							);
					});
				}),

			getEmployeeSkills: (organizationId, employeeId) =>
				Effect.gen(function* () {
					yield* requireOrganizationEmployee(organizationId, employeeId);

					const skills = yield* dbService.query("getEmployeeSkills", async () => {
						return await dbService.db.query.employeeSkill.findMany({
							where: eq(employeeSkill.employeeId, employeeId),
							with: {
								skill: true,
							},
						});
					});

					return withOrganizationSkills(organizationId, skills) as EmployeeSkillWithDetails[];
				}),

			getQualifiedEmployeesForSkills: (organizationId, skillIds) =>
				Effect.gen(function* () {
					if (skillIds.length === 0) {
						// No skills required = all employees qualify
						const allEmployees = yield* dbService.query("getAllEmployees", async () => {
							return await dbService.db.query.employee.findMany({
								where: eq(employee.organizationId, organizationId),
								columns: { id: true },
							});
						});
						return allEmployees.map((e) => e.id);
					}

					const qualifiedEmployees = yield* dbService.query("getQualifiedEmployees", async () => {
						// Get employees who have ALL required skills and none are expired
						const now = new Date();

						// Find employees with valid (non-expired) assignments for ALL required skills
						const employeeSkills = await dbService.db.query.employeeSkill.findMany({
							where: and(
								inArray(employeeSkill.skillId, skillIds),
								or(isNull(employeeSkill.expiresAt), gt(employeeSkill.expiresAt, now)),
							),
							with: {
								employee: {
									columns: { id: true, organizationId: true },
								},
								skill: {
									columns: { organizationId: true },
								},
							},
						});

						// Group by employee and check they have ALL required skills
						const employeeSkillCounts = new Map<string, number>();
						for (const es of employeeSkills) {
							if (
								es.employee.organizationId === organizationId &&
								es.skill.organizationId === organizationId
							) {
								employeeSkillCounts.set(
									es.employee.id,
									(employeeSkillCounts.get(es.employee.id) || 0) + 1,
								);
							}
						}

						// Return only employees who have all required skills
						const qualifiedIds: string[] = [];
						for (const [empId, count] of employeeSkillCounts) {
							if (count >= skillIds.length) {
								qualifiedIds.push(empId);
							}
						}

						return qualifiedIds;
					});

					return qualifiedEmployees;
				}),

			// ----------------------------------------
			// Subarea skill requirements
			// ----------------------------------------
			setSubareaSkillRequirements: (input) =>
				Effect.gen(function* () {
					yield* requireOrganizationSubarea(input.organizationId, input.targetId);
					yield* requireOrganizationSkillIds(
						input.organizationId,
						input.requirements.map((req) => req.skillId),
					);

					// Delete existing requirements and insert new ones
					const requirements = yield* dbService.query("setSubareaSkillRequirements", async () => {
						const values = input.requirements.map((req) => ({
							subareaId: input.targetId,
							skillId: req.skillId,
							isRequired: req.isRequired,
							createdBy: input.createdBy,
						}));

						// Delete existing
						await dbService.db
							.delete(subareaSkillRequirement)
							.where(eq(subareaSkillRequirement.subareaId, input.targetId));

						if (values.length === 0) {
							return [];
						}

						// Insert new requirements
						return await dbService.db.insert(subareaSkillRequirement).values(values).returning();
					});

					return requirements;
				}),

			getSubareaSkillRequirements: (organizationId, subareaId) =>
				Effect.gen(function* () {
					yield* requireOrganizationSubarea(organizationId, subareaId);

					const requirements = yield* dbService.query("getSubareaSkillRequirements", async () => {
						return await dbService.db.query.subareaSkillRequirement.findMany({
							where: eq(subareaSkillRequirement.subareaId, subareaId),
							with: {
								skill: true,
							},
						});
					});

					return withOrganizationSkills(organizationId, requirements) as Array<
						SubareaSkillReq & { skill: Skill }
					>;
				}),

			// ----------------------------------------
			// Template skill requirements
			// ----------------------------------------
			setTemplateSkillRequirements: (input) =>
				Effect.gen(function* () {
					yield* requireOrganizationTemplate(input.organizationId, input.targetId);
					yield* requireOrganizationSkillIds(
						input.organizationId,
						input.requirements.map((req) => req.skillId),
					);

					// Delete existing requirements and insert new ones
					const requirements = yield* dbService.query("setTemplateSkillRequirements", async () => {
						const values = input.requirements.map((req) => ({
							templateId: input.targetId,
							skillId: req.skillId,
							isRequired: req.isRequired,
							createdBy: input.createdBy,
						}));

						// Delete existing
						await dbService.db
							.delete(shiftTemplateSkillRequirement)
							.where(eq(shiftTemplateSkillRequirement.templateId, input.targetId));

						if (values.length === 0) {
							return [];
						}

						// Insert new requirements
						return await dbService.db
							.insert(shiftTemplateSkillRequirement)
							.values(values)
							.returning();
					});

					return requirements;
				}),

			getTemplateSkillRequirements: (organizationId, templateId) =>
				Effect.gen(function* () {
					yield* requireOrganizationTemplate(organizationId, templateId);

					const requirements = yield* dbService.query("getTemplateSkillRequirements", async () => {
						return await dbService.db.query.shiftTemplateSkillRequirement.findMany({
							where: eq(shiftTemplateSkillRequirement.templateId, templateId),
							with: {
								skill: true,
							},
						});
					});

					return withOrganizationSkills(organizationId, requirements) as Array<
						TemplateSkillReq & { skill: Skill }
					>;
				}),

			// ----------------------------------------
			// Validation
			// ----------------------------------------
			validateEmployeeForShift: (organizationId, employeeId, shiftData) =>
				Effect.gen(function* () {
					yield* requireOrganizationEmployee(organizationId, employeeId);
					yield* requireOrganizationSubarea(organizationId, shiftData.subareaId);
					if (shiftData.templateId) {
						yield* requireOrganizationTemplate(organizationId, shiftData.templateId);
					}

					const now = new Date();

					// Get employee's current valid skills
					const employeeSkills = yield* dbService.query("getEmployeeValidSkills", async () => {
						const rows = await dbService.db.query.employeeSkill.findMany({
							where: and(
								eq(employeeSkill.employeeId, employeeId),
								or(isNull(employeeSkill.expiresAt), gt(employeeSkill.expiresAt, now)),
							),
							with: {
								skill: true,
							},
						});
						return withOrganizationSkills(organizationId, rows);
					});

					// Get expired skills (for warning)
					const expiredSkills = yield* dbService.query("getExpiredSkills", async () => {
						const rows = await dbService.db.query.employeeSkill.findMany({
							where: and(
								eq(employeeSkill.employeeId, employeeId),
								lte(employeeSkill.expiresAt, now),
							),
							with: {
								skill: true,
							},
						});
						return withOrganizationSkills(organizationId, rows);
					});

					const validSkillIds = new Set(employeeSkills.map((es) => es.skillId));

					// Get subarea requirements
					const subareaReqs = yield* dbService.query("getSubareaRequirements", async () => {
						const rows = await dbService.db.query.subareaSkillRequirement.findMany({
							where: eq(subareaSkillRequirement.subareaId, shiftData.subareaId),
							with: {
								skill: true,
							},
						});
						return withOrganizationSkills(organizationId, rows);
					});

					// Get template requirements if applicable
					let templateReqs: Array<{
						skillId: string;
						isRequired: boolean;
						skill: Skill;
					}> = [];
					if (shiftData.templateId) {
						const templateId = shiftData.templateId;
						templateReqs = yield* dbService.query("getTemplateRequirements", async () => {
							const rows = await dbService.db.query.shiftTemplateSkillRequirement.findMany({
								where: eq(shiftTemplateSkillRequirement.templateId, templateId),
								with: {
									skill: true,
								},
							});
							return withOrganizationSkills(organizationId, rows);
						});
					}

					// Combine all requirements (deduped by skillId, taking most restrictive isRequired)
					const allRequirements = new Map<string, { skill: Skill; isRequired: boolean }>();

					for (const req of [...subareaReqs, ...templateReqs]) {
						const existing = allRequirements.get(req.skillId);
						if (!existing || (req.isRequired && !existing.isRequired)) {
							allRequirements.set(req.skillId, {
								skill: req.skill,
								isRequired: req.isRequired,
							});
						}
					}

					// Find missing skills
					const missingSkills: SkillValidationResult["missingSkills"] = [];
					for (const [skillId, { skill: skillData, isRequired }] of allRequirements) {
						if (!validSkillIds.has(skillId)) {
							missingSkills.push({
								id: skillId,
								name: skillData.name,
								category: skillData.category as SkillCategory,
								isRequired,
							});
						}
					}

					// Map expired skills
					const expiredSkillsResult: SkillValidationResult["expiredSkills"] = [];
					for (const es of expiredSkills) {
						const expiresAt = es.expiresAt;
						if (!allRequirements.has(es.skillId) || !(expiresAt instanceof Date)) {
							continue;
						}

						expiredSkillsResult.push({
							id: es.skillId,
							name: es.skill.name,
							expiresAt,
						});
					}

					const hasRequiredMissing = missingSkills.some((s) => s.isRequired);

					return {
						isQualified: !hasRequiredMissing && expiredSkillsResult.length === 0,
						missingSkills,
						expiredSkills: expiredSkillsResult,
					};
				}),

			validateEmployeeForSubarea: (organizationId, employeeId, subareaId) =>
				Effect.gen(function* () {
					yield* requireOrganizationEmployee(organizationId, employeeId);
					yield* requireOrganizationSubarea(organizationId, subareaId);

					const now = new Date();

					// Get employee's current valid skills
					const validEmployeeSkills = yield* dbService.query("getEmployeeValidSkillsForSubarea", async () => {
						const rows = await dbService.db.query.employeeSkill.findMany({
							where: and(
								eq(employeeSkill.employeeId, employeeId),
								or(isNull(employeeSkill.expiresAt), gt(employeeSkill.expiresAt, now)),
							),
							with: { skill: true },
						});
						return withOrganizationSkills(organizationId, rows);
					});

					// Get expired skills
					const expiredSkillsData = yield* dbService.query("getExpiredSkillsForSubarea", async () => {
						const rows = await dbService.db.query.employeeSkill.findMany({
							where: and(
								eq(employeeSkill.employeeId, employeeId),
								lte(employeeSkill.expiresAt, now),
							),
							with: { skill: true },
						});
						return withOrganizationSkills(organizationId, rows);
					});

					const validSkillIds = new Set(validEmployeeSkills.map((es) => es.skillId));

					// Get subarea requirements only
					const subareaReqs = yield* dbService.query("getSubareaRequirementsOnly", async () => {
						const rows = await dbService.db.query.subareaSkillRequirement.findMany({
							where: eq(subareaSkillRequirement.subareaId, subareaId),
							with: { skill: true },
						});
						return withOrganizationSkills(organizationId, rows);
					});

					// Find missing skills
					const missingSkills: SkillValidationResult["missingSkills"] = [];
					for (const req of subareaReqs) {
						if (!validSkillIds.has(req.skillId)) {
							missingSkills.push({
								id: req.skillId,
								name: req.skill.name,
								category: req.skill.category as SkillCategory,
								isRequired: req.isRequired,
							});
						}
					}

					// Map expired skills (only those required by subarea)
					const requiredSkillIds = new Set(subareaReqs.map((r) => r.skillId));
					const expiredSkillsResult: SkillValidationResult["expiredSkills"] = [];
					for (const es of expiredSkillsData) {
						const expiresAt = es.expiresAt;
						if (!requiredSkillIds.has(es.skillId) || !(expiresAt instanceof Date)) {
							continue;
						}

						expiredSkillsResult.push({
							id: es.skillId,
							name: es.skill.name,
							expiresAt,
						});
					}

					const hasRequiredMissing = missingSkills.some((s) => s.isRequired);

					return {
						isQualified: !hasRequiredMissing && expiredSkillsResult.length === 0,
						missingSkills,
						expiredSkills: expiredSkillsResult,
					};
				}),

			// ----------------------------------------
			// Override recording
			// ----------------------------------------
			recordOverride: (input) =>
				Effect.gen(function* () {
					if (input.missingSkillIds.length === 0) {
						yield* Effect.fail(
							new ValidationError({
								message: "At least one missing skill ID is required",
								field: "missingSkillIds",
							}),
						);
					}

					if (!input.overrideReason.trim()) {
						yield* Effect.fail(
							new ValidationError({
								message: "Override reason is required",
								field: "overrideReason",
							}),
						);
					}

					const override = yield* dbService.query("recordOverride", async () => {
						const [result] = await dbService.db
							.insert(skillRequirementOverride)
							.values({
								organizationId: input.organizationId,
								shiftId: input.shiftId,
								employeeId: input.employeeId,
								missingSkillIds: JSON.stringify(input.missingSkillIds),
								overrideReason: input.overrideReason,
								overriddenBy: input.overriddenBy,
							})
							.returning();
						return result;
					});

					return override;
				}),

			getOverrideHistory: (organizationId, options) =>
				Effect.gen(function* () {
					const overrides = yield* dbService.query("getOverrideHistory", async () => {
						const conditions = [eq(skillRequirementOverride.organizationId, organizationId)];

						if (options?.employeeId) {
							conditions.push(eq(skillRequirementOverride.employeeId, options.employeeId));
						}
						if (options?.shiftId) {
							conditions.push(eq(skillRequirementOverride.shiftId, options.shiftId));
						}

						const results = await dbService.db.query.skillRequirementOverride.findMany({
							where: and(...conditions),
							with: {
								shift: {
									columns: {
										date: true,
										startTime: true,
										endTime: true,
									},
								},
								employee: {
									columns: {
										firstName: true,
										lastName: true,
									},
								},
							},
							orderBy: (table, { desc }) => [desc(table.overriddenAt)],
							limit: options?.limit ?? 50,
						});

						return results.map((override) => ({
							override,
							missingSkillIds: missingSkillIdsSchema.parse(
								JSON.parse(override.missingSkillIds),
							),
						}));
					});

					// Resolve skill names for missing skills
					const allSkillIds = new Set<string>();
					for (const { missingSkillIds } of overrides) {
						for (const id of missingSkillIds) {
							allSkillIds.add(id);
						}
					}

					const skillNames = yield* dbService.query("getSkillNames", async () => {
						if (allSkillIds.size === 0) return new Map<string, string>();

						const skills = await dbService.db.query.skill.findMany({
							where: and(
								eq(skill.organizationId, organizationId),
								inArray(skill.id, Array.from(allSkillIds)),
							),
							columns: { id: true, name: true },
						});

						return new Map(skills.map((s) => [s.id, s.name]));
					});

					return overrides.map(({ override, missingSkillIds }) => ({
						...override,
						missingSkillNames: missingSkillIds.map(
							(id) => skillNames.get(id) ?? "Unknown Skill",
						),
					})) as OverrideHistoryEntry[];
				}),
		});
	}),
);
