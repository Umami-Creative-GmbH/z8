import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
	employee,
	employeeSkill,
	locationSubarea,
	shift,
	shiftTemplate,
	shiftTemplateSkillRequirement,
	skill,
	skillRequirementOverride,
	subareaSkillRequirement,
	type skill as SkillTable,
	type employeeSkill as EmployeeSkillTable,
	type subareaSkillRequirement as SubareaSkillReqTable,
	type shiftTemplateSkillRequirement as TemplateSkillReqTable,
	type skillRequirementOverride as OverrideTable,
} from "@/db/schema";
import { type DatabaseError, NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";

// Type definitions
type Skill = typeof SkillTable.$inferSelect;
type EmployeeSkill = typeof EmployeeSkillTable.$inferSelect;
type SubareaSkillReq = typeof SubareaSkillReqTable.$inferSelect;
type TemplateSkillReq = typeof TemplateSkillReqTable.$inferSelect;
type SkillOverride = typeof OverrideTable.$inferSelect;

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
	employeeId: string;
	skillId: string;
	expiresAt?: Date;
	notes?: string;
	assignedBy: string;
}

export interface SetSkillRequirementsInput {
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

export class SkillService extends Context.Tag("SkillService")<
	SkillService,
	{
		// Skill catalog operations
		readonly createSkill: (
			input: CreateSkillInput,
		) => Effect.Effect<Skill, ValidationError | DatabaseError>;

		readonly updateSkill: (
			id: string,
			input: UpdateSkillInput,
		) => Effect.Effect<Skill, NotFoundError | ValidationError | DatabaseError>;

		readonly deleteSkill: (id: string) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly getOrganizationSkills: (
			organizationId: string,
			options?: { includeInactive?: boolean },
		) => Effect.Effect<SkillWithRelations[], DatabaseError>;

		readonly getSkillById: (id: string) => Effect.Effect<Skill | null, DatabaseError>;

		// Employee skill assignments
		readonly assignSkillToEmployee: (
			input: AssignSkillInput,
		) => Effect.Effect<EmployeeSkill, ValidationError | NotFoundError | DatabaseError>;

		readonly removeSkillFromEmployee: (
			employeeId: string,
			skillId: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

		readonly getEmployeeSkills: (
			employeeId: string,
		) => Effect.Effect<EmployeeSkillWithDetails[], DatabaseError>;

		readonly getQualifiedEmployeesForSkills: (
			organizationId: string,
			skillIds: string[],
		) => Effect.Effect<string[], DatabaseError>;

		// Subarea skill requirements
		readonly setSubareaSkillRequirements: (
			input: SetSkillRequirementsInput,
		) => Effect.Effect<SubareaSkillReq[], NotFoundError | DatabaseError>;

		readonly getSubareaSkillRequirements: (
			subareaId: string,
		) => Effect.Effect<Array<SubareaSkillReq & { skill: Skill }>, DatabaseError>;

		// Template skill requirements
		readonly setTemplateSkillRequirements: (
			input: SetSkillRequirementsInput,
		) => Effect.Effect<TemplateSkillReq[], NotFoundError | DatabaseError>;

		readonly getTemplateSkillRequirements: (
			templateId: string,
		) => Effect.Effect<Array<TemplateSkillReq & { skill: Skill }>, DatabaseError>;

		// Validation
		readonly validateEmployeeForShift: (
			employeeId: string,
			shiftData: {
				subareaId: string;
				templateId?: string | null;
			},
		) => Effect.Effect<SkillValidationResult, DatabaseError>;

		readonly validateEmployeeForSubarea: (
			employeeId: string,
			subareaId: string,
		) => Effect.Effect<SkillValidationResult, DatabaseError>;

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
>() {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const SkillServiceLive = Layer.effect(
	SkillService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return SkillService.of({
			// ----------------------------------------
			// Skill catalog operations
			// ----------------------------------------
			createSkill: (input) =>
				Effect.gen(function* (_) {
					// Validate custom category
					if (input.category === "custom" && !input.customCategoryName) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Custom category name is required when category is 'custom'",
									field: "customCategoryName",
								}),
							),
						);
					}

					const createdSkill = yield* _(
						dbService.query("createSkill", async () => {
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
						}),
					);

					return createdSkill;
				}),

			updateSkill: (id, input) =>
				Effect.gen(function* (_) {
					// Verify skill exists
					const existing = yield* _(
						dbService.query("getSkillById", async () => {
							return await dbService.db.query.skill.findFirst({
								where: eq(skill.id, id),
							});
						}),
					);

					if (!existing) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Skill not found",
									entityType: "skill",
									entityId: id,
								}),
							),
						);
					}

					// Validate custom category
					const newCategory = input.category ?? existing!.category;
					if (newCategory === "custom" && !input.customCategoryName && !existing!.customCategoryName) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Custom category name is required when category is 'custom'",
									field: "customCategoryName",
								}),
							),
						);
					}

					const updatedSkill = yield* _(
						dbService.query("updateSkill", async () => {
							const [updated] = await dbService.db
								.update(skill)
								.set({
									...(input.name !== undefined && { name: input.name }),
									...(input.description !== undefined && { description: input.description }),
									...(input.category !== undefined && { category: input.category }),
									...(input.customCategoryName !== undefined && {
										customCategoryName: input.customCategoryName,
									}),
									...(input.requiresExpiry !== undefined && { requiresExpiry: input.requiresExpiry }),
									...(input.isActive !== undefined && { isActive: input.isActive }),
									updatedBy: input.updatedBy,
								})
								.where(eq(skill.id, id))
								.returning();
							return updated;
						}),
					);

					return updatedSkill;
				}),

			deleteSkill: (id) =>
				Effect.gen(function* (_) {
					const existing = yield* _(
						dbService.query("getSkillById", async () => {
							return await dbService.db.query.skill.findFirst({
								where: eq(skill.id, id),
							});
						}),
					);

					if (!existing) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Skill not found",
									entityType: "skill",
									entityId: id,
								}),
							),
						);
					}

					// Soft delete by setting isActive to false
					yield* _(
						dbService.query("softDeleteSkill", async () => {
							await dbService.db.update(skill).set({ isActive: false }).where(eq(skill.id, id));
						}),
					);
				}),

			getOrganizationSkills: (organizationId, options) =>
				Effect.gen(function* (_) {
					const skills = yield* _(
						dbService.query("getOrganizationSkills", async () => {
							const conditions = [eq(skill.organizationId, organizationId)];

							if (!options?.includeInactive) {
								conditions.push(eq(skill.isActive, true));
							}

							return await dbService.db.query.skill.findMany({
								where: and(...conditions),
								orderBy: (skill, { asc }) => [asc(skill.category), asc(skill.name)],
							});
						}),
					);

					return skills as SkillWithRelations[];
				}),

			getSkillById: (id) =>
				Effect.gen(function* (_) {
					const result = yield* _(
						dbService.query("getSkillById", async () => {
							return await dbService.db.query.skill.findFirst({
								where: eq(skill.id, id),
							});
						}),
					);

					return result ?? null;
				}),

			// ----------------------------------------
			// Employee skill assignments
			// ----------------------------------------
			assignSkillToEmployee: (input) =>
				Effect.gen(function* (_) {
					// Verify employee exists
					const employeeRecord = yield* _(
						dbService.query("verifyEmployeeExists", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, input.employeeId),
							});
						}),
					);

					if (!employeeRecord) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee not found",
									entityType: "employee",
									entityId: input.employeeId,
								}),
							),
						);
					}

					// Verify skill exists and is active
					const skillRecord = yield* _(
						dbService.query("verifySkillExists", async () => {
							return await dbService.db.query.skill.findFirst({
								where: and(eq(skill.id, input.skillId), eq(skill.isActive, true)),
							});
						}),
					);

					if (!skillRecord) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Skill not found or inactive",
									entityType: "skill",
									entityId: input.skillId,
								}),
							),
						);
					}

					// Validate expiry if skill requires it
					if (skillRecord!.requiresExpiry && !input.expiresAt) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "This skill requires an expiry date",
									field: "expiresAt",
								}),
							),
						);
					}

					// Upsert (update if exists, insert if not)
					const assignment = yield* _(
						dbService.query("assignSkillToEmployee", async () => {
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
						}),
					);

					return assignment;
				}),

			removeSkillFromEmployee: (employeeId, skillId) =>
				Effect.gen(function* (_) {
					const existing = yield* _(
						dbService.query("getEmployeeSkill", async () => {
							return await dbService.db.query.employeeSkill.findFirst({
								where: and(
									eq(employeeSkill.employeeId, employeeId),
									eq(employeeSkill.skillId, skillId),
								),
							});
						}),
					);

					if (!existing) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee skill assignment not found",
									entityType: "employeeSkill",
									entityId: `${employeeId}:${skillId}`,
								}),
							),
						);
					}

					yield* _(
						dbService.query("removeSkillFromEmployee", async () => {
							await dbService.db
								.delete(employeeSkill)
								.where(
									and(eq(employeeSkill.employeeId, employeeId), eq(employeeSkill.skillId, skillId)),
								);
						}),
					);
				}),

			getEmployeeSkills: (employeeId) =>
				Effect.gen(function* (_) {
					const skills = yield* _(
						dbService.query("getEmployeeSkills", async () => {
							return await dbService.db.query.employeeSkill.findMany({
								where: eq(employeeSkill.employeeId, employeeId),
								with: {
									skill: true,
								},
							});
						}),
					);

					return skills as EmployeeSkillWithDetails[];
				}),

			getQualifiedEmployeesForSkills: (organizationId, skillIds) =>
				Effect.gen(function* (_) {
					if (skillIds.length === 0) {
						// No skills required = all employees qualify
						const allEmployees = yield* _(
							dbService.query("getAllEmployees", async () => {
								return await dbService.db.query.employee.findMany({
									where: eq(employee.organizationId, organizationId),
									columns: { id: true },
								});
							}),
						);
						return allEmployees.map((e) => e.id);
					}

					const qualifiedEmployees = yield* _(
						dbService.query("getQualifiedEmployees", async () => {
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
								},
							});

							// Group by employee and check they have ALL required skills
							const employeeSkillCounts = new Map<string, number>();
							for (const es of employeeSkills) {
								if (es.employee.organizationId === organizationId) {
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
						}),
					);

					return qualifiedEmployees;
				}),

			// ----------------------------------------
			// Subarea skill requirements
			// ----------------------------------------
			setSubareaSkillRequirements: (input) =>
				Effect.gen(function* (_) {
					// Verify subarea exists
					const subareaRecord = yield* _(
						dbService.query("verifySubareaExists", async () => {
							return await dbService.db.query.locationSubarea.findFirst({
								where: eq(locationSubarea.id, input.targetId),
							});
						}),
					);

					if (!subareaRecord) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Subarea not found",
									entityType: "locationSubarea",
									entityId: input.targetId,
								}),
							),
						);
					}

					// Delete existing requirements and insert new ones
					const requirements = yield* _(
						dbService.query("setSubareaSkillRequirements", async () => {
							// Delete existing
							await dbService.db
								.delete(subareaSkillRequirement)
								.where(eq(subareaSkillRequirement.subareaId, input.targetId));

							if (input.requirements.length === 0) {
								return [];
							}

							// Insert new requirements
							const values = input.requirements.map((req) => ({
								subareaId: input.targetId,
								skillId: req.skillId,
								isRequired: req.isRequired,
								createdBy: input.createdBy,
							}));

							return await dbService.db.insert(subareaSkillRequirement).values(values).returning();
						}),
					);

					return requirements;
				}),

			getSubareaSkillRequirements: (subareaId) =>
				Effect.gen(function* (_) {
					const requirements = yield* _(
						dbService.query("getSubareaSkillRequirements", async () => {
							return await dbService.db.query.subareaSkillRequirement.findMany({
								where: eq(subareaSkillRequirement.subareaId, subareaId),
								with: {
									skill: true,
								},
							});
						}),
					);

					return requirements as Array<SubareaSkillReq & { skill: Skill }>;
				}),

			// ----------------------------------------
			// Template skill requirements
			// ----------------------------------------
			setTemplateSkillRequirements: (input) =>
				Effect.gen(function* (_) {
					// Verify template exists
					const templateRecord = yield* _(
						dbService.query("verifyTemplateExists", async () => {
							return await dbService.db.query.shiftTemplate.findFirst({
								where: eq(shiftTemplate.id, input.targetId),
							});
						}),
					);

					if (!templateRecord) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Shift template not found",
									entityType: "shiftTemplate",
									entityId: input.targetId,
								}),
							),
						);
					}

					// Delete existing requirements and insert new ones
					const requirements = yield* _(
						dbService.query("setTemplateSkillRequirements", async () => {
							// Delete existing
							await dbService.db
								.delete(shiftTemplateSkillRequirement)
								.where(eq(shiftTemplateSkillRequirement.templateId, input.targetId));

							if (input.requirements.length === 0) {
								return [];
							}

							// Insert new requirements
							const values = input.requirements.map((req) => ({
								templateId: input.targetId,
								skillId: req.skillId,
								isRequired: req.isRequired,
								createdBy: input.createdBy,
							}));

							return await dbService.db
								.insert(shiftTemplateSkillRequirement)
								.values(values)
								.returning();
						}),
					);

					return requirements;
				}),

			getTemplateSkillRequirements: (templateId) =>
				Effect.gen(function* (_) {
					const requirements = yield* _(
						dbService.query("getTemplateSkillRequirements", async () => {
							return await dbService.db.query.shiftTemplateSkillRequirement.findMany({
								where: eq(shiftTemplateSkillRequirement.templateId, templateId),
								with: {
									skill: true,
								},
							});
						}),
					);

					return requirements as Array<TemplateSkillReq & { skill: Skill }>;
				}),

			// ----------------------------------------
			// Validation
			// ----------------------------------------
			validateEmployeeForShift: (employeeId, shiftData) =>
				Effect.gen(function* (_) {
					const now = new Date();

					// Get employee's current valid skills
					const employeeSkills = yield* _(
						dbService.query("getEmployeeValidSkills", async () => {
							return await dbService.db.query.employeeSkill.findMany({
								where: and(
									eq(employeeSkill.employeeId, employeeId),
									or(isNull(employeeSkill.expiresAt), gt(employeeSkill.expiresAt, now)),
								),
								with: {
									skill: true,
								},
							});
						}),
					);

					// Get expired skills (for warning)
					const expiredSkills = yield* _(
						dbService.query("getExpiredSkills", async () => {
							return await dbService.db.query.employeeSkill.findMany({
								where: and(
									eq(employeeSkill.employeeId, employeeId),
									lte(employeeSkill.expiresAt, now),
								),
								with: {
									skill: true,
								},
							});
						}),
					);

					const validSkillIds = new Set(employeeSkills.map((es) => es.skillId));

					// Get subarea requirements
					const subareaReqs = yield* _(
						dbService.query("getSubareaRequirements", async () => {
							return await dbService.db.query.subareaSkillRequirement.findMany({
								where: eq(subareaSkillRequirement.subareaId, shiftData.subareaId),
								with: {
									skill: true,
								},
							});
						}),
					);

					// Get template requirements if applicable
					let templateReqs: Array<{ skillId: string; isRequired: boolean; skill: Skill }> = [];
					if (shiftData.templateId) {
						templateReqs = yield* _(
							dbService.query("getTemplateRequirements", async () => {
								return await dbService.db.query.shiftTemplateSkillRequirement.findMany({
									where: eq(shiftTemplateSkillRequirement.templateId, shiftData.templateId!),
									with: {
										skill: true,
									},
								});
							}),
						);
					}

					// Combine all requirements (deduped by skillId, taking most restrictive isRequired)
					const allRequirements = new Map<
						string,
						{ skill: Skill; isRequired: boolean }
					>();

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
					const expiredSkillsResult: SkillValidationResult["expiredSkills"] = expiredSkills
						.filter((es) => allRequirements.has(es.skillId))
						.map((es) => ({
							id: es.skillId,
							name: es.skill.name,
							expiresAt: es.expiresAt!,
						}));

					const hasRequiredMissing = missingSkills.some((s) => s.isRequired);

					return {
						isQualified: !hasRequiredMissing && expiredSkillsResult.length === 0,
						missingSkills,
						expiredSkills: expiredSkillsResult,
					};
				}),

			validateEmployeeForSubarea: (employeeId, subareaId) =>
				Effect.gen(function* (_) {
					const now = new Date();

					// Get employee's current valid skills
					const validEmployeeSkills = yield* _(
						dbService.query("getEmployeeValidSkillsForSubarea", async () => {
							return await dbService.db.query.employeeSkill.findMany({
								where: and(
									eq(employeeSkill.employeeId, employeeId),
									or(isNull(employeeSkill.expiresAt), gt(employeeSkill.expiresAt, now)),
								),
								with: { skill: true },
							});
						}),
					);

					// Get expired skills
					const expiredSkillsData = yield* _(
						dbService.query("getExpiredSkillsForSubarea", async () => {
							return await dbService.db.query.employeeSkill.findMany({
								where: and(
									eq(employeeSkill.employeeId, employeeId),
									lte(employeeSkill.expiresAt, now),
								),
								with: { skill: true },
							});
						}),
					);

					const validSkillIds = new Set(validEmployeeSkills.map((es) => es.skillId));

					// Get subarea requirements only
					const subareaReqs = yield* _(
						dbService.query("getSubareaRequirementsOnly", async () => {
							return await dbService.db.query.subareaSkillRequirement.findMany({
								where: eq(subareaSkillRequirement.subareaId, subareaId),
								with: { skill: true },
							});
						}),
					);

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
					const expiredSkillsResult: SkillValidationResult["expiredSkills"] = expiredSkillsData
						.filter((es) => requiredSkillIds.has(es.skillId))
						.map((es) => ({
							id: es.skillId,
							name: es.skill.name,
							expiresAt: es.expiresAt!,
						}));

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
				Effect.gen(function* (_) {
					if (input.missingSkillIds.length === 0) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "At least one missing skill ID is required",
									field: "missingSkillIds",
								}),
							),
						);
					}

					if (!input.overrideReason.trim()) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Override reason is required",
									field: "overrideReason",
								}),
							),
						);
					}

					const override = yield* _(
						dbService.query("recordOverride", async () => {
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
						}),
					);

					return override;
				}),

			getOverrideHistory: (organizationId, options) =>
				Effect.gen(function* (_) {
					const overrides = yield* _(
						dbService.query("getOverrideHistory", async () => {
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

							return results;
						}),
					);

					// Resolve skill names for missing skills
					const allSkillIds = new Set<string>();
					for (const o of overrides) {
						const ids = JSON.parse(o.missingSkillIds) as string[];
						for (const id of ids) {
							allSkillIds.add(id);
						}
					}

					const skillNames = yield* _(
						dbService.query("getSkillNames", async () => {
							if (allSkillIds.size === 0) return new Map<string, string>();

							const skills = await dbService.db.query.skill.findMany({
								where: inArray(skill.id, Array.from(allSkillIds)),
								columns: { id: true, name: true },
							});

							return new Map(skills.map((s) => [s.id, s.name]));
						}),
					);

					return overrides.map((o) => ({
						...o,
						missingSkillNames: (JSON.parse(o.missingSkillIds) as string[]).map(
							(id) => skillNames.get(id) ?? "Unknown Skill",
						),
					})) as OverrideHistoryEntry[];
				}),
		});
	}),
);
