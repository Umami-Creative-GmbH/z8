import { and, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import {
	type ContractMigrationConflict,
	contractMigrationConflict,
	employee,
	employeeDeparture,
	employeeDepartureReview,
	employeeEmploymentHistory,
} from "@/db/schema";
import type { ContractMigrationConflictStatus } from "@/db/schema/contract-types";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { NotFoundError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import type { EngagementKind } from "@/lib/engagement/engagement-kind";

export interface EnrichedContractMigrationConflict {
	readonly id: string;
	readonly employeeId: string;
	readonly employeeName: string;
	readonly employeeNumber: string | null;
	/** Employee or External Contractor today (#1995): the queue badges and filters contractors. */
	readonly engagementKind: EngagementKind;
	readonly employmentHistoryId: string | null;
	readonly workPolicyId: string | null;
	readonly conflictKind: string;
	readonly status: ContractMigrationConflictStatus;
	readonly details: Record<string, unknown>;
	readonly resolutionNote: string | null;
	readonly createdAt: Date;
	readonly resolvedAt: Date | null;
}

export interface EnrichedRetrospectiveDepartureReview {
	readonly id: string;
	readonly employeeId: string;
	readonly employeeName: string;
	readonly employeeNumber: string | null;
	readonly engagementKind: EngagementKind;
	readonly departureId: string | null;
	readonly lastWorkingDay: string | null;
	readonly kind: "work_after_cutoff" | "payroll_reconciliation";
	readonly status: "open" | "resolved";
	readonly reason: string | null;
	readonly resolution: string | null;
	readonly createdAt: Date;
	readonly resolvedAt: Date | null;
}

export interface ContractsReviewQueueResult {
	readonly migrationConflicts: readonly EnrichedContractMigrationConflict[];
	readonly departureReviews: readonly EnrichedRetrospectiveDepartureReview[];
	readonly migratedLegacyTermsCount: number;
}

function formatPersonName(input: {
	firstName: string | null;
	lastName: string | null;
	userName: string | null;
	email: string | null;
	employeeNumber: string | null;
	employeeId: string;
}): string {
	const full = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
	return full || input.userName || input.email || input.employeeNumber || input.employeeId;
}

export async function listContractMigrationConflicts(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	options: { status?: ContractMigrationConflictStatus; employeeId?: string } = {},
): Promise<ContractMigrationConflict[]> {
	const conditions = [eq(contractMigrationConflict.organizationId, organizationId)];
	if (options.status) {
		conditions.push(eq(contractMigrationConflict.status, options.status));
	}
	if (options.employeeId) {
		conditions.push(eq(contractMigrationConflict.employeeId, options.employeeId));
	}

	return db
		.select()
		.from(contractMigrationConflict)
		.where(and(...conditions))
		.orderBy(desc(contractMigrationConflict.createdAt));
}

export async function listContractsReviewQueue(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	options: { includeResolved?: boolean } = {},
): Promise<ContractsReviewQueueResult> {
	const includeResolved = options.includeResolved ?? false;

	const conflictConditions = [eq(contractMigrationConflict.organizationId, organizationId)];
	if (!includeResolved) {
		conflictConditions.push(eq(contractMigrationConflict.status, "open"));
	}

	const reviewConditions = [
		eq(employeeDepartureReview.organizationId, organizationId),
		inArray(employeeDepartureReview.kind, ["work_after_cutoff", "payroll_reconciliation"]),
	];
	if (!includeResolved) {
		reviewConditions.push(eq(employeeDepartureReview.status, "open"));
	}

	const [conflictRows, reviewRows, legacyCountRows] = await Promise.all([
		db
			.select({
				id: contractMigrationConflict.id,
				employeeId: employee.id,
				employmentHistoryId: contractMigrationConflict.employmentHistoryId,
				workPolicyId: contractMigrationConflict.workPolicyId,
				conflictKind: contractMigrationConflict.conflictKind,
				status: contractMigrationConflict.status,
				details: contractMigrationConflict.details,
				resolutionNote: contractMigrationConflict.resolutionNote,
				createdAt: contractMigrationConflict.createdAt,
				resolvedAt: contractMigrationConflict.resolvedAt,
				firstName: user.firstName,
				lastName: user.lastName,
				employeeNumber: employee.employeeNumber,
				engagementKind: employee.engagementKind,
				userName: user.name,
				email: user.email,
			})
			.from(contractMigrationConflict)
			.innerJoin(
				employee,
				and(
					eq(employee.id, contractMigrationConflict.employeeId),
					eq(employee.organizationId, contractMigrationConflict.organizationId),
				),
			)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(and(...conflictConditions))
			.orderBy(desc(contractMigrationConflict.createdAt))
			.limit(200),
		db
			.select({
				id: employeeDepartureReview.id,
				employeeId: employeeDepartureReview.employeeId,
				departureId: employeeDepartureReview.departureId,
				kind: employeeDepartureReview.kind,
				status: employeeDepartureReview.status,
				metadata: employeeDepartureReview.metadata,
				resolution: employeeDepartureReview.resolution,
				createdAt: employeeDepartureReview.createdAt,
				resolvedAt: employeeDepartureReview.resolvedAt,
				lastWorkingDay: employeeDeparture.lastWorkingDay,
				firstName: user.firstName,
				lastName: user.lastName,
				employeeNumber: employee.employeeNumber,
				engagementKind: employee.engagementKind,
				userName: user.name,
				email: user.email,
			})
			.from(employeeDepartureReview)
			.innerJoin(
				employee,
				and(
					eq(employee.id, employeeDepartureReview.employeeId),
					eq(employee.organizationId, employeeDepartureReview.organizationId),
				),
			)
			.leftJoin(user, eq(user.id, employee.userId))
			.leftJoin(
				employeeDeparture,
				and(
					eq(employeeDeparture.id, employeeDepartureReview.departureId),
					eq(employeeDeparture.organizationId, employeeDepartureReview.organizationId),
				),
			)
			.where(and(...reviewConditions))
			.orderBy(desc(employeeDepartureReview.createdAt))
			.limit(200),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(employee)
			.where(
				and(
					onCurrentRoster(organizationId),
					exists(
						db
							.select({ one: sql`1` })
							.from(employeeEmploymentHistory)
							.where(
								and(
									eq(employeeEmploymentHistory.organizationId, organizationId),
									eq(employeeEmploymentHistory.employeeId, employee.id),
									eq(employeeEmploymentHistory.reviewState, "confirmed"),
									eq(employeeEmploymentHistory.migratedLegacyTerms, true),
									or(
										isNull(employeeEmploymentHistory.validUntilDate),
										sql`${employeeEmploymentHistory.validUntilDate} > ${employeeEmploymentHistory.validFromDate}`,
									),
								),
							),
					),
				),
			),
	]);

	return {
		migrationConflicts: conflictRows.map((row) => ({
			id: row.id,
			employeeId: row.employeeId,
			employeeName: formatPersonName({
				firstName: row.firstName,
				lastName: row.lastName,
				userName: row.userName,
				email: row.email,
				employeeNumber: row.employeeNumber,
				employeeId: row.employeeId,
			}),
			employeeNumber: row.employeeNumber,
			engagementKind: row.engagementKind,
			employmentHistoryId: row.employmentHistoryId,
			workPolicyId: row.workPolicyId,
			conflictKind: row.conflictKind,
			status: row.status,
			details: (row.details ?? {}) as Record<string, unknown>,
			resolutionNote: row.resolutionNote,
			createdAt: row.createdAt,
			resolvedAt: row.resolvedAt,
		})),
		departureReviews: reviewRows
			.filter(
				(
					row,
				): row is typeof row & {
					kind: "work_after_cutoff" | "payroll_reconciliation";
				} => row.kind === "work_after_cutoff" || row.kind === "payroll_reconciliation",
			)
			.map((row) => {
				const metadata = row.metadata as { reason?: unknown } | null;
				return {
					id: row.id,
					employeeId: row.employeeId,
					employeeName: formatPersonName({
						firstName: row.firstName,
						lastName: row.lastName,
						userName: row.userName,
						email: row.email,
						employeeNumber: row.employeeNumber,
						employeeId: row.employeeId,
					}),
					employeeNumber: row.employeeNumber,
					engagementKind: row.engagementKind,
					departureId: row.departureId,
					lastWorkingDay: row.lastWorkingDay ?? null,
					kind: row.kind,
					status: row.status === "resolved" ? "resolved" : "open",
					reason: typeof metadata?.reason === "string" ? metadata.reason : null,
					resolution: row.resolution,
					createdAt: row.createdAt,
					resolvedAt: row.resolvedAt,
				};
			}),
		migratedLegacyTermsCount: Number(legacyCountRows[0]?.count ?? 0),
	};
}

export async function resolveContractMigrationConflict(
	db: DatabaseClient,
	input: {
		organizationId: string;
		conflictId: string;
		actorUserId: string;
		status: "resolved" | "dismissed";
		resolutionNote?: string | null;
	},
): Promise<ContractMigrationConflict> {
	const [updated] = await db
		.update(contractMigrationConflict)
		.set({
			status: input.status,
			resolvedAt: currentTimestamp(),
			resolvedBy: input.actorUserId,
			resolutionNote: input.resolutionNote?.trim() || null,
		})
		.where(
			and(
				eq(contractMigrationConflict.id, input.conflictId),
				eq(contractMigrationConflict.organizationId, input.organizationId),
			),
		)
		.returning();

	if (!updated) {
		throw new NotFoundError({
			message: "Contract migration conflict not found",
			entityType: "contract_migration_conflict",
			entityId: input.conflictId,
		});
	}
	return updated;
}
