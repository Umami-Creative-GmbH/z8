import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { nanoid } from "nanoid";
import { member, user } from "@/db/auth-schema";
import {
	employee,
	type inviteCode as InviteCodeTable,
	type inviteCodeUsage as InviteCodeUsageTable,
	inviteCode,
	inviteCodeUsage,
	memberApproval,
	team,
} from "@/db/schema";
import { acquireEmployeeIdentityLock } from "@/lib/auth/employee-identity-lock";
import { normalizeInvitationEmail } from "@/lib/auth/employee-invitation-draft";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { syncBillingSeatsAfterMemberChange } from "@/lib/billing/seat-sync-trigger";
import { assertEnterpriseIdentityInviteCodeRedemptionAllowed } from "@/lib/enterprise-identity/enforcement";
import {
	type AuthorizationError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "../errors";
import { DatabaseService } from "./database.service";

// Type definitions
type InviteCode = typeof InviteCodeTable.$inferSelect;
type InviteCodeUsage = typeof InviteCodeUsageTable.$inferSelect;
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
	ipAddress?: string | null;
	userAgent?: string | null;
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
			organizationId: string,
			input: UpdateInviteCodeInput,
		) => Effect.Effect<
			InviteCode,
			NotFoundError | ValidationError | DatabaseError
		>;

		readonly delete: (
			id: string,
			organizationId: string,
			userId: string,
		) => Effect.Effect<
			void,
			NotFoundError | AuthorizationError | DatabaseError
		>;

		readonly getById: (
			id: string,
			organizationId: string,
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
		) => Effect.Effect<
			UseInviteCodeResult,
			ValidationError | NotFoundError | DatabaseError
		>;

		// Stats
		readonly getUsageStats: (
			inviteCodeId: string,
			organizationId: string,
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
		) => Effect.Effect<
			UseInviteCodeResult | null,
			ValidationError | NotFoundError | DatabaseError
		>;

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
			const suffix = nanoid(6)
				.toUpperCase()
				.replace(/[^A-Z0-9]/g, "X");
			return `${prefix}-${suffix}`;
		};

		// Helper to validate code format
		const isValidCodeFormat = (code: string): boolean => {
			// Allow 4-20 chars, alphanumeric and hyphens, uppercase
			const regex = /^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$/;
			return regex.test(code);
		};

		// Helper to check if code is expired or exhausted
		const isCodeUsable = (
			inviteCodeRecord: InviteCode,
		): { usable: boolean; reason?: string } => {
			if (inviteCodeRecord.status !== "active") {
				return { usable: false, reason: `Code is ${inviteCodeRecord.status}` };
			}
			if (
				inviteCodeRecord.expiresAt &&
				inviteCodeRecord.expiresAt < new Date()
			) {
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

		type RedemptionDb = Pick<
			typeof dbService.db,
			"execute" | "query" | "insert" | "update"
		>;

		const resolveInviteCodeTargetTeamId = async (
			dbClient: RedemptionDb,
			organizationId: string,
			targetTeamId: string | null | undefined,
		) => {
			if (!targetTeamId) return null;

			const targetTeam = await dbClient.query.team.findFirst({
				where: and(
					eq(team.id, targetTeamId),
					eq(team.organizationId, organizationId),
				),
			});

			return targetTeam?.id ?? null;
		};

		const provisionEmployeeForInviteCode = async (
			dbClient: RedemptionDb,
			inviteCodeRecord: InviteCode,
			userId: string,
			memberRole: unknown,
		) => {
			const existingEmployee = await dbClient.query.employee.findFirst({
				where: and(
					eq(employee.userId, userId),
					eq(employee.organizationId, inviteCodeRecord.organizationId),
				),
			});

			const targetTeamId = await resolveInviteCodeTargetTeamId(
				dbClient,
				inviteCodeRecord.organizationId,
				inviteCodeRecord.defaultTeamId,
			);

			if (existingEmployee) {
				if (!existingEmployee.isActive) {
					await dbClient
						.update(employee)
						.set({
							isActive: true,
							...(targetTeamId ? { teamId: targetTeamId } : {}),
						})
						.where(
							and(
								eq(employee.id, existingEmployee.id),
								eq(employee.organizationId, inviteCodeRecord.organizationId),
							),
						);
				}
				return;
			}

			await dbClient.insert(employee).values({
				userId,
				organizationId: inviteCodeRecord.organizationId,
				teamId: targetTeamId,
				role:
					hasOrganizationRole(memberRole, "owner") ||
					hasOrganizationRole(memberRole, "admin")
						? "admin"
						: "employee",
				isActive: true,
			});
		};

		const redeemInviteCodeInTransaction = async (
			inviteCodeRecord: InviteCode,
			input: {
				userId: string;
				ipAddress?: string | null;
				userAgent?: string | null;
			},
		) =>
			dbService.db.transaction(async (tx) => {
				const redemptionDb = tx as RedemptionDb;
				const targetUser = await redemptionDb.query.user.findFirst({
					where: eq(user.id, input.userId),
					columns: { email: true },
				});
				if (!targetUser) throw new Error("Invite code user not found");

				await acquireEmployeeIdentityLock(redemptionDb, {
					organizationId: inviteCodeRecord.organizationId,
					normalizedEmail: normalizeInvitationEmail(targetUser.email),
				});

				const existingMember = await redemptionDb.query.member.findFirst({
					where: and(
						eq(member.userId, input.userId),
						eq(member.organizationId, inviteCodeRecord.organizationId),
					),
				});
				if (existingMember) {
					if (
						!inviteCodeRecord.requiresApproval &&
						existingMember.status === "approved"
					) {
						await provisionEmployeeForInviteCode(
							redemptionDb,
							inviteCodeRecord,
							input.userId,
							existingMember.role,
						);
					}
					return { member: existingMember, created: false };
				}

				const memberStatus = inviteCodeRecord.requiresApproval
					? "pending"
					: "approved";
				const [createdMember] = await redemptionDb
					.insert(member)
					.values({
						id: nanoid(),
						userId: input.userId,
						organizationId: inviteCodeRecord.organizationId,
						role: "member",
						status: memberStatus,
						inviteCodeId: inviteCodeRecord.id,
						createdAt: new Date(),
					})
					.returning();

				await redemptionDb.insert(inviteCodeUsage).values({
					inviteCodeId: inviteCodeRecord.id,
					userId: input.userId,
					memberId: createdMember.id,
					ipAddress: input.ipAddress,
					userAgent: input.userAgent,
				});

				if (!inviteCodeRecord.requiresApproval) {
					await provisionEmployeeForInviteCode(
						redemptionDb,
						inviteCodeRecord,
						input.userId,
						createdMember.role,
					);
				}

				await redemptionDb
					.update(inviteCode)
					.set({ currentUses: sql`${inviteCode.currentUses} + 1` })
					.where(eq(inviteCode.id, inviteCodeRecord.id));

				return { member: createdMember, created: true };
			});

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
									message:
										"A code with this name already exists for this organization.",
									field: "code",
								}),
							),
						);
					}

					// Validate team exists if provided
					if (input.defaultTeamId) {
						const defaultTeamId = input.defaultTeamId;
						const teamRecord = yield* _(
							dbService.query("validateTeam", async () => {
								return await dbService.db.query.team.findFirst({
									where: and(
										eq(team.id, defaultTeamId),
										eq(team.organizationId, input.organizationId),
									),
								});
							}),
						);

						if (!teamRecord) {
							yield* _(
								Effect.fail(
									new ValidationError({
										message:
											"Invalid default team. Team not found in this organization.",
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

			update: (id, organizationId, input) =>
				Effect.gen(function* (_) {
					// Verify code exists
					const existing = yield* _(
						dbService.query("getInviteCodeById", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: and(
									eq(inviteCode.id, id),
									eq(inviteCode.organizationId, organizationId),
								),
							});
						}),
					);

					if (!existing) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Invite code not found",
									entityType: "inviteCode",
									entityId: id,
								}),
							),
						);
					}

					const existingInviteCode = existing;

					// Validate team if changing
					if (
						input.defaultTeamId !== undefined &&
						input.defaultTeamId !== null
					) {
						const defaultTeamId = input.defaultTeamId;
						const teamRecord = yield* _(
							dbService.query("validateTeam", async () => {
								return await dbService.db.query.team.findFirst({
									where: and(
										eq(team.id, defaultTeamId),
										eq(team.organizationId, existingInviteCode.organizationId),
									),
								});
							}),
						);

						if (!teamRecord) {
							yield* _(
								Effect.fail(
									new ValidationError({
										message:
											"Invalid default team. Team not found in this organization.",
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
									...(input.description !== undefined && {
										description: input.description,
									}),
									...(input.maxUses !== undefined && {
										maxUses: input.maxUses,
									}),
									...(input.expiresAt !== undefined && {
										expiresAt: input.expiresAt,
									}),
									...(input.defaultTeamId !== undefined && {
										defaultTeamId: input.defaultTeamId,
									}),
									...(input.requiresApproval !== undefined && {
										requiresApproval: input.requiresApproval,
									}),
									...(input.status !== undefined && { status: input.status }),
									updatedBy: input.updatedBy,
								})
								.where(
									and(
										eq(inviteCode.id, id),
										eq(inviteCode.organizationId, organizationId),
									),
								)
								.returning();
							return result;
						}),
					);

					return updatedCode;
				}),

			delete: (id, organizationId, userId) =>
				Effect.gen(function* (_) {
					const existing = yield* _(
						dbService.query("getInviteCodeById", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: and(
									eq(inviteCode.id, id),
									eq(inviteCode.organizationId, organizationId),
								),
							});
						}),
					);

					if (!existing) {
						return yield* _(
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
								.where(
									and(
										eq(inviteCode.id, id),
										eq(inviteCode.organizationId, organizationId),
									),
								);
						}),
					);
				}),

			getById: (id, organizationId) =>
				Effect.gen(function* (_) {
					const result = yield* _(
						dbService.query("getInviteCodeById", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: and(
									eq(inviteCode.id, id),
									eq(inviteCode.organizationId, organizationId),
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
							const baseCondition = eq(
								inviteCode.organizationId,
								query.organizationId,
							);
							const whereCondition: SQL = query.status
								? ((and(baseCondition, eq(inviteCode.status, query.status)) ??
										baseCondition) as SQL)
								: !query.includeArchived
									? ((and(
											baseCondition,
											inArray(inviteCode.status, [
												"active",
												"paused",
												"expired",
											]),
										) ?? baseCondition) as SQL)
									: baseCondition;

							return await dbService.db.query.inviteCode.findMany({
								where: whereCondition,
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
						return {
							valid: false,
							inviteCode: result as InviteCodeWithRelations,
							error: reason,
						};
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
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Invalid invite code",
									entityType: "inviteCode",
									entityId: input.code,
								}),
							),
						);
					}

					const inviteCodeRecord = validationResult;
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

					yield* _(
						Effect.tryPromise({
							try: async () => {
								await assertEnterpriseIdentityInviteCodeRedemptionAllowed({
									organizationId: inviteCodeRecord.organizationId,
									userId: input.userId,
								});
							},
							catch: (error) =>
								new ValidationError({
									message:
										error instanceof Error
											? error.message
											: "Invite code redemption is not allowed",
									field: "domainRestrictionEnabled",
								}),
						}),
					);

					const redemption = yield* _(
						dbService.query("redeemInviteCode", async () => {
							return await redeemInviteCodeInTransaction(inviteCodeRecord, input);
						}),
					);
					const redemptionStatus =
						redemption.member.status === "pending" ? "pending" : "approved";

					if (redemption.created && redemptionStatus === "approved") {
						yield* _(
							Effect.promise(() =>
								syncBillingSeatsAfterMemberChange({
									organizationId: inviteCodeRecord.organizationId,
									memberId: redemption.member.id,
									userId: input.userId,
									change: "added",
								}),
							),
						);
					}

					return {
						success: true,
						memberId: redemption.member.id,
						status: redemptionStatus,
						organizationId: inviteCodeRecord.organizationId,
						organizationName:
							(inviteCodeRecord as InviteCodeWithRelations).organization
								?.name || "Unknown Organization",
					};
				}),

			getUsageStats: (inviteCodeId, organizationId) =>
				Effect.gen(function* (_) {
					// Verify code exists
					const existing = yield* _(
						dbService.query("getInviteCodeById", async () => {
							return await dbService.db.query.inviteCode.findFirst({
								where: and(
									eq(inviteCode.id, inviteCodeId),
									eq(inviteCode.organizationId, organizationId),
								),
							});
						}),
					);

					if (!existing) {
						return yield* _(
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

							const approvals =
								await dbService.db.query.memberApproval.findMany({
									where: sql`${memberApproval.memberId} = ANY(${memberIds})`,
								});

							const approvalMap = new Map(
								approvals.map((a) => [a.memberId, a.status]),
							);

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
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: "Invalid invite code",
									field: "code",
								}),
							),
						);
					}

					const { usable, reason } = isCodeUsable(validationResult);
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

					if (!userRecord?.pendingInviteCode) {
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

					yield* _(
						Effect.tryPromise({
							try: async () => {
								await assertEnterpriseIdentityInviteCodeRedemptionAllowed({
									organizationId: inviteCodeRecord.organizationId,
									userId,
								});
							},
							catch: (error) =>
								new ValidationError({
									message:
										error instanceof Error
											? error.message
											: "Invite code redemption is not allowed",
									field: "domainRestrictionEnabled",
								}),
						}),
					);

					const redemption = yield* _(
						dbService.query("redeemPendingInviteCode", async () => {
							return await redeemInviteCodeInTransaction(inviteCodeRecord, { userId });
						}),
					);
					const redemptionStatus =
						redemption.member.status === "pending" ? "pending" : "approved";

					if (redemption.created && redemptionStatus === "approved") {
						yield* _(
							Effect.promise(() =>
								syncBillingSeatsAfterMemberChange({
									organizationId: inviteCodeRecord.organizationId,
									memberId: redemption.member.id,
									userId,
									change: "added",
								}),
							),
						);
					}

					return {
						success: true,
						memberId: redemption.member.id,
						status: redemptionStatus,
						organizationId: inviteCodeRecord.organizationId,
						organizationName:
							(inviteCodeRecord as InviteCodeWithRelations).organization
								?.name || "Unknown Organization",
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
