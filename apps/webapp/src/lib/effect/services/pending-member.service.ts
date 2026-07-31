import { and, count, desc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { member, user } from "@/db/auth-schema";
import {
	auditLog,
	employee,
	inviteCode,
	inviteCodeUsage,
	memberApproval,
	team,
} from "@/db/schema";
import { acquireEmployeeIdentityLock } from "@/lib/auth/employee-identity-lock";
import { normalizeInvitationEmail } from "@/lib/auth/employee-invitation-draft";
import {
	completeRemovedMemberCleanupPostCommit,
	revokeRemovedMemberAccessInTransaction,
} from "@/lib/auth/member-removal-cleanup";
import { syncBillingSeatsAfterMemberChange } from "@/lib/billing/seat-sync-trigger";
import {
	type AuthorizationError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "../errors";
import { DatabaseService } from "./database.service";

// Type definitions
type MemberApproval = typeof memberApproval.$inferSelect;
type ApprovalStatus = "pending" | "approved" | "rejected";

export interface PendingMember {
	id: string; // member ID
	userId: string;
	organizationId: string;
	role: string;
	createdAt: Date;
	user: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	};
	inviteCode?: {
		id: string;
		code: string;
		label: string;
		defaultTeamId?: string | null;
	} | null;
	usedAt?: Date;
}

export interface PendingMemberQuery {
	organizationId: string;
	status?: ApprovalStatus;
}

export interface ApproveMemberInput {
	memberId: string;
	organizationId: string;
	assignedTeamId?: string | null;
	notes?: string;
	approvedBy: string;
}

export interface RejectMemberInput {
	memberId: string;
	organizationId: string;
	notes?: string;
	rejectedBy: string;
}

export interface ApprovalResult {
	success: boolean;
	member: PendingMember;
	approval: MemberApproval;
}

export class PendingMemberService extends Context.Tag("PendingMemberService")<
	PendingMemberService,
	{
		// List pending members
		readonly listPending: (
			query: PendingMemberQuery,
		) => Effect.Effect<PendingMember[], DatabaseError>;

		// Get a specific pending member
		readonly getById: (
			memberId: string,
			organizationId: string,
		) => Effect.Effect<PendingMember | null, DatabaseError>;

		// Approve a pending member
		readonly approve: (
			input: ApproveMemberInput,
		) => Effect.Effect<
			ApprovalResult,
			NotFoundError | ValidationError | AuthorizationError | DatabaseError
		>;

		// Reject a pending member
		readonly reject: (
			input: RejectMemberInput,
		) => Effect.Effect<
			ApprovalResult,
			NotFoundError | ValidationError | AuthorizationError | DatabaseError
		>;

		// Bulk approve members
		readonly bulkApprove: (
			memberIds: string[],
			organizationId: string,
			approvedBy: string,
			assignedTeamId?: string,
		) => Effect.Effect<{ approved: number; failed: number }, DatabaseError>;

		// Bulk reject members
		readonly bulkReject: (
			memberIds: string[],
			organizationId: string,
			rejectedBy: string,
			notes?: string,
		) => Effect.Effect<{ rejected: number; failed: number }, DatabaseError>;

		// Get approval history for a member
		readonly getApprovalHistory: (
			memberId: string,
		) => Effect.Effect<MemberApproval[], DatabaseError>;

		// Count pending members for an organization
		readonly countPending: (
			organizationId: string,
		) => Effect.Effect<number, DatabaseError>;
	}
>() {}

export const PendingMemberServiceLive = Layer.effect(
	PendingMemberService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		// Member status is the source of truth for the approval lifecycle.
		const getPendingMemberDetails = async (
			memberId: string,
			organizationId: string,
		): Promise<PendingMember | null> => {
			// Get the member with user details
			const memberRecord = await dbService.db.query.member.findFirst({
				where: and(
					eq(member.id, memberId),
					eq(member.organizationId, organizationId),
					eq(member.status, "pending"),
				),
			});

			if (
				!memberRecord ||
				memberRecord.organizationId !== organizationId ||
				memberRecord.status !== "pending"
			)
				return null;

			// Get user details
			const userRecord = await dbService.db.query.user.findFirst({
				where: eq(user.id, memberRecord.userId),
			});

			if (!userRecord) return null;

			// Check for invite code usage
			const usage = await dbService.db.query.inviteCodeUsage.findFirst({
				where: eq(inviteCodeUsage.memberId, memberId),
				with: {
					inviteCode: {
						columns: {
							id: true,
							code: true,
							label: true,
						},
					},
				},
			});

			return {
				id: memberRecord.id,
				userId: memberRecord.userId,
				organizationId: memberRecord.organizationId,
				role: memberRecord.role,
				createdAt: memberRecord.createdAt,
				user: {
					id: userRecord.id,
					name: userRecord.name,
					email: userRecord.email,
					image: userRecord.image,
				},
				inviteCode: usage?.inviteCode
					? {
							id: usage.inviteCode.id,
							code: usage.inviteCode.code,
							label: usage.inviteCode.label,
						}
					: null,
				usedAt: usage?.usedAt,
			};
		};

		const approvePendingMemberAtomically = async (
			pendingMember: PendingMember,
			input: ApproveMemberInput,
		) =>
			dbService.db.transaction(async (tx) => {
				const targetUser = await tx.query.user.findFirst({
					where: eq(user.id, pendingMember.userId),
					columns: { email: true },
				});
				if (!targetUser) throw new Error("Pending member user not found");

				await acquireEmployeeIdentityLock(tx, {
					organizationId: input.organizationId,
					normalizedEmail: normalizeInvitationEmail(targetUser.email),
				});

				if (input.assignedTeamId) {
					const assignedTeam = await tx.query.team.findFirst({
						where: and(
							eq(team.id, input.assignedTeamId),
							eq(team.organizationId, input.organizationId),
						),
					});
					if (!assignedTeam)
						throw new Error("Assigned team not found in organization");
				}

				const [approvedMember] = await tx
					.update(member)
					.set({ status: "approved" })
					.where(
						and(
							eq(member.id, input.memberId),
							eq(member.organizationId, input.organizationId),
							eq(member.status, "pending"),
						),
					)
					.returning();
				if (!approvedMember) return null;

				const [[approval], existingEmployee] = await Promise.all([
					tx
						.insert(memberApproval)
						.values({
							memberId: input.memberId,
							organizationId: input.organizationId,
							status: "approved",
							assignedTeamId: input.assignedTeamId,
							approvedBy: input.approvedBy,
							notes: input.notes,
						})
						.returning(),
					tx.query.employee.findFirst({
						where: and(
							eq(employee.userId, approvedMember.userId),
							eq(employee.organizationId, input.organizationId),
						),
					}),
				]);

				if (!existingEmployee) {
					await tx.insert(employee).values({
						userId: approvedMember.userId,
						organizationId: input.organizationId,
						teamId: input.assignedTeamId,
						role: "employee",
						isActive: true,
					});
				} else if (!existingEmployee.isActive) {
					await tx
						.update(employee)
						.set({
							isActive: true,
							teamId: input.assignedTeamId ?? existingEmployee.teamId,
						})
						.where(
							and(
								eq(employee.id, existingEmployee.id),
								eq(employee.organizationId, input.organizationId),
							),
						);
				}

				return approval;
			});

		const rejectPendingMemberAtomically = async (input: RejectMemberInput) => {
			const result = await dbService.db.transaction(async (tx) => {
				const candidate = await tx.query.member.findFirst({
					where: and(
						eq(member.id, input.memberId),
						eq(member.organizationId, input.organizationId),
						eq(member.status, "pending"),
					),
				});
				if (
					!candidate ||
					candidate.id !== input.memberId ||
					candidate.organizationId !== input.organizationId ||
					candidate.status !== "pending"
				) {
					return null;
				}

				const userRecord = await tx.query.user.findFirst({
					where: eq(user.id, candidate.userId),
				});
				if (!userRecord) throw new Error("Pending member user not found");

				// Match approval and redemption ordering: identity lock, then member row lock.
				await acquireEmployeeIdentityLock(tx, {
					organizationId: input.organizationId,
					normalizedEmail: normalizeInvitationEmail(userRecord.email),
				});

				await tx.execute(sql`
					SELECT ${member.id}
					FROM ${member}
					WHERE ${member.id} = ${input.memberId}
						AND ${member.organizationId} = ${input.organizationId}
						AND ${member.status} = 'pending'
					FOR UPDATE
				`);

				const memberRecord = await tx.query.member.findFirst({
					where: and(
						eq(member.id, input.memberId),
						eq(member.organizationId, input.organizationId),
						eq(member.status, "pending"),
					),
				});
				if (
					!memberRecord ||
					memberRecord.id !== input.memberId ||
					memberRecord.organizationId !== input.organizationId ||
					memberRecord.status !== "pending"
				)
					return null;

				const existingApproval = await tx.query.memberApproval.findFirst({
					where: and(
						eq(memberApproval.memberId, input.memberId),
						eq(memberApproval.organizationId, input.organizationId),
					),
				});
				if (existingApproval) return null;

				const usage = await tx.query.inviteCodeUsage.findFirst({
					where: eq(inviteCodeUsage.memberId, input.memberId),
					with: {
						inviteCode: {
							columns: { id: true, code: true, label: true },
						},
					},
				});

				const pendingMember: PendingMember = {
					id: memberRecord.id,
					userId: memberRecord.userId,
					organizationId: memberRecord.organizationId,
					role: memberRecord.role,
					createdAt: memberRecord.createdAt,
					user: {
						id: userRecord.id,
						name: userRecord.name,
						email: userRecord.email,
						image: userRecord.image,
					},
					inviteCode: usage?.inviteCode
						? {
								id: usage.inviteCode.id,
								code: usage.inviteCode.code,
								label: usage.inviteCode.label,
							}
						: null,
					usedAt: usage?.usedAt,
				};

				const [rejection] = await tx
					.insert(memberApproval)
					.values({
						memberId: input.memberId,
						organizationId: input.organizationId,
						status: "rejected",
						approvedBy: input.rejectedBy,
						notes: input.notes,
					})
					.returning();

				const inviteIdentity =
					usage?.inviteCode?.id ?? memberRecord.inviteCodeId;
				if (!inviteIdentity) {
					throw new Error("Pending member invite identity not found");
				}

				await tx.insert(auditLog).values({
					organizationId: input.organizationId,
					entityType: "membership",
					entityId: inviteIdentity,
					action: "reject",
					performedBy: input.rejectedBy,
					changes: JSON.stringify({
						status: { from: "pending", to: "rejected" },
					}),
					metadata: JSON.stringify({
						memberId: memberRecord.id,
						userId: memberRecord.userId,
						inviteCodeId: inviteIdentity,
						inviteCode: usage?.inviteCode?.code ?? null,
						notes: input.notes,
					}),
				});

				const [removedMember] = await tx
					.delete(member)
					.where(
						and(
							eq(member.id, input.memberId),
							eq(member.organizationId, input.organizationId),
							eq(member.status, "pending"),
						),
					)
					.returning({ id: member.id });
				if (!removedMember) {
					throw new Error("Pending member changed before rejection");
				}

				const cleanup = await revokeRemovedMemberAccessInTransaction(
					tx,
					memberRecord.userId,
					input.organizationId,
				);

				return { cleanup, pendingMember, rejection };
			});

			if (result) {
				await completeRemovedMemberCleanupPostCommit({
					organizationId: input.organizationId,
					sessionTokens: result.cleanup.sessionTokens,
				});
			}
			return result;
		};

		return PendingMemberService.of({
			listPending: (query) =>
				Effect.gen(function* (_) {
					const pendingMembers = yield* _(
						dbService.query("listPendingMembers", async () => {
							if (query.status !== undefined && query.status !== "pending")
								return [];

							const pendingUsages = await dbService.db
								.select({
									memberId: inviteCodeUsage.memberId,
									userId: inviteCodeUsage.userId,
									usedAt: inviteCodeUsage.usedAt,
									member: {
										organizationId: member.organizationId,
										role: member.role,
										createdAt: member.createdAt,
									},
									user: {
										id: user.id,
										name: user.name,
										email: user.email,
										image: user.image,
									},
									inviteCode: {
										id: inviteCode.id,
										code: inviteCode.code,
										label: inviteCode.label,
										defaultTeamId: inviteCode.defaultTeamId,
									},
								})
								.from(inviteCodeUsage)
								.innerJoin(member, eq(member.id, inviteCodeUsage.memberId))
								.innerJoin(user, eq(user.id, inviteCodeUsage.userId))
								.innerJoin(
									inviteCode,
									eq(inviteCode.id, inviteCodeUsage.inviteCodeId),
								)
								.where(
									and(
										eq(member.organizationId, query.organizationId),
										eq(member.status, "pending"),
										eq(inviteCode.organizationId, query.organizationId),
									),
								)
								.orderBy(desc(inviteCodeUsage.usedAt));

							return pendingUsages.map((usage) => ({
								id: usage.memberId,
								userId: usage.userId,
								organizationId: usage.member.organizationId,
								role: usage.member.role,
								createdAt: usage.member.createdAt,
								user: {
									id: usage.user.id,
									name: usage.user.name,
									email: usage.user.email,
									image: usage.user.image,
								},
								inviteCode: usage.inviteCode,
								usedAt: usage.usedAt,
							}));
						}),
					);

					return pendingMembers;
				}),

			getById: (memberId, organizationId) =>
				Effect.gen(function* (_) {
					const result = yield* _(
						dbService.query("getPendingMemberById", async () => {
							return await getPendingMemberDetails(memberId, organizationId);
						}),
					);

					return result;
				}),

			approve: (input) =>
				Effect.gen(function* (_) {
					// Get member details
					const pendingMember = yield* _(
						dbService.query("getMemberForApproval", async () => {
							return await getPendingMemberDetails(
								input.memberId,
								input.organizationId,
							);
						}),
						Effect.flatMap((memberDetails) =>
							memberDetails
								? Effect.succeed(memberDetails)
								: Effect.fail(
										new NotFoundError({
											message: "Pending member not found",
											entityType: "member",
											entityId: input.memberId,
										}),
									),
						),
					);

					const approval = yield* _(
						dbService.query("approvePendingMember", () =>
							approvePendingMemberAtomically(pendingMember, input),
						),
					);

					if (!approval) {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: "Member is no longer pending approval",
									field: "memberId",
								}),
							),
						);
					}

					yield* _(
						Effect.promise(() =>
							syncBillingSeatsAfterMemberChange({
								organizationId: input.organizationId,
								memberId: input.memberId,
								userId: pendingMember.userId,
								change: "added",
							}),
						),
					);

					return {
						success: true,
						member: pendingMember,
						approval,
					};
				}),

			reject: (input) =>
				Effect.gen(function* (_) {
					const result = yield* _(
						dbService.query("rejectPendingMember", () =>
							rejectPendingMemberAtomically(input),
						),
					);
					if (!result) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Pending member not found",
									entityType: "member",
									entityId: input.memberId,
								}),
							),
						);
					}

					return {
						success: true,
						member: result.pendingMember,
						approval: result.rejection,
					};
				}),

			bulkApprove: (memberIds, organizationId, approvedBy, assignedTeamId) =>
				Effect.gen(function* (_) {
					let approved = 0;
					let failed = 0;

					for (const memberId of memberIds) {
						const pendingMemberResult = yield* _(
							dbService
								.query(`getBulkMember_${memberId}`, () =>
									getPendingMemberDetails(memberId, organizationId),
								)
								.pipe(Effect.either),
						);
						if (
							pendingMemberResult._tag === "Left" ||
							!pendingMemberResult.right
						) {
							failed++;
							continue;
						}
						const pendingMember = pendingMemberResult.right;

						const approvalResult = yield* _(
							dbService
								.query(`bulkApprove_${memberId}`, () =>
									approvePendingMemberAtomically(pendingMember, {
										memberId,
										organizationId,
										approvedBy,
										assignedTeamId,
									}),
								)
								.pipe(Effect.either),
						);
						if (approvalResult._tag === "Left" || !approvalResult.right) {
							failed++;
							continue;
						}

						yield* _(
							Effect.promise(() =>
								syncBillingSeatsAfterMemberChange({
									organizationId,
									memberId,
									userId: pendingMember.userId,
									change: "added",
								}),
							),
						);
						approved++;
					}

					return { approved, failed };
				}),

			bulkReject: (memberIds, organizationId, rejectedBy, notes) =>
				Effect.gen(function* (_) {
					let rejected = 0;
					let failed = 0;

					for (const memberId of new Set(memberIds)) {
						const result = yield* _(
							dbService
								.query(`bulkReject_${memberId}`, () =>
									rejectPendingMemberAtomically({
										memberId,
										organizationId,
										rejectedBy,
										notes,
									}),
								)
								.pipe(Effect.either),
						);
						if (result._tag === "Left" || !result.right) {
							failed++;
							continue;
						}
						rejected++;
					}

					return { rejected, failed };
				}),

			getApprovalHistory: (memberId) =>
				Effect.gen(function* (_) {
					const history = yield* _(
						dbService.query("getApprovalHistory", async () => {
							return await dbService.db.query.memberApproval.findMany({
								where: eq(memberApproval.memberId, memberId),
								orderBy: [desc(memberApproval.approvedAt)],
							});
						}),
					);

					return history;
				}),

			countPending: (organizationId) =>
				Effect.gen(function* (_) {
					const pendingCount = yield* _(
						dbService.query("countPendingMembers", async () => {
							const [result] = await dbService.db
								.select({ count: count() })
								.from(inviteCodeUsage)
								.innerJoin(member, eq(member.id, inviteCodeUsage.memberId))
								.innerJoin(user, eq(user.id, inviteCodeUsage.userId))
								.innerJoin(
									inviteCode,
									eq(inviteCode.id, inviteCodeUsage.inviteCodeId),
								)
								.where(
									and(
										eq(member.organizationId, organizationId),
										eq(member.status, "pending"),
										eq(inviteCode.organizationId, organizationId),
									),
								)
								.execute();
							return result?.count ?? 0;
						}),
					);

					return pendingCount;
				}),
		});
	}),
);
