import {
	and,
	desc,
	eq,
	inArray,
	isNull,
	lt,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { nanoid } from "nanoid";
import { member, user } from "@/db/auth-schema";
import {
	auditLog,
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
		const validateInviteCodeUsability = (
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

		const resolveRedemptionStatus = (
			memberStatus: string | null | undefined,
		): Effect.Effect<"pending" | "approved", ValidationError> => {
			if (memberStatus === "rejected") {
				return Effect.fail(
					new ValidationError({
						message: "Membership for this invite code was rejected",
						field: "code",
					}),
				);
			}
			return Effect.succeed(
				memberStatus === "pending" ? "pending" : "approved",
			);
		};

		const getRejectionAuditUserId = (
			metadata: string | null,
			inviteCodeId: string,
		) => {
			if (!metadata) return null;
			try {
				const details: unknown = JSON.parse(metadata);
				if (
					details !== null &&
					typeof details === "object" &&
					"userId" in details &&
					typeof details.userId === "string" &&
					"inviteCodeId" in details &&
					details.inviteCodeId === inviteCodeId
				) {
					return details.userId;
				}
			} catch {
				// Historical audit metadata is unconstrained text.
			}
			return null;
		};

		type RedemptionDb = Pick<
			typeof dbService.db,
			"execute" | "query" | "insert" | "update"
		>;

		const clearPendingInviteCodeIfCurrent = async (
			dbClient: Pick<typeof dbService.db, "update">,
			userId: string,
			expectedCode: string,
		) => {
			const [clearedUser] = await dbClient
				.update(user)
				.set({ pendingInviteCode: null })
				.where(
					and(eq(user.id, userId), eq(user.pendingInviteCode, expectedCode)),
				)
				.returning({ id: user.id });
			return Boolean(clearedUser);
		};

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
			const [existingEmployee, targetTeamId] = await Promise.all([
				dbClient.query.employee.findFirst({
					where: and(
						eq(employee.userId, userId),
						eq(employee.organizationId, inviteCodeRecord.organizationId),
					),
				}),
				resolveInviteCodeTargetTeamId(
					dbClient,
					inviteCodeRecord.organizationId,
					inviteCodeRecord.defaultTeamId,
				),
			]);

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
				expectedPendingInviteCode?: string;
			},
		) =>
			dbService.db.transaction(async (tx) => {
				const redemptionDb = tx as RedemptionDb;
				await redemptionDb.execute(sql`
					SELECT ${inviteCode.id}
					FROM ${inviteCode}
					WHERE ${inviteCode.id} = ${inviteCodeRecord.id}
						AND ${inviteCode.organizationId} = ${inviteCodeRecord.organizationId}
					FOR UPDATE
				`);

				const lockedInviteCode = await redemptionDb.query.inviteCode.findFirst({
					where: and(
						eq(inviteCode.id, inviteCodeRecord.id),
						eq(inviteCode.organizationId, inviteCodeRecord.organizationId),
					),
					with: {
						organization: {
							columns: { id: true, name: true, slug: true },
						},
					},
				});
				if (!lockedInviteCode) {
					return { unusableReason: "Code is not usable" } as const;
				}

				const targetUser = await redemptionDb.query.user.findFirst({
					where: eq(user.id, input.userId),
					columns: { email: true },
				});
				if (!targetUser) throw new Error("Invite code user not found");

				await acquireEmployeeIdentityLock(redemptionDb, {
					organizationId: lockedInviteCode.organizationId,
					normalizedEmail: normalizeInvitationEmail(targetUser.email),
				});

				const existingMember = await redemptionDb.query.member.findFirst({
					where: and(
						eq(member.userId, input.userId),
						eq(member.organizationId, lockedInviteCode.organizationId),
					),
				});
				if (existingMember?.status === "rejected") {
					return { rejected: true } as const;
				}

				const rejectionAudits = await redemptionDb.query.auditLog.findMany({
					where: and(
						eq(auditLog.organizationId, lockedInviteCode.organizationId),
						eq(auditLog.entityType, "membership"),
						eq(auditLog.entityId, lockedInviteCode.id),
						eq(auditLog.action, "reject"),
					),
					columns: { metadata: true },
					orderBy: [desc(auditLog.timestamp)],
				});
				if (
					rejectionAudits.some(
						(audit) =>
							getRejectionAuditUserId(audit.metadata, lockedInviteCode.id) ===
							input.userId,
					)
				) {
					return { rejected: true } as const;
				}

				const { usable, reason } =
					validateInviteCodeUsability(lockedInviteCode);
				if (!usable) {
					if (
						input.expectedPendingInviteCode &&
						!(await clearPendingInviteCodeIfCurrent(
							redemptionDb,
							input.userId,
							input.expectedPendingInviteCode,
						))
					) {
						return null;
					}
					return { unusableReason: reason ?? "Code is not usable" } as const;
				}

				let enterpriseDenial: string | undefined;
				try {
					await assertEnterpriseIdentityInviteCodeRedemptionAllowed({
						organizationId: lockedInviteCode.organizationId,
						userId: input.userId,
					});
				} catch (error) {
					enterpriseDenial =
						error instanceof Error
							? error.message
							: "Invite code redemption is not allowed";
				}

				if (
					input.expectedPendingInviteCode &&
					!(await clearPendingInviteCodeIfCurrent(
						redemptionDb,
						input.userId,
						input.expectedPendingInviteCode,
					))
				) {
					return null;
				}
				if (enterpriseDenial) {
					return { enterpriseDenial } as const;
				}

				if (existingMember) {
					if (
						!lockedInviteCode.requiresApproval &&
						existingMember.status === "approved"
					) {
						await provisionEmployeeForInviteCode(
							redemptionDb,
							lockedInviteCode,
							input.userId,
							existingMember.role,
						);
					}
					return { member: existingMember, created: false };
				}

				const memberStatus = lockedInviteCode.requiresApproval
					? "pending"
					: "approved";
				const [createdMember] = await redemptionDb
					.insert(member)
					.values({
						id: nanoid(),
						userId: input.userId,
						organizationId: lockedInviteCode.organizationId,
						role: "member",
						status: memberStatus,
						inviteCodeId: lockedInviteCode.id,
						createdAt: new Date(),
					})
					.returning();

				await redemptionDb.insert(inviteCodeUsage).values({
					inviteCodeId: lockedInviteCode.id,
					userId: input.userId,
					memberId: createdMember.id,
					ipAddress: input.ipAddress,
					userAgent: input.userAgent,
				});

				if (!lockedInviteCode.requiresApproval) {
					await provisionEmployeeForInviteCode(
						redemptionDb,
						lockedInviteCode,
						input.userId,
						createdMember.role,
					);
				}

				const [incrementedInviteCode] = await redemptionDb
					.update(inviteCode)
					.set({ currentUses: sql`${inviteCode.currentUses} + 1` })
					.where(
						and(
							eq(inviteCode.id, lockedInviteCode.id),
							eq(inviteCode.organizationId, lockedInviteCode.organizationId),
							eq(inviteCode.status, "active"),
							or(
								isNull(inviteCode.maxUses),
								lt(inviteCode.currentUses, inviteCode.maxUses),
							),
						),
					)
					.returning({
						id: inviteCode.id,
						currentUses: inviteCode.currentUses,
					});
				if (!incrementedInviteCode) {
					throw new Error("Invite code changed before usage increment");
				}

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

					const { usable, reason } = validateInviteCodeUsability(result);
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
							const matches = await dbService.db.query.inviteCode.findMany({
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
								limit: 2,
							});
							return matches.length === 1 ? matches[0] : null;
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
					const redemption = yield* _(
						dbService.query("redeemInviteCode", async () => {
							return await redeemInviteCodeInTransaction(
								inviteCodeRecord,
								input,
							);
						}),
					);
					if (!redemption) {
						return yield* _(
							Effect.die(
								"Direct invite-code redemption unexpectedly became stale",
							),
						);
					}
					if (redemption.rejected === true) {
						yield* _(resolveRedemptionStatus("rejected"));
						return yield* _(
							Effect.die("Rejected redemption unexpectedly resolved"),
						);
					}
					if (typeof redemption.unusableReason === "string") {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: redemption.unusableReason,
									field: "code",
								}),
							),
						);
					}
					if (typeof redemption.enterpriseDenial === "string") {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: redemption.enterpriseDenial,
									field: "domainRestrictionEnabled",
								}),
							),
						);
					}
					const redemptionStatus = yield* _(
						resolveRedemptionStatus(redemption.member.status),
					);

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
					const stats = yield* _(
						dbService.query("getUsageStats", async () => {
							return dbService.db.transaction(
								async (tx) => {
									const existing = await tx.query.inviteCode.findFirst({
										where: and(
											eq(inviteCode.id, inviteCodeId),
											eq(inviteCode.organizationId, organizationId),
										),
										columns: { id: true },
									});
									if (!existing) return null;

									const [usages, rejectionAudits] = await Promise.all([
										tx.query.inviteCodeUsage.findMany({
											where: eq(inviteCodeUsage.inviteCodeId, inviteCodeId),
										}),
										tx.query.auditLog.findMany({
											where: and(
												eq(auditLog.organizationId, organizationId),
												eq(auditLog.entityType, "membership"),
												eq(auditLog.entityId, inviteCodeId),
												eq(auditLog.action, "reject"),
											),
										}),
									]);

									const rejectedUserIds = new Set<string>();
									for (const audit of rejectionAudits) {
										const rejectedUserId = getRejectionAuditUserId(
											audit.metadata,
											inviteCodeId,
										);
										if (rejectedUserId) rejectedUserIds.add(rejectedUserId);
									}

									const memberIds = usages.map((u) => u.memberId);
									const approvals = memberIds.length
										? await tx.query.memberApproval.findMany({
												where: and(
													sql`${memberApproval.memberId} = ANY(${memberIds})`,
													eq(memberApproval.organizationId, organizationId),
												),
											})
										: [];

									const approvalMap = new Map(
										approvals.map((a) => [a.memberId, a.status]),
									);

									let pending = 0;
									let approved = 0;
									const rejected = rejectedUserIds.size;

									for (const usage of usages) {
										if (rejectedUserIds.has(usage.userId)) continue;
										const status = approvalMap.get(usage.memberId);
										if (status === "approved") {
											approved++;
										} else {
											pending++;
										}
									}

									return {
										total: pending + approved + rejected,
										pending,
										approved,
										rejected,
									};
								},
								{ isolationLevel: "repeatable read" },
							);
						}),
					);

					if (!stats) {
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

					const { usable, reason } =
						validateInviteCodeUsability(validationResult);
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

					const clearPendingCode = () =>
						dbService.query("clearPendingInviteCode", async () => {
							return await clearPendingInviteCodeIfCurrent(
								dbService.db,
								userId,
								code,
							);
						});

					const preRedemptionResult = yield* _(
						Effect.gen(function* (_) {
							const validationResult = yield* _(
								dbService.query("findInviteCode", async () => {
									const matches = await dbService.db.query.inviteCode.findMany({
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
										limit: 2,
									});
									return matches.length === 1 ? matches[0] : null;
								}),
							);

							if (!validationResult) return null;

							return validationResult;
						}).pipe(Effect.either),
					);

					if (preRedemptionResult._tag === "Left") {
						const cleared = yield* _(clearPendingCode());
						if (!cleared) return null;
						return yield* _(Effect.fail(preRedemptionResult.left));
					}

					if (!preRedemptionResult.right) {
						yield* _(clearPendingCode());
						return null;
					}

					const inviteCodeRecord = preRedemptionResult.right;
					const redemption = yield* _(
						dbService.query("redeemPendingInviteCode", async () => {
							return await redeemInviteCodeInTransaction(inviteCodeRecord, {
								userId,
								expectedPendingInviteCode: code,
							});
						}),
					);
					if (!redemption) return null;
					if (redemption.rejected === true) {
						yield* _(resolveRedemptionStatus("rejected"));
						return yield* _(
							Effect.die("Rejected redemption unexpectedly resolved"),
						);
					}
					if (typeof redemption.unusableReason === "string") {
						return null;
					}
					if (typeof redemption.enterpriseDenial === "string") {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: redemption.enterpriseDenial,
									field: "domainRestrictionEnabled",
								}),
							),
						);
					}
					const redemptionStatus = yield* _(
						resolveRedemptionStatus(redemption.member.status),
					);

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
