import { and, desc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
	inviteCodeUsage,
	memberApproval,
	employee,
	team,
	teamPermissions,
} from "@/db/schema";
import { member, organization, user } from "@/db/auth-schema";
import { type DatabaseError, NotFoundError, ValidationError, AuthorizationError } from "../errors";
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
		) => Effect.Effect<ApprovalResult, NotFoundError | ValidationError | AuthorizationError | DatabaseError>;

		// Reject a pending member
		readonly reject: (
			input: RejectMemberInput,
		) => Effect.Effect<ApprovalResult, NotFoundError | ValidationError | AuthorizationError | DatabaseError>;

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

		// Helper to check if member is pending (based on invite code usage without approval)
		const getPendingMemberDetails = async (
			memberId: string,
			organizationId: string,
		): Promise<PendingMember | null> => {
			// Get the member with user details
			const memberRecord = await dbService.db.query.member.findFirst({
				where: and(eq(member.id, memberId), eq(member.organizationId, organizationId)),
			});

			if (!memberRecord) return null;

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

		return PendingMemberService.of({
			listPending: (query) =>
				Effect.gen(function* (_) {
					const pendingMembers = yield* _(
						dbService.query("listPendingMembers", async () => {
							// Get all members who joined via invite code and don't have an approval yet
							const usages = await dbService.db.query.inviteCodeUsage.findMany({
								with: {
									inviteCode: {
										columns: {
											id: true,
											code: true,
											label: true,
											organizationId: true,
											defaultTeamId: true,
										},
									},
									member: true,
									user: {
										columns: {
											id: true,
											name: true,
											email: true,
											image: true,
										},
									},
								},
								orderBy: [desc(inviteCodeUsage.usedAt)],
							});

							// Filter by organization
							const orgUsages = usages.filter(
								(u) => u.inviteCode?.organizationId === query.organizationId,
							);

							// Get all approvals for these members
							const memberIds = orgUsages.map((u) => u.memberId);
							const approvals =
								memberIds.length > 0
									? await dbService.db.query.memberApproval.findMany({
											where: sql`${memberApproval.memberId} = ANY(${memberIds})`,
										})
									: [];

							const approvalMap = new Map(approvals.map((a) => [a.memberId, a]));

							// Filter to only pending (no approval record yet)
							const pendingUsages =
								query.status === undefined || query.status === "pending"
									? orgUsages.filter((u) => !approvalMap.has(u.memberId))
									: [];

							return pendingUsages.map((usage) => ({
								id: usage.memberId,
								userId: usage.userId,
								organizationId: query.organizationId,
								role: usage.member?.role || "member",
								createdAt: usage.member?.createdAt || usage.usedAt,
								user: {
									id: usage.user?.id || usage.userId,
									name: usage.user?.name || "Unknown",
									email: usage.user?.email || "",
									image: usage.user?.image || null,
								},
								inviteCode: usage.inviteCode
									? {
											id: usage.inviteCode.id,
											code: usage.inviteCode.code,
											label: usage.inviteCode.label,
											defaultTeamId: usage.inviteCode.defaultTeamId,
										}
									: null,
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
					const memberDetails = yield* _(
						dbService.query("getMemberForApproval", async () => {
							return await getPendingMemberDetails(input.memberId, input.organizationId);
						}),
					);

					if (!memberDetails) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Pending member not found",
									entityType: "member",
									entityId: input.memberId,
								}),
							),
						);
					}

					// Check if already approved
					const existingApproval = yield* _(
						dbService.query("checkExistingApproval", async () => {
							return await dbService.db.query.memberApproval.findFirst({
								where: eq(memberApproval.memberId, input.memberId),
							});
						}),
					);

					if (existingApproval) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: `Member has already been ${existingApproval.status}`,
									field: "memberId",
								}),
							),
						);
					}

					// Validate team if provided
					if (input.assignedTeamId) {
						const teamRecord = yield* _(
							dbService.query("validateTeam", async () => {
								return await dbService.db.query.team.findFirst({
									where: and(
										eq(team.id, input.assignedTeamId!),
										eq(team.organizationId, input.organizationId),
									),
								});
							}),
						);

						if (!teamRecord) {
							yield* _(
								Effect.fail(
									new ValidationError({
										message: "Invalid team. Team not found in this organization.",
										field: "assignedTeamId",
									}),
								),
							);
						}
					}

					// Create approval record
					const approval = yield* _(
						dbService.query("createApproval", async () => {
							const [result] = await dbService.db
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
							return result;
						}),
					);

					// Create employee record for the approved member
					yield* _(
						dbService.query("createEmployeeRecord", async () => {
							// Check if employee already exists
							const existingEmployee = await dbService.db.query.employee.findFirst({
								where: and(
									eq(employee.userId, memberDetails!.userId),
									eq(employee.organizationId, input.organizationId),
								),
							});

							if (!existingEmployee) {
								const [newEmployee] = await dbService.db
									.insert(employee)
									.values({
										userId: memberDetails!.userId,
										organizationId: input.organizationId,
										teamId: input.assignedTeamId,
										role: "employee",
										isActive: true,
									})
									.returning();

								return newEmployee;
							}

							// Update existing employee if needed
							if (existingEmployee && !existingEmployee.isActive) {
								await dbService.db
									.update(employee)
									.set({
										isActive: true,
										teamId: input.assignedTeamId || existingEmployee.teamId,
									})
									.where(eq(employee.id, existingEmployee.id));
							}

							return existingEmployee;
						}),
					);

					return {
						success: true,
						member: memberDetails!,
						approval,
					};
				}),

			reject: (input) =>
				Effect.gen(function* (_) {
					// Get member details
					const memberDetails = yield* _(
						dbService.query("getMemberForRejection", async () => {
							return await getPendingMemberDetails(input.memberId, input.organizationId);
						}),
					);

					if (!memberDetails) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Pending member not found",
									entityType: "member",
									entityId: input.memberId,
								}),
							),
						);
					}

					// Check if already processed
					const existingApproval = yield* _(
						dbService.query("checkExistingApproval", async () => {
							return await dbService.db.query.memberApproval.findFirst({
								where: eq(memberApproval.memberId, input.memberId),
							});
						}),
					);

					if (existingApproval) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: `Member has already been ${existingApproval.status}`,
									field: "memberId",
								}),
							),
						);
					}

					// Create rejection record
					const rejection = yield* _(
						dbService.query("createRejection", async () => {
							const [result] = await dbService.db
								.insert(memberApproval)
								.values({
									memberId: input.memberId,
									organizationId: input.organizationId,
									status: "rejected",
									approvedBy: input.rejectedBy,
									notes: input.notes,
								})
								.returning();
							return result;
						}),
					);

					// Remove the member record
					yield* _(
						dbService.query("removeMember", async () => {
							await dbService.db.delete(member).where(eq(member.id, input.memberId));
						}),
					);

					return {
						success: true,
						member: memberDetails!,
						approval: rejection,
					};
				}),

			bulkApprove: (memberIds, organizationId, approvedBy, assignedTeamId) =>
				Effect.gen(function* (_) {
					let approved = 0;
					let failed = 0;

					for (const memberId of memberIds) {
						try {
							yield* _(
								dbService.query(`bulkApprove_${memberId}`, async () => {
									// Check if already approved
									const existing = await dbService.db.query.memberApproval.findFirst({
										where: eq(memberApproval.memberId, memberId),
									});

									if (existing) {
										failed++;
										return;
									}

									// Get member details
									const memberRecord = await dbService.db.query.member.findFirst({
										where: and(
											eq(member.id, memberId),
											eq(member.organizationId, organizationId),
										),
									});

									if (!memberRecord) {
										failed++;
										return;
									}

									// Create approval
									await dbService.db.insert(memberApproval).values({
										memberId,
										organizationId,
										status: "approved",
										assignedTeamId,
										approvedBy,
									});

									// Create employee record
									const existingEmployee = await dbService.db.query.employee.findFirst({
										where: and(
											eq(employee.userId, memberRecord.userId),
											eq(employee.organizationId, organizationId),
										),
									});

									if (!existingEmployee) {
										await dbService.db.insert(employee).values({
											userId: memberRecord.userId,
											organizationId,
											teamId: assignedTeamId,
											role: "employee",
											isActive: true,
										});
									}

									approved++;
								}),
							);
						} catch {
							failed++;
						}
					}

					return { approved, failed };
				}),

			bulkReject: (memberIds, organizationId, rejectedBy, notes) =>
				Effect.gen(function* (_) {
					let rejected = 0;
					let failed = 0;

					for (const memberId of memberIds) {
						try {
							yield* _(
								dbService.query(`bulkReject_${memberId}`, async () => {
									// Check if already processed
									const existing = await dbService.db.query.memberApproval.findFirst({
										where: eq(memberApproval.memberId, memberId),
									});

									if (existing) {
										failed++;
										return;
									}

									// Create rejection
									await dbService.db.insert(memberApproval).values({
										memberId,
										organizationId,
										status: "rejected",
										approvedBy: rejectedBy,
										notes,
									});

									// Remove member
									await dbService.db.delete(member).where(eq(member.id, memberId));

									rejected++;
								}),
							);
						} catch {
							failed++;
						}
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
					const count = yield* _(
						dbService.query("countPendingMembers", async () => {
							// Get all usages for this org
							const usages = await dbService.db.query.inviteCodeUsage.findMany({
								with: {
									inviteCode: {
										columns: {
											organizationId: true,
										},
									},
								},
							});

							const orgUsages = usages.filter(
								(u) => u.inviteCode?.organizationId === organizationId,
							);

							if (orgUsages.length === 0) return 0;

							// Get approvals
							const memberIds = orgUsages.map((u) => u.memberId);
							const approvals = await dbService.db.query.memberApproval.findMany({
								where: sql`${memberApproval.memberId} = ANY(${memberIds})`,
							});

							const approvedIds = new Set(approvals.map((a) => a.memberId));
							return orgUsages.filter((u) => !approvedIds.has(u.memberId)).length;
						}),
					);

					return count;
				}),
		});
	}),
);
