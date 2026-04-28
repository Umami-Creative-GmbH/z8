import { and, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import {
	type employeeSkill as EmployeeSkillTable,
	employee,
	employeeSkill,
	locationSubarea,
	type skillRequirementOverride as OverrideTable,
	type qualificationRenewalRequest as QualificationRenewalRequestTable,
	qualificationEvidence,
	qualificationRenewalRequest,
	qualificationRenewalRequestEvidence,
	type skill as SkillTable,
	type subareaSkillRequirement as SubareaSkillReqTable,
	shiftTemplate,
	shiftTemplateSkillRequirement,
	skill,
	skillRequirementOverride,
	subareaSkillRequirement,
	type shiftTemplateSkillRequirement as TemplateSkillReqTable,
} from "@/db/schema";
import { getQualificationStatus, mergeRequirementMode } from "@/lib/qualifications/status";
import { type DatabaseError, NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";

// Type definitions
type Skill = typeof SkillTable.$inferSelect;
type EmployeeSkill = typeof EmployeeSkillTable.$inferSelect;
export type QualificationRenewalRequestRecord =
	typeof QualificationRenewalRequestTable.$inferSelect;
type SubareaSkillReq = typeof SubareaSkillReqTable.$inferSelect;
type TemplateSkillReq = typeof TemplateSkillReqTable.$inferSelect;
type SkillOverride = typeof OverrideTable.$inferSelect;

type SkillCategory = "safety" | "equipment" | "certification" | "training" | "language" | "custom";

export function getQualificationExpiryBoundary(now = new Date()): Date {
	return DateTime.fromJSDate(now, { zone: "utc" }).startOf("day").toJSDate();
}

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
	expiryWarningDays?: number;
	createdBy: string;
}

export interface UpdateSkillInput {
	organizationId: string;
	name?: string;
	description?: string;
	category?: SkillCategory;
	customCategoryName?: string;
	requiresExpiry?: boolean;
	expiryWarningDays?: number;
	isActive?: boolean;
	updatedBy: string;
}

export interface AssignSkillInput {
	organizationId: string;
	employeeId: string;
	skillId: string;
	issuedAt?: Date;
	expiresAt?: Date;
	issuer?: string;
	certificateNumber?: string;
	notes?: string;
	assignedBy: string;
}

export interface SetSkillRequirementsInput {
	targetId: string; // subareaId or templateId
	requirements: Array<{
		skillId: string;
		isRequired: boolean;
		enforcementMode?: "warning" | "blocking";
		blockOnExpiringSoon?: boolean;
	}>;
	createdBy: string;
}

export interface QualificationEvidenceRecord {
	id: string;
	employeeSkillId: string;
	fileName: string;
	mimeType: string;
	fileSize: number;
	fileKey: string;
	createdAt: Date;
}

export interface CreateRenewalRequestInput {
	organizationId: string;
	employeeId: string;
	employeeSkillId: string;
	evidenceIds: string[];
	requestedIssuedAt?: Date;
	requestedExpiresAt?: Date;
	requestedIssuer?: string;
	requestedCertificateNumber?: string;
	notes?: string;
}

export interface ReviewRenewalRequestInput {
	organizationId: string;
	requestId: string;
	reviewerEmployeeId: string;
	approved: boolean;
	reviewNotes?: string;
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

export interface QualificationRenewalRequestWithDetails extends QualificationRenewalRequestRecord {
	employee: Pick<typeof employee.$inferSelect, "id" | "firstName" | "lastName" | "email">;
	employeeSkill: Pick<EmployeeSkill, "id"> & {
		skill: Pick<Skill, "id" | "name">;
	};
	evidenceLinks: Array<{
		id: string;
		evidence: Pick<QualificationEvidenceRecord, "id" | "fileName" | "mimeType" | "fileSize">;
	}>;
}

export interface SkillValidationResult {
	isQualified: boolean;
	hasBlockingIssues: boolean;
	requiresOverride: boolean;
	issues: Array<{
		id: string;
		name: string;
		category: SkillCategory;
		isRequired: boolean;
		enforcementMode: "warning" | "blocking";
		issueType: "missing" | "expired" | "expiringSoon" | "preferred";
		expiresAt?: Date;
	}>;
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

		readonly deleteSkill: (
			id: string,
			organizationId: string,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;

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

		readonly createRenewalRequest: (
			input: CreateRenewalRequestInput,
		) => Effect.Effect<
			QualificationRenewalRequestRecord,
			ValidationError | NotFoundError | DatabaseError
		>;

		readonly reviewRenewalRequest: (
			input: ReviewRenewalRequestInput,
		) => Effect.Effect<
			QualificationRenewalRequestRecord,
			ValidationError | NotFoundError | DatabaseError
		>;

		readonly getPendingRenewalRequests: (
			organizationId: string,
		) => Effect.Effect<QualificationRenewalRequestWithDetails[], DatabaseError>;

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
									expiryWarningDays: input.expiryWarningDays ?? 30,
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
								where: and(eq(skill.id, id), eq(skill.organizationId, input.organizationId)),
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
					if (
						newCategory === "custom" &&
						!input.customCategoryName &&
						!existing!.customCategoryName
					) {
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
									...(input.requiresExpiry !== undefined && {
										requiresExpiry: input.requiresExpiry,
									}),
									...(input.expiryWarningDays !== undefined && {
										expiryWarningDays: input.expiryWarningDays,
									}),
									...(input.isActive !== undefined && { isActive: input.isActive }),
									updatedBy: input.updatedBy,
								})
								.where(and(eq(skill.id, id), eq(skill.organizationId, input.organizationId)))
								.returning();
							return updated;
						}),
					);

					if (!updatedSkill) {
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

					return updatedSkill;
				}),

			deleteSkill: (id, organizationId) =>
				Effect.gen(function* (_) {
					const existing = yield* _(
						dbService.query("getSkillById", async () => {
							return await dbService.db.query.skill.findFirst({
								where: and(eq(skill.id, id), eq(skill.organizationId, organizationId)),
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
							await dbService.db
								.update(skill)
								.set({ isActive: false })
								.where(and(eq(skill.id, id), eq(skill.organizationId, organizationId)));
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
								where: and(
									eq(employee.id, input.employeeId),
									eq(employee.organizationId, input.organizationId),
								),
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
								where: and(
									eq(skill.id, input.skillId),
									eq(skill.organizationId, input.organizationId),
									eq(skill.isActive, true),
								),
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
									issuedAt: input.issuedAt,
									expiresAt: input.expiresAt,
									issuer: input.issuer,
									certificateNumber: input.certificateNumber,
									status: "active" as const,
									renewedAt: new Date(),
									renewedBy: input.assignedBy,
									notes: input.notes,
									assignedBy: input.assignedBy,
								})
								.onConflictDoUpdate({
									target: [employeeSkill.employeeId, employeeSkill.skillId],
									set: {
										issuedAt: input.issuedAt,
										expiresAt: input.expiresAt,
										issuer: input.issuer,
										certificateNumber: input.certificateNumber,
										status: "active" as const,
										renewedAt: new Date(),
										renewedBy: input.assignedBy,
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

			createRenewalRequest: (input) =>
				Effect.gen(function* (_) {
					const assignment = yield* _(
						dbService.query("getEmployeeSkillForRenewal", async () => {
							return await dbService.db.query.employeeSkill.findFirst({
								where: and(
									eq(employeeSkill.id, input.employeeSkillId),
									eq(employeeSkill.employeeId, input.employeeId),
								),
								with: { employee: true, skill: true },
							});
						}),
					);

					if (
						!assignment ||
						assignment.employee.organizationId !== input.organizationId ||
						assignment.skill.organizationId !== input.organizationId
					) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Qualification not found",
									entityType: "employeeSkill",
									entityId: input.employeeSkillId,
								}),
							),
						);
					}

					if (assignment!.skill.requiresExpiry && !input.requestedExpiresAt) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "This qualification requires an expiry date",
									field: "requestedExpiresAt",
								}),
							),
						);
					}

					if (input.evidenceIds.length === 0) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "At least one evidence file is required",
									field: "evidenceIds",
								}),
							),
						);
					}

					const evidenceIds = Array.from(new Set(input.evidenceIds));
					const evidenceRecords = yield* _(
						dbService.query("getQualificationRenewalEvidence", async () => {
							return await dbService.db.query.qualificationEvidence.findMany({
								where: and(
									inArray(qualificationEvidence.id, evidenceIds),
									eq(qualificationEvidence.organizationId, input.organizationId),
									eq(qualificationEvidence.employeeSkillId, input.employeeSkillId),
								),
							});
						}),
					);

					if (evidenceRecords.length !== evidenceIds.length) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Evidence files must belong to this qualification",
									field: "evidenceIds",
								}),
							),
						);
					}

					return yield* _(
						dbService.query("createQualificationRenewalRequest", async () => {
							return await dbService.db.transaction(async (tx) => {
								const [request] = await tx
									.insert(qualificationRenewalRequest)
									.values({
										organizationId: input.organizationId,
										employeeId: input.employeeId,
										employeeSkillId: input.employeeSkillId,
										requestedIssuedAt: input.requestedIssuedAt,
										requestedExpiresAt: input.requestedExpiresAt,
										requestedIssuer: input.requestedIssuer,
										requestedCertificateNumber: input.requestedCertificateNumber,
										notes: input.notes,
									})
									.returning();

								await tx.insert(qualificationRenewalRequestEvidence).values(
									evidenceIds.map((evidenceId) => ({
										organizationId: input.organizationId,
										renewalRequestId: request!.id,
										evidenceId,
									})),
								);

								return request!;
							});
						}),
					);
				}),

			reviewRenewalRequest: (input) =>
				Effect.gen(function* (_) {
					const request = yield* _(
						dbService.query("getQualificationRenewalRequest", async () => {
							return await dbService.db.query.qualificationRenewalRequest.findFirst({
								where: and(
									eq(qualificationRenewalRequest.id, input.requestId),
									eq(qualificationRenewalRequest.organizationId, input.organizationId),
								),
							});
						}),
					);

					if (!request || request.organizationId !== input.organizationId) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Renewal request not found",
									entityType: "qualificationRenewalRequest",
									entityId: input.requestId,
								}),
							),
						);
					}

					if (request!.status !== "pending") {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Renewal request has already been reviewed",
									field: "status",
								}),
							),
						);
					}

					const reviewer = yield* _(
						dbService.query("getQualificationRenewalReviewer", async () => {
							return await dbService.db.query.employee.findFirst({
								where: and(
									eq(employee.id, input.reviewerEmployeeId),
									eq(employee.organizationId, input.organizationId),
								),
							});
						}),
					);

					if (!reviewer || reviewer.organizationId !== input.organizationId) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Reviewer not found",
									entityType: "employee",
									entityId: input.reviewerEmployeeId,
								}),
							),
						);
					}

					const currentQualification = input.approved
						? yield* _(
								dbService.query("getQualificationForRenewalApproval", async () => {
									return await dbService.db.query.employeeSkill.findFirst({
										where: and(
											eq(employeeSkill.id, request!.employeeSkillId),
											eq(employeeSkill.employeeId, request!.employeeId),
										),
									});
								}),
							)
						: null;

					if (input.approved && !currentQualification) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee qualification not found",
									entityType: "employeeSkill",
									entityId: request!.employeeSkillId,
								}),
							),
						);
					}

					const updatedRequest = yield* _(
						dbService.query("reviewQualificationRenewalRequest", async () => {
							return await dbService.db.transaction(async (tx) => {
								const [updated] = await tx
									.update(qualificationRenewalRequest)
									.set({
										status: input.approved ? "approved" : "rejected",
										reviewerId: input.reviewerEmployeeId,
										reviewedAt: new Date(),
										reviewNotes: input.reviewNotes,
									})
									.where(
										and(
											eq(qualificationRenewalRequest.id, input.requestId),
											eq(qualificationRenewalRequest.status, "pending"),
											eq(qualificationRenewalRequest.organizationId, input.organizationId),
										),
									)
									.returning();

								if (!updated) {
									return null;
								}

								if (input.approved) {
									const [qualification] = await tx
										.update(employeeSkill)
										.set({
											issuedAt: request!.requestedIssuedAt ?? currentQualification!.issuedAt,
											expiresAt: request!.requestedExpiresAt ?? currentQualification!.expiresAt,
											issuer: request!.requestedIssuer ?? currentQualification!.issuer,
											certificateNumber:
												request!.requestedCertificateNumber ??
												currentQualification!.certificateNumber,
											status: "active" as const,
											renewedAt: new Date(),
											renewedBy: reviewer!.userId,
										})
										.where(
											and(
												eq(employeeSkill.id, request!.employeeSkillId),
												eq(employeeSkill.employeeId, request!.employeeId),
											),
										)
										.returning();

									if (!qualification) {
										throw new Error("Employee qualification was not updated");
									}
								}

								return updated;
							});
						}),
					);

					if (!updatedRequest) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Renewal request has already been reviewed",
									field: "status",
								}),
							),
						);
					}

					return updatedRequest!;
				}),

			getPendingRenewalRequests: (organizationId) =>
				Effect.gen(function* (_) {
					return yield* _(
						dbService.query("getPendingQualificationRenewalRequests", async () => {
							return await dbService.db.query.qualificationRenewalRequest.findMany({
								where: and(
									eq(qualificationRenewalRequest.organizationId, organizationId),
									eq(qualificationRenewalRequest.status, "pending"),
								),
								with: {
									employee: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
											email: true,
										},
									},
									employeeSkill: {
										columns: {
											id: true,
										},
										with: {
											skill: {
												columns: {
													id: true,
													name: true,
												},
											},
										},
									},
									evidenceLinks: {
										columns: {
											id: true,
										},
										with: {
											evidence: {
												columns: {
													id: true,
													fileName: true,
													mimeType: true,
													fileSize: true,
												},
											},
										},
									},
								},
								orderBy: (table, { asc }) => [asc(table.createdAt)],
							});
						}),
					);
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
							const expiryBoundary = getQualificationExpiryBoundary();

							// Find employees with valid (non-expired) assignments for ALL required skills
							const employeeSkills = await dbService.db.query.employeeSkill.findMany({
								where: and(
									inArray(employeeSkill.skillId, skillIds),
									or(isNull(employeeSkill.expiresAt), gte(employeeSkill.expiresAt, expiryBoundary)),
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
								enforcementMode: req.enforcementMode ?? "warning",
								blockOnExpiringSoon: req.blockOnExpiringSoon ?? false,
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
								enforcementMode: req.enforcementMode ?? "warning",
								blockOnExpiringSoon: req.blockOnExpiringSoon ?? false,
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
					const expiryBoundary = getQualificationExpiryBoundary();

					// Get employee's current valid skills
					const employeeSkills = yield* _(
						dbService.query("getEmployeeValidSkills", async () => {
							return await dbService.db.query.employeeSkill.findMany({
								where: and(
									eq(employeeSkill.employeeId, employeeId),
									or(isNull(employeeSkill.expiresAt), gte(employeeSkill.expiresAt, expiryBoundary)),
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
									lt(employeeSkill.expiresAt, expiryBoundary),
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
					let templateReqs: Array<{
						skillId: string;
						isRequired: boolean;
						enforcementMode: "warning" | "blocking";
						blockOnExpiringSoon: boolean;
						skill: Skill;
					}> = [];
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

					// Combine all requirements (deduped by skillId, taking most restrictive settings)
					const allRequirements = new Map<
						string,
						{
							skill: Skill;
							isRequired: boolean;
							enforcementMode: "warning" | "blocking";
							blockOnExpiringSoon: boolean;
						}
					>();

					for (const req of [...subareaReqs, ...templateReqs]) {
						const existing = allRequirements.get(req.skillId);
						const enforcementMode = req.enforcementMode ?? "warning";
						const blockOnExpiringSoon = req.blockOnExpiringSoon ?? false;

						if (!existing) {
							allRequirements.set(req.skillId, {
								skill: req.skill,
								isRequired: req.isRequired,
								enforcementMode,
								blockOnExpiringSoon,
							});
							continue;
						}

						allRequirements.set(req.skillId, {
							skill: existing.skill,
							isRequired: existing.isRequired || req.isRequired,
							enforcementMode:
								existing.isRequired && req.isRequired
									? mergeRequirementMode(existing.enforcementMode, enforcementMode)
									: req.isRequired && !existing.isRequired
										? enforcementMode
										: existing.enforcementMode,
							blockOnExpiringSoon: existing.blockOnExpiringSoon || blockOnExpiringSoon,
						});
					}

					// Find missing skills
					const missingSkills: SkillValidationResult["missingSkills"] = [];
					const issues: SkillValidationResult["issues"] = [];
					for (const [skillId, requirement] of allRequirements) {
						const { skill: skillData, isRequired, enforcementMode } = requirement;
						if (!validSkillIds.has(skillId)) {
							missingSkills.push({
								id: skillId,
								name: skillData.name,
								category: skillData.category as SkillCategory,
								isRequired,
							});
							issues.push({
								id: skillId,
								name: skillData.name,
								category: skillData.category as SkillCategory,
								isRequired,
								enforcementMode,
								issueType: isRequired ? "missing" : "preferred",
							});
						}
					}

					// Map expired skills
					const expiredSkillsResult: SkillValidationResult["expiredSkills"] = expiredSkills
						.filter((es) => allRequirements.has(es.skillId))
						.map((es) => {
							const requirement = allRequirements.get(es.skillId)!;
							issues.push({
								id: es.skillId,
								name: es.skill.name,
								category: es.skill.category as SkillCategory,
								isRequired: requirement.isRequired,
								enforcementMode: requirement.enforcementMode,
								issueType: "expired",
								expiresAt: es.expiresAt!,
							});

							return {
							id: es.skillId,
							name: es.skill.name,
							expiresAt: es.expiresAt!,
							};
						});

					for (const employeeSkill of employeeSkills) {
						const requirement = allRequirements.get(employeeSkill.skillId);
						if (!requirement || !employeeSkill.expiresAt) continue;

						const status = getQualificationStatus({
							expiresAt: employeeSkill.expiresAt,
							warningDays: employeeSkill.skill.expiryWarningDays ?? 0,
						});
						if (status !== "expiringSoon") continue;

						issues.push({
							id: employeeSkill.skillId,
							name: employeeSkill.skill.name,
							category: employeeSkill.skill.category as SkillCategory,
							isRequired: requirement.isRequired,
							enforcementMode: requirement.blockOnExpiringSoon
								? requirement.enforcementMode
								: "warning",
							issueType: "expiringSoon",
							expiresAt: employeeSkill.expiresAt,
						});
					}

					const hasBlockingIssues = issues.some(
						(issue) => issue.enforcementMode === "blocking" && issue.isRequired,
					);
					const requiresOverride = issues.some(
						(issue) => issue.enforcementMode === "warning" && issue.isRequired,
					);

					return {
						isQualified: !hasBlockingIssues && !requiresOverride,
						hasBlockingIssues,
						requiresOverride,
						issues,
						missingSkills,
						expiredSkills: expiredSkillsResult,
					};
				}),

			validateEmployeeForSubarea: (employeeId, subareaId) =>
				Effect.gen(function* (_) {
					const expiryBoundary = getQualificationExpiryBoundary();

					// Get employee's current valid skills
					const validEmployeeSkills = yield* _(
						dbService.query("getEmployeeValidSkillsForSubarea", async () => {
							return await dbService.db.query.employeeSkill.findMany({
								where: and(
									eq(employeeSkill.employeeId, employeeId),
									or(isNull(employeeSkill.expiresAt), gte(employeeSkill.expiresAt, expiryBoundary)),
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
									lt(employeeSkill.expiresAt, expiryBoundary),
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
						hasBlockingIssues: false,
						requiresOverride: hasRequiredMissing || expiredSkillsResult.length > 0,
						issues: [],
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
