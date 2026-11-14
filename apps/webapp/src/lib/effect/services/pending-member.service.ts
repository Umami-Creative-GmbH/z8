import { and, count, desc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { member, user } from "@/db/auth-schema";
import {
	auditLog,
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
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { joinOrganization } from "@/lib/employee-lifecycle/joining";
import { acquireExclusiveUserConfigurationAccessGuards } from "@/lib/time-tracking/work-transaction";
import {
	type AuthorizationError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { DatabaseService } from "./database.service";

// Type definitions
type MemberApproval = typeof memberApproval.$inferSelect;
type ApprovalStatus = "pending" | "approved" | "rejected";

/**
 * How the person asked to join. A pending membership without an invite code
 * comes from a sign-in through the organization's identity provider (#1668).
 */
export type PendingMemberSource = "invite_code" | "sso";

export interface PendingMember {
	id: string; // member ID
	userId: string;
	organizationId: string;
	/** The organization role approval grants: the invite code's, or the identity provider's. */
	role: string;
	source: PendingMemberSource;
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

export class PendingMemberService extends Context.Service<
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
>()("PendingMemberService") {}

function pendingMemberSource(inviteCodeId: string | null | undefined): PendingMemberSource {
	return inviteCodeId ? "invite_code" : "sso";
}

export const PendingMemberServiceLive = Layer.effect(
	PendingMemberService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;

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
				source: pendingMemberSource(usage?.inviteCode?.id ?? memberRecord.inviteCodeId),
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
		) => {
			// Approval grants membership and activates the employee, so the member's
			// configuration/access protection precedes the identity lock (#313).
			const approved = await withAuthorizationMutation(
				{ organizationId: input.organizationId, userIds: [pendingMember.userId] },
				async (tx) => {
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

					const [approval] = await tx
						.insert(memberApproval)
						.values({
							memberId: input.memberId,
							organizationId: input.organizationId,
							status: "approved",
							assignedTeamId: input.assignedTeamId,
							approvedBy: input.approvedBy,
							notes: input.notes,
						})
						.returning();

					// The approved membership joins the organization (spec #1664): the
					// assigned team places a new or returning employee, the approver is the actor.
					const joining = await joinOrganization(tx, {
						organizationId: input.organizationId,
						userId: approvedMember.userId,
						membership: { id: approvedMember.id, role: approvedMember.role },
						teamId: input.assignedTeamId,
						actorUserId: input.approvedBy,
					});

					return { approval, joining };
				},
				dbService.db,
			);
			// Joining's audit forwarding and seat signal run once the approval committed.
			await approved?.joining.afterCommit.run();
			return approved;
		};

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

				// Rejection removes the membership and revokes the user's access: their
				// exclusive guard precedes the identity lock and the member row lock (#318).
				await acquireExclusiveUserConfigurationAccessGuards(tx, [candidate.userId]);
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
					source: pendingMemberSource(usage?.inviteCode?.id ?? memberRecord.inviteCodeId),
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

				// An invite-code request is audited under its code; an SSO request,
				// which has none, under the membership it asked for (#1668).
				const inviteIdentity =
					usage?.inviteCode?.id ?? memberRecord.inviteCodeId ?? null;

				await tx.insert(auditLog).values({
					organizationId: input.organizationId,
					entityType: "membership",
					entityId: inviteIdentity ?? memberRecord.id,
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
						source: pendingMember.source,
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
					{ actorUserId: input.rejectedBy },
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
				Effect.gen(function* () {
					const pendingMembers = yield* dbService.query("listPendingMembers", async () => {
						if (query.status !== undefined && query.status !== "pending")
							return [];

						// Every pending membership: an invite code's request carries its
						// usage; an SSO sign-in's has none (#1668).
						const pendingRows = await dbService.db
							.select({
								memberId: member.id,
								userId: member.userId,
								organizationId: member.organizationId,
								role: member.role,
								createdAt: member.createdAt,
								memberInviteCodeId: member.inviteCodeId,
								usedAt: inviteCodeUsage.usedAt,
								user: {
									id: user.id,
									name: user.name,
									email: user.email,
									image: user.image,
								},
								inviteCodeId: inviteCode.id,
								inviteCodeCode: inviteCode.code,
								inviteCodeLabel: inviteCode.label,
								inviteCodeDefaultTeamId: inviteCode.defaultTeamId,
							})
							.from(member)
							.innerJoin(user, eq(user.id, member.userId))
							.leftJoin(inviteCodeUsage, eq(inviteCodeUsage.memberId, member.id))
							.leftJoin(
								inviteCode,
								and(
									eq(inviteCode.id, inviteCodeUsage.inviteCodeId),
									eq(inviteCode.organizationId, query.organizationId),
								),
							)
							.where(
								and(
									eq(member.organizationId, query.organizationId),
									eq(member.status, "pending"),
								),
							)
							.orderBy(desc(sql`coalesce(${inviteCodeUsage.usedAt}, ${member.createdAt})`));

						return pendingRows.map(
							(row): PendingMember => ({
								id: row.memberId,
								userId: row.userId,
								organizationId: row.organizationId,
								role: row.role,
								source: pendingMemberSource(row.inviteCodeId ?? row.memberInviteCodeId),
								createdAt: row.createdAt,
								user: row.user,
								inviteCode: row.inviteCodeId
									? {
											id: row.inviteCodeId,
											code: row.inviteCodeCode ?? "",
											label: row.inviteCodeLabel ?? "",
											defaultTeamId: row.inviteCodeDefaultTeamId,
										}
									: null,
								usedAt: row.usedAt ?? undefined,
							}),
						);
					});

					return pendingMembers;
				}),

			getById: (memberId, organizationId) =>
				Effect.gen(function* () {
					const result = yield* dbService.query("getPendingMemberById", async () => {
						return await getPendingMemberDetails(memberId, organizationId);
					});

					return result;
				}),

			approve: (input) =>
				Effect.gen(function* () {
					// Get member details
					const pendingMember = yield* dbService.query("getMemberForApproval", async () => {
							return await getPendingMemberDetails(
								input.memberId,
								input.organizationId,
							);
						}).pipe(Effect.flatMap((memberDetails) =>
							memberDetails
								? Effect.succeed(memberDetails)
								: Effect.fail(
										new NotFoundError({
											message: "Pending member not found",
											entityType: "member",
											entityId: input.memberId,
										}),
									),
						));

					const approved = yield* dbService.query("approvePendingMember", () =>
						approvePendingMemberAtomically(pendingMember, input),
					);

					if (!approved) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Member is no longer pending approval",
								field: "memberId",
							}),
						);
					}
					const { approval } = approved;

					return {
						success: true,
						member: pendingMember,
						approval,
					};
				}),

			reject: (input) =>
				Effect.gen(function* () {
					const result = yield* dbService.query("rejectPendingMember", () =>
						rejectPendingMemberAtomically(input),
					);
					if (!result) {
						return yield* Effect.fail(
							new NotFoundError({
								message: "Pending member not found",
								entityType: "member",
								entityId: input.memberId,
							}),
						);
					}

					return {
						success: true,
						member: result.pendingMember,
						approval: result.rejection,
					};
				}),

			bulkApprove: (memberIds, organizationId, approvedBy, assignedTeamId) =>
				Effect.gen(function* () {
					let approved = 0;
					let failed = 0;

					for (const memberId of memberIds) {
						const pendingMemberResult = yield* dbService
							.query(`getBulkMember_${memberId}`, () =>
								getPendingMemberDetails(memberId, organizationId),
							)
							.pipe(Effect.result);
						if (
							pendingMemberResult._tag === "Failure" ||
							!pendingMemberResult.success
						) {
							failed++;
							continue;
						}
						const pendingMember = pendingMemberResult.success;

						const approvalResult = yield* dbService
							.query(`bulkApprove_${memberId}`, () =>
								approvePendingMemberAtomically(pendingMember, {
									memberId,
									organizationId,
									approvedBy,
									assignedTeamId,
								}),
							)
							.pipe(Effect.result);
						if (approvalResult._tag === "Failure" || !approvalResult.success) {
							failed++;
							continue;
						}
						approved++;
					}

					return { approved, failed };
				}),

			bulkReject: (memberIds, organizationId, rejectedBy, notes) =>
				Effect.gen(function* () {
					let rejected = 0;
					let failed = 0;

					for (const memberId of new Set(memberIds)) {
						const result = yield* dbService
							.query(`bulkReject_${memberId}`, () =>
								rejectPendingMemberAtomically({
									memberId,
									organizationId,
									rejectedBy,
									notes,
								}),
							)
							.pipe(Effect.result);
						if (result._tag === "Failure" || !result.success) {
							failed++;
							continue;
						}
						rejected++;
					}

					return { rejected, failed };
				}),

			getApprovalHistory: (memberId) =>
				Effect.gen(function* () {
					const history = yield* dbService.query("getApprovalHistory", async () => {
						return await dbService.db.query.memberApproval.findMany({
							where: eq(memberApproval.memberId, memberId),
							orderBy: [desc(memberApproval.approvedAt)],
						});
					});

					return history;
				}),

			countPending: (organizationId) =>
				Effect.gen(function* () {
					const pendingCount = yield* dbService.query("countPendingMembers", async () => {
						const [result] = await dbService.db
							.select({ count: count() })
							.from(member)
							.innerJoin(user, eq(user.id, member.userId))
							.where(
								and(
									eq(member.organizationId, organizationId),
									eq(member.status, "pending"),
								),
							)
							.execute();
						return result?.count ?? 0;
					});

					return pendingCount;
				}),
		});
	}),
);
