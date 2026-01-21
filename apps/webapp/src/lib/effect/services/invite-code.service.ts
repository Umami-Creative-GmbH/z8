import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { nanoid } from "nanoid";
import {
	inviteCode,
	inviteCodeUsage,
	memberApproval,
	type inviteCode as InviteCodeTable,
	type inviteCodeUsage as InviteCodeUsageTable,
	type memberApproval as MemberApprovalTable,
} from "@/db/schema";
import { member, organization, user } from "@/db/auth-schema";
import { team } from "@/db/schema";
import { type DatabaseError, NotFoundError, ValidationError, AuthorizationError } from "../errors";
import { DatabaseService } from "./database.service";

// Type definitions
type InviteCode = typeof InviteCodeTable.$inferSelect;
type InviteCodeUsage = typeof InviteCodeUsageTable.$inferSelect;
type MemberApproval = typeof MemberApprovalTable.$inferSelect;
type InviteCodeStatus = "active" | "paused" | "expired" | "archived";

export interface CreateInviteCodeInput {
	organizationId: string;
	code?: string; // Optional - will be auto-generated if not provided
	label: string;
	description?: string;
	maxUses?: number | null;
	expiresAt?: Date | null;
	defaultTeamId?: string | null;
	requiresApproval?: boolean;
	createdBy: string;
}

export interface UpdateInviteCodeInput {
	label?: string;
	description?: string | null;
	maxUses?: number | null;
	expiresAt?: Date | null;
	defaultTeamId?: string | null;
	requiresApproval?: boolean;
	status?: InviteCodeStatus;
	updatedBy: string;
}

export interface InviteCodeQuery {
	organizationId: string;
	status?: InviteCodeStatus;
	includeArchived?: boolean;
}

export interface InviteCodeWithRelations extends InviteCode {
	organization?: {
		id: string;
		name: string;
		slug: string;
	};
	defaultTeam?: {
		id: string;
		name: string;
	} | null;
	usages?: InviteCodeUsage[];
	_count?: {
		usages: number;
	};
}

export interface ValidateInviteCodeResult {
	valid: boolean;
	inviteCode?: InviteCodeWithRelations;
	error?: string;
}

export interface UseInviteCodeInput {
	code: string;
	userId: string;
	ipAddress?: string;
	userAgent?: string;
}

export interface UseInviteCodeResult {
	success: boolean;
	memberId?: string;
	status: "pending" | "approved";
	organizationId: string;
	organizationName: string;
	error?: string;
}

export class InviteCodeService extends Context.Tag("InviteCodeService")<
	InviteCodeService,
	{
		// CRUD operations
		readonly create: (
			input: CreateInviteCodeInput,
		) => Effect.Effect<InviteCode, ValidationError | DatabaseError>;

		readonly update: (
			id: string,
			input: UpdateInviteCodeInput,
		) => Effect.Effect<InviteCode, NotFoundError | ValidationError | DatabaseError>;

		readonly delete: (
			id: string,
			userId: string,
		) => Effect.Effect<void, NotFoundError | AuthorizationError | DatabaseError>;

		readonly getById: (
			id: string,
		) => Effect.Effect<InviteCodeWithRelations | null, DatabaseError>;

		readonly getByCode: (
			organizationId: string,
			code: string,
		) => Effect.Effect<InviteCodeWithRelations | null, DatabaseError>;

		readonly list: (
			query: InviteCodeQuery,
		) => Effect.Effect<InviteCodeWithRelations[], DatabaseError>;

		// Validation and usage
		readonly validateCode: (
			code: string,
		) => Effect.Effect<ValidateInviteCodeResult, DatabaseError>;

		readonly useCode: (
			input: UseInviteCodeInput,
		) => Effect.Effect<UseInviteCodeResult, ValidationError | NotFoundError | DatabaseError>;

		// Stats
		readonly getUsageStats: (
			inviteCodeId: string,
		) => Effect.Effect<
			{ total: number; pending: number; approved: number; rejected: number },
			NotFoundError | DatabaseError
		>;

		// Code generation
		readonly generateCode: () => Effect.Effect<string, never>;

		// Pending invite code methods (for registration flow)
		readonly setPendingInviteCode: (
			userId: string,
			code: string,
		) => Effect.Effect<void, NotFoundError | ValidationError | DatabaseError>;

		readonly processPendingInviteCode: (
			userId: string,
		) => Effect.Effect<UseInviteCodeResult | null, ValidationError | NotFoundError | DatabaseError>;

		readonly clearPendingInviteCode: (
			userId: string,
		) => Effect.Effect<void, DatabaseError>;

		readonly getPendingInviteCode: (
			userId: string,
		) => Effect.Effect<string | null, DatabaseError>;
	}
>() {}

export const InviteCodeServiceLive = Layer.effect(
	InviteCodeService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		// Helper to generate a human-readable code
		const generateReadableCode = (): string => {
			// Generate a code like "JOIN-ABC123" or "TEAM-XYZ789"
			const prefixes = ["JOIN", "TEAM", "HIRE", "WORK"];
			const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
			const suffix = nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, "X");
			return `${prefix}-${suffix}`;
		};

		// Helper to validate code format
		const isValidCodeFormat = (code: string): boolean => {
			// Allow 4-20 chars, alphanumeric and hyphens, uppercase
			const regex = /^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$/;
			return regex.test(code);
		};

		// Helper to check if code is expired or exhausted
		const isCodeUsable = (inviteCodeRecord: InviteCode): { usable: boolean; reason?: string } => {
			if (inviteCodeRecord.status !== "active") {
				return { usable: false, reason: `Code is ${inviteCodeRecord.status}` };
			}
			if (inviteCodeRecord.expiresAt && inviteCodeRecord.expiresAt < new Date()) {
				return { usable: false, reason: "Code has expired" };
			}
			if (
				inviteCodeRecord.maxUses !== null &&
				inviteCodeRecord.currentUses >= inviteCodeRecord.maxUses
			) {
				return { usable: false, reason: "Code has reached maximum uses" };
			}
			return { usable: true };
		};

		return InviteCodeService.of({
			create: (input) =>
				Effect.gen(function* (_) {
					// Generate or validate code
					const code = input.code?.toUpperCase() || generateReadableCode();

					if (!isValidCodeFormat(code)) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message:
										"Invalid code format. Must be 4-20 characters, alphanumeric and hyphens only.",
									field: "code",
								}),
							),
						);
					}

					// Check if code already exists for this organization
					const existing = yield* _(
						dbService.query("checkExistingCode", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: and(
									eq(inviteCode.organizationId, input.organizationId),
									eq(inviteCode.code, code),
								),
							});
						}),
					);

					if (existing) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "A code with this name already exists for this organization.",
									field: "code",
								}),
							),
						);
					}

					// Validate team exists if provided
					if (input.defaultTeamId) {
						const teamRecord = yield* _(
							dbService.query("validateTeam", async () => {
								return await dbService.db.query.team.findFirst({
									where: and(
										eq(team.id, input.defaultTeamId!),
										eq(team.organizationId, input.organizationId),
									),
								});
							}),
						);

						if (!teamRecord) {
							yield* _(
								Effect.fail(
									new ValidationError({
										message: "Invalid default team. Team not found in this organization.",
										field: "defaultTeamId",
									}),
								),
							);
						}
					}

					const createdCode = yield* _(
						dbService.query("createInviteCode", async () => {
							const [result] = await dbService.db
								.insert(inviteCode)
								.values({
									organizationId: input.organizationId,
									code,
									label: input.label,
									description: input.description,
									maxUses: input.maxUses,
									expiresAt: input.expiresAt,
									defaultTeamId: input.defaultTeamId,
									requiresApproval: input.requiresApproval ?? true,
									status: "active",
									createdBy: input.createdBy,
								})
								.returning();
							return result;
						}),
					);

					return createdCode;
				}),

			update: (id, input) =>
				Effect.gen(function* (_) {
					// Verify code exists
					const existing = yield* _(
						dbService.query("getInviteCodeById", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: eq(inviteCode.id, id),
							});
						}),
					);

					if (!existing) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Invite code not found",
									entityType: "inviteCode",
									entityId: id,
								}),
							),
						);
					}

					// Validate team if changing
					if (input.defaultTeamId !== undefined && input.defaultTeamId !== null) {
						const teamRecord = yield* _(
							dbService.query("validateTeam", async () => {
								return await dbService.db.query.team.findFirst({
									where: and(
										eq(team.id, input.defaultTeamId!),
										eq(team.organizationId, existing!.organizationId),
									),
								});
							}),
						);

						if (!teamRecord) {
							yield* _(
								Effect.fail(
									new ValidationError({
										message: "Invalid default team. Team not found in this organization.",
										field: "defaultTeamId",
									}),
								),
							);
						}
					}

					const updatedCode = yield* _(
						dbService.query("updateInviteCode", async () => {
							const [result] = await dbService.db
								.update(inviteCode)
								.set({
									...(input.label !== undefined && { label: input.label }),
									...(input.description !== undefined && { description: input.description }),
									...(input.maxUses !== undefined && { maxUses: input.maxUses }),
									...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
									...(input.defaultTeamId !== undefined && { defaultTeamId: input.defaultTeamId }),
									...(input.requiresApproval !== undefined && {
										requiresApproval: input.requiresApproval,
									}),
									...(input.status !== undefined && { status: input.status }),
									updatedBy: input.updatedBy,
								})
								.where(eq(inviteCode.id, id))
								.returning();
							return result;
						}),
					);

					return updatedCode;
				}),

			delete: (id, userId) =>
				Effect.gen(function* (_) {
					const existing = yield* _(
						dbService.query("getInviteCodeById", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: eq(inviteCode.id, id),
							});
						}),
					);

					if (!existing) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Invite code not found",
									entityType: "inviteCode",
									entityId: id,
								}),
							),
						);
					}

					// Soft delete by archiving
					yield* _(
						dbService.query("archiveInviteCode", async () => {
							await dbService.db
								.update(inviteCode)
								.set({
									status: "archived",
									updatedBy: userId,
								})
								.where(eq(inviteCode.id, id));
						}),
					);
				}),

			getById: (id) =>
				Effect.gen(function* (_) {
					const result = yield* _(
						dbService.query("getInviteCodeById", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: eq(inviteCode.id, id),
								with: {
									organization: {
										columns: {
											id: true,
											name: true,
											slug: true,
										},
									},
									defaultTeam: {
										columns: {
											id: true,
											name: true,
										},
									},
								},
							});
						}),
					);

					return result as InviteCodeWithRelations | null;
				}),

			getByCode: (organizationId, code) =>
				Effect.gen(function* (_) {
					const result = yield* _(
						dbService.query("getInviteCodeByCode", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: and(
									eq(inviteCode.organizationId, organizationId),
									eq(inviteCode.code, code.toUpperCase()),
								),
								with: {
									organization: {
										columns: {
											id: true,
											name: true,
											slug: true,
										},
									},
									defaultTeam: {
										columns: {
											id: true,
											name: true,
										},
									},
								},
							});
						}),
					);

					return result as InviteCodeWithRelations | null;
				}),

			list: (query) =>
				Effect.gen(function* (_) {
					const results = yield* _(
						dbService.query("listInviteCodes", async () => {
							const conditions = [eq(inviteCode.organizationId, query.organizationId)];

							if (query.status) {
								conditions.push(eq(inviteCode.status, query.status));
							} else if (!query.includeArchived) {
								conditions.push(
									or(
										eq(inviteCode.status, "active"),
										eq(inviteCode.status, "paused"),
										eq(inviteCode.status, "expired"),
									)!,
								);
							}

							return await dbService.db.query.inviteCode.findMany({
								where: and(...conditions),
								with: {
									organization: {
										columns: {
											id: true,
											name: true,
											slug: true,
										},
									},
									defaultTeam: {
										columns: {
											id: true,
											name: true,
										},
									},
								},
								orderBy: [desc(inviteCode.createdAt)],
							});
						}),
					);

					return results as InviteCodeWithRelations[];
				}),

			validateCode: (code) =>
				Effect.gen(function* (_) {
					// Find the code across all organizations
					const result = yield* _(
						dbService.query("findInviteCode", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: eq(inviteCode.code, code.toUpperCase()),
								with: {
									organization: {
										columns: {
											id: true,
											name: true,
											slug: true,
										},
									},
									defaultTeam: {
										columns: {
											id: true,
											name: true,
										},
									},
								},
							});
						}),
					);

					if (!result) {
						return { valid: false, error: "Invalid invite code" };
					}

					const { usable, reason } = isCodeUsable(result);
					if (!usable) {
						return { valid: false, inviteCode: result as InviteCodeWithRelations, error: reason };
					}

					return { valid: true, inviteCode: result as InviteCodeWithRelations };
				}),

			useCode: (input) =>
				Effect.gen(function* (_) {
					// Validate the code first
					const validationResult = yield* _(
						dbService.query("findInviteCode", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: eq(inviteCode.code, input.code.toUpperCase()),
								with: {
									organization: {
										columns: {
											id: true,
											name: true,
											slug: true,
										},
									},
								},
							});
						}),
					);

					if (!validationResult) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Invalid invite code",
									entityType: "inviteCode",
									entityId: input.code,
								}),
							),
						);
					}

					const inviteCodeRecord = validationResult!;
					const { usable, reason } = isCodeUsable(inviteCodeRecord);

					if (!usable) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: reason || "Code is not usable",
									field: "code",
								}),
							),
						);
					}

					// Check if user is already a member of this organization
					const existingMember = yield* _(
						dbService.query("checkExistingMember", async () => {
							return await dbService.db.query.member.findFirst({
								where: and(
									eq(member.userId, input.userId),
									eq(member.organizationId, inviteCodeRecord.organizationId),
								),
							});
						}),
					);

					if (existingMember) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "You are already a member of this organization",
									field: "userId",
								}),
							),
						);
					}

					// Create member with appropriate status
					const memberStatus = inviteCodeRecord.requiresApproval ? "pending" : "approved";

					const newMember = yield* _(
						dbService.query("createMember", async () => {
							// Generate a unique member ID
							const memberId = nanoid();

							const [createdMember] = await dbService.db
								.insert(member)
								.values({
									id: memberId,
									userId: input.userId,
									organizationId: inviteCodeRecord.organizationId,
									role: "member",
									createdAt: new Date(),
								})
								.returning();

							return createdMember;
						}),
					);

					// Record the usage
					yield* _(
						dbService.query("recordUsage", async () => {
							await dbService.db.insert(inviteCodeUsage).values({
								inviteCodeId: inviteCodeRecord.id,
								userId: input.userId,
								memberId: newMember.id,
								ipAddress: input.ipAddress,
								userAgent: input.userAgent,
							});
						}),
					);

					// Increment usage count
					yield* _(
						dbService.query("incrementUsageCount", async () => {
							await dbService.db
								.update(inviteCode)
								.set({
									currentUses: sql`${inviteCode.currentUses} + 1`,
								})
								.where(eq(inviteCode.id, inviteCodeRecord.id));
						}),
					);

					return {
						success: true,
						memberId: newMember.id,
						status: memberStatus as "pending" | "approved",
						organizationId: inviteCodeRecord.organizationId,
						organizationName:
							(inviteCodeRecord as InviteCodeWithRelations).organization?.name ||
							"Unknown Organization",
					};
				}),

			getUsageStats: (inviteCodeId) =>
				Effect.gen(function* (_) {
					// Verify code exists
					const existing = yield* _(
						dbService.query("getInviteCodeById", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: eq(inviteCode.id, inviteCodeId),
							});
						}),
					);

					if (!existing) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Invite code not found",
									entityType: "inviteCode",
									entityId: inviteCodeId,
								}),
							),
						);
					}

					const stats = yield* _(
						dbService.query("getUsageStats", async () => {
							const usages = await dbService.db.query.inviteCodeUsage.findMany({
								where: eq(inviteCodeUsage.inviteCodeId, inviteCodeId),
							});

							// Get member approvals for these members
							const memberIds = usages.map((u) => u.memberId);

							if (memberIds.length === 0) {
								return { total: 0, pending: 0, approved: 0, rejected: 0 };
							}

							const approvals = await dbService.db.query.memberApproval.findMany({
								where: sql`${memberApproval.memberId} = ANY(${memberIds})`,
							});

							const approvalMap = new Map(approvals.map((a) => [a.memberId, a.status]));

							let pending = 0;
							let approved = 0;
							let rejected = 0;

							for (const usage of usages) {
								const status = approvalMap.get(usage.memberId);
								if (status === "approved") {
									approved++;
								} else if (status === "rejected") {
									rejected++;
								} else {
									pending++;
								}
							}

							return { total: usages.length, pending, approved, rejected };
						}),
					);

					return stats;
				}),

			generateCode: () => Effect.succeed(generateReadableCode()),

			setPendingInviteCode: (userId, code) =>
				Effect.gen(function* (_) {
					// Validate the code first to ensure it's valid before storing
					const validationResult = yield* _(
						dbService.query("validateCodeForPending", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: eq(inviteCode.code, code.toUpperCase()),
							});
						}),
					);

					if (!validationResult) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Invalid invite code",
									field: "code",
								}),
							),
						);
					}

					const { usable, reason } = isCodeUsable(validationResult!);
					if (!usable) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: reason || "Code is not usable",
									field: "code",
								}),
							),
						);
					}

					// Store the pending invite code on the user
					yield* _(
						dbService.query("setPendingInviteCode", async () => {
							await dbService.db
								.update(user)
								.set({ pendingInviteCode: code.toUpperCase() })
								.where(eq(user.id, userId));
						}),
					);
				}),

			processPendingInviteCode: (userId) =>
				Effect.gen(function* (_) {
					// Get the user's pending invite code
					const userRecord = yield* _(
						dbService.query("getUserPendingCode", async () => {
							return await dbService.db.query.user.findFirst({
								where: eq(user.id, userId),
								columns: { id: true, pendingInviteCode: true },
							});
						}),
					);

					if (!userRecord || !userRecord.pendingInviteCode) {
						return null;
					}

					const code = userRecord.pendingInviteCode;

					// Clear the pending code first (regardless of outcome)
					yield* _(
						dbService.query("clearPendingInviteCode", async () => {
							await dbService.db
								.update(user)
								.set({ pendingInviteCode: null })
								.where(eq(user.id, userId));
						}),
					);

					// Now use the code
					const validationResult = yield* _(
						dbService.query("findInviteCode", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: eq(inviteCode.code, code.toUpperCase()),
								with: {
									organization: {
										columns: {
											id: true,
											name: true,
											slug: true,
										},
									},
								},
							});
						}),
					);

					if (!validationResult) {
						// Code is no longer valid, but we already cleared it
						return null;
					}

					const inviteCodeRecord = validationResult;
					const { usable } = isCodeUsable(inviteCodeRecord);

					if (!usable) {
						// Code is expired/exhausted, but we already cleared it
						return null;
					}

					// Check if user is already a member of this organization
					const existingMember = yield* _(
						dbService.query("checkExistingMember", async () => {
							return await dbService.db.query.member.findFirst({
								where: and(
									eq(member.userId, userId),
									eq(member.organizationId, inviteCodeRecord.organizationId),
								),
							});
						}),
					);

					if (existingMember) {
						// User is already a member, nothing to do
						return {
							success: true,
							memberId: existingMember.id,
							status: "approved" as const,
							organizationId: inviteCodeRecord.organizationId,
							organizationName:
								(inviteCodeRecord as InviteCodeWithRelations).organization?.name ||
								"Unknown Organization",
						};
					}

					// Create member with appropriate status
					const memberStatus = inviteCodeRecord.requiresApproval ? "pending" : "approved";

					const newMember = yield* _(
						dbService.query("createMember", async () => {
							const memberId = nanoid();

							const [createdMember] = await dbService.db
								.insert(member)
								.values({
									id: memberId,
									userId,
									organizationId: inviteCodeRecord.organizationId,
									role: "member",
									status: memberStatus,
									inviteCodeId: inviteCodeRecord.id,
									createdAt: new Date(),
								})
								.returning();

							return createdMember;
						}),
					);

					// Record the usage
					yield* _(
						dbService.query("recordUsage", async () => {
							await dbService.db.insert(inviteCodeUsage).values({
								inviteCodeId: inviteCodeRecord.id,
								userId,
								memberId: newMember.id,
							});
						}),
					);

					// Increment usage count
					yield* _(
						dbService.query("incrementUsageCount", async () => {
							await dbService.db
								.update(inviteCode)
								.set({
									currentUses: sql`${inviteCode.currentUses} + 1`,
								})
								.where(eq(inviteCode.id, inviteCodeRecord.id));
						}),
					);

					return {
						success: true,
						memberId: newMember.id,
						status: memberStatus as "pending" | "approved",
						organizationId: inviteCodeRecord.organizationId,
						organizationName:
							(inviteCodeRecord as InviteCodeWithRelations).organization?.name ||
							"Unknown Organization",
					};
				}),

			clearPendingInviteCode: (userId) =>
				Effect.gen(function* (_) {
					yield* _(
						dbService.query("clearPendingInviteCode", async () => {
							await dbService.db
								.update(user)
								.set({ pendingInviteCode: null })
								.where(eq(user.id, userId));
						}),
					);
				}),

			getPendingInviteCode: (userId) =>
				Effect.gen(function* (_) {
					const userRecord = yield* _(
						dbService.query("getUserPendingCode", async () => {
							return await dbService.db.query.user.findFirst({
								where: eq(user.id, userId),
								columns: { pendingInviteCode: true },
							});
						}),
					);

					return userRecord?.pendingInviteCode || null;
				}),
		});
	}),
);
