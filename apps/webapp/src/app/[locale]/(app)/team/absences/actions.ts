"use server";

import { and, asc, count, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeManagers,
	employeeVacationAllowance,
	team,
	timeRecord,
	timeRecordAbsence,
	vacationAllowance,
} from "@/db/schema";
import {
	calculateBusinessDaysWithHalfDays,
	dateRangesOverlap,
} from "@/lib/absences/date-utils";
import {
	normalizeAbsenceDurationInput,
	toAbsenceEntryDurationFields,
} from "@/lib/absences/duration";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import type { ServerActionResult } from "@/lib/effect/result";
import { createLogger } from "@/lib/logger";
import { addCalendarSyncJob } from "@/lib/queue";
import {
	buildCanonicalAbsenceRecordValues,
	getAbsenceOverlapConflictMessage,
	managerAbsenceAdvisoryLockKey,
	normalizeManagerAbsenceListParams,
	validateRecordAbsenceDateRange,
} from "./manager-absence-action-helpers";
import { calculateManagerAbsenceMetrics } from "./manager-absence-metrics";
import { canActorManageTarget, canUseManagerAbsencePage } from "./manager-absence-permissions";
import type {
	ManagerAbsenceActor,
	ManagerAbsenceEmployeeRow,
	ManagerAbsenceListParams,
	ManagerAbsenceListResult,
	RecordAbsenceForEmployeeInput,
} from "./manager-absence-types";

const logger = createLogger("ManagerAbsenceActions");
const ACCESS_ERROR = "Employee not found or not accessible";

type ActorEmployee = typeof employee.$inferSelect & {
	user: { name: string; email: string };
};

type ListedEmployee = Pick<
	typeof employee.$inferSelect,
	"id" | "userId" | "employeeNumber" | "position" | "role" | "organizationId" | "isActive"
> & {
	userName: string;
	userEmail: string;
	teamName: string | null;
};

type TargetEmployee = typeof employee.$inferSelect & {
	user: { name: string; email: string };
};

export async function getManagerAbsenceEmployees(
	params: Partial<ManagerAbsenceListParams>,
): Promise<ServerActionResult<ManagerAbsenceListResult>> {
	try {
		const actorResult = await resolveActor();
		if (!actorResult.success) return actorResult;

		const actor = actorResult.data;
		const normalized = normalizeManagerAbsenceListParams(params);
		const search = normalized.search ? `%${normalized.search}%` : null;
		const baseConditions = [
			eq(employee.organizationId, actor.organizationId),
			eq(employee.isActive, true),
		];

		if (search) {
			baseConditions.push(
				or(ilike(employee.employeeNumber, search), ilike(user.name, search), ilike(user.email, search))!,
			);
		}

		const offset = (normalized.page - 1) * normalized.pageSize;
		const totalRows =
			actor.role === "manager"
				? await db
						.select({ value: count() })
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.innerJoin(employeeManagers, eq(employeeManagers.employeeId, employee.id))
						.where(and(...baseConditions, eq(employeeManagers.managerId, actor.id)))
				: await db
						.select({ value: count() })
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.where(and(...baseConditions));

		const rows =
			actor.role === "manager"
				? await selectVisibleEmployees(baseConditions, normalized.pageSize, offset, actor.id)
				: await selectVisibleEmployees(baseConditions, normalized.pageSize, offset);

		const rowsWithMetrics = await addMetricsToRows(rows, normalized.year, actor.organizationId);
		const total = totalRows[0]?.value ?? 0;

		return {
			success: true,
			data: {
				rows: rowsWithMetrics,
				total,
				page: normalized.page,
				pageSize: normalized.pageSize,
				year: normalized.year,
				pageCount: Math.ceil(total / normalized.pageSize),
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to list manager absence employees");
		return { success: false, error: "Failed to load employees", code: "UNKNOWN_ERROR" };
	}
}

export async function recordAbsenceForEmployee(
	input: RecordAbsenceForEmployeeInput,
): Promise<ServerActionResult<{ absenceId: string }>> {
	try {
		const actorResult = await resolveActor();
		if (!actorResult.success) return actorResult;

		const actor = actorResult.data;
		const normalizedInput = normalizeAbsenceDurationInput(input);
		const dateError = validateRecordAbsenceDateRange({
			categoryId: normalizedInput.categoryId,
			startDate: normalizedInput.startDate,
			startPeriod: normalizedInput.startPeriod,
			endDate: normalizedInput.endDate,
			endPeriod: normalizedInput.endPeriod,
			durationKind: input.durationKind,
			startTime: normalizedInput.startTime,
			endTime: normalizedInput.endTime,
		});
		if (dateError) {
			return { success: false, error: dateError, code: "ValidationError" };
		}

		const targetResult = await resolveAccessibleTarget(actor, input.employeeId);
		if (!targetResult.success) return targetResult;

		const target = targetResult.data;
		const category = await db.query.absenceCategory.findFirst({
			where: and(
				eq(absenceCategory.id, normalizedInput.categoryId),
				eq(absenceCategory.organizationId, actor.organizationId),
				eq(absenceCategory.isActive, true),
			),
		});

		if (!category) {
			return { success: false, error: "Invalid absence category", code: "NotFoundError" };
		}

		const transactionResult = await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext(${managerAbsenceAdvisoryLockKey(target.id)}))`,
			);

			const existingAbsences = await tx
				.select({
					id: absenceEntry.id,
					status: absenceEntry.status,
					startDate: absenceEntry.startDate,
					endDate: absenceEntry.endDate,
				})
				.from(absenceEntry)
				.where(
					and(
						eq(absenceEntry.employeeId, target.id),
						eq(absenceEntry.organizationId, actor.organizationId),
						or(eq(absenceEntry.status, "pending"), eq(absenceEntry.status, "approved")),
					),
				);

			const overlap = existingAbsences.find((absence) =>
				dateRangesOverlap(
					normalizedInput.startDate,
					normalizedInput.endDate,
					absence.startDate,
					absence.endDate,
				),
			);
			if (overlap && overlap.status !== "rejected") {
				return {
					success: false as const,
					error: getAbsenceOverlapConflictMessage(overlap.status),
				};
			}

			const entryDuration = toAbsenceEntryDurationFields(normalizedInput);
			const [absence] = await tx
				.insert(absenceEntry)
				.values({
					employeeId: target.id,
					organizationId: actor.organizationId,
					categoryId: normalizedInput.categoryId,
					startDate: entryDuration.startDate,
					startPeriod: entryDuration.startPeriod,
					endDate: entryDuration.endDate,
					endPeriod: entryDuration.endPeriod,
					notes: normalizedInput.notes,
					status: "approved",
					approvedBy: actor.id,
					approvedAt: currentTimestamp(),
				})
				.returning({ id: absenceEntry.id });

			const canonicalValues = buildCanonicalAbsenceRecordValues({
				organizationId: actor.organizationId,
				employeeId: target.id,
				categoryId: normalizedInput.categoryId,
				startDate: normalizedInput.startDate,
				startPeriod: normalizedInput.startPeriod,
				endDate: normalizedInput.endDate,
				endPeriod: normalizedInput.endPeriod,
				durationKind: input.durationKind,
				startTime: normalizedInput.startTime,
				endTime: normalizedInput.endTime,
				countsAgainstVacation: category.countsAgainstVacation,
				createdBy: actor.userId,
			});

			const [canonicalRecord] = await tx
				.insert(timeRecord)
				.values(canonicalValues.timeRecord)
				.returning({ id: timeRecord.id });

			await tx.insert(timeRecordAbsence).values({
				...canonicalValues.timeRecordAbsence,
				recordId: canonicalRecord.id,
			});

			await tx
				.update(absenceEntry)
				.set({ canonicalRecordId: canonicalRecord.id })
				.where(and(eq(absenceEntry.id, absence.id), eq(absenceEntry.organizationId, actor.organizationId)));

			return { success: true as const, absenceId: absence.id };
		});

		if (!transactionResult.success) {
			return { success: false, error: transactionResult.error, code: "ConflictError" };
		}

		void addCalendarSyncJob({
			absenceId: transactionResult.absenceId,
			employeeId: target.id,
			action: "create",
		}).catch((error) =>
			logger.error(
				{ error, absenceId: transactionResult.absenceId },
				"Failed to queue calendar sync",
			),
		);

		void notifyEmployeeOfManagerRecordedAbsence({
			absenceId: transactionResult.absenceId,
			actor,
			target,
			categoryName: category.name,
			input: { ...input, ...normalizedInput, durationKind: input.durationKind },
		});

		return { success: true, data: { absenceId: transactionResult.absenceId } };
	} catch (error) {
		logger.error({ error }, "Failed to record absence for employee");
		return { success: false, error: "Failed to record absence", code: "UNKNOWN_ERROR" };
	}
}

async function resolveActor(): Promise<ServerActionResult<ManagerAbsenceActor>> {
	const { auth } = await import("@/lib/auth");
	const session = await auth.api.getSession({ headers: await headers() });
	const activeOrganizationId = session?.session.activeOrganizationId;

	if (!session?.user || !activeOrganizationId) {
		return { success: false, error: "Authentication required", code: "AuthenticationError" };
	}

	const actor = (await db.query.employee.findFirst({
		where: and(
			eq(employee.userId, session.user.id),
			eq(employee.organizationId, activeOrganizationId),
			eq(employee.isActive, true),
		),
		with: { user: true },
	})) as ActorEmployee | undefined;

	if (!actor) {
		return { success: false, error: "Employee profile not found", code: "NotFoundError" };
	}

	if (!canUseManagerAbsencePage(actor.role)) {
		return { success: false, error: "Not authorized", code: "AuthorizationError" };
	}

	return {
		success: true,
		data: {
			id: actor.id,
			userId: actor.userId,
			organizationId: actor.organizationId,
			role: actor.role,
			name: actor.user.name,
		},
	};
}

async function selectVisibleEmployees(
	baseConditions: NonNullable<Parameters<typeof and>[number]>[],
	limit: number,
	offset: number,
	managerId?: string,
): Promise<ListedEmployee[]> {
	const selectedFields = {
		id: employee.id,
		userId: employee.userId,
		employeeNumber: employee.employeeNumber,
		position: employee.position,
		role: employee.role,
		organizationId: employee.organizationId,
		isActive: employee.isActive,
		userName: user.name,
		userEmail: user.email,
		teamName: team.name,
	};

	const query = db
		.select(selectedFields)
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.leftJoin(team, eq(employee.teamId, team.id));

	if (managerId) {
		return await query
			.innerJoin(employeeManagers, eq(employeeManagers.employeeId, employee.id))
			.where(and(...baseConditions, eq(employeeManagers.managerId, managerId)))
			.orderBy(asc(user.name), asc(employee.employeeNumber))
			.limit(limit)
			.offset(offset);
	}

	return await query
		.where(and(...baseConditions))
		.orderBy(asc(user.name), asc(employee.employeeNumber))
		.limit(limit)
		.offset(offset);
}

async function addMetricsToRows(
	rows: ListedEmployee[],
	year: number,
	organizationId: string,
): Promise<ManagerAbsenceEmployeeRow[]> {
	if (rows.length === 0) {
		return [];
	}

	const employeeIds = rows.map((row) => row.id);
	const [allowance, employeeAllowances, absences] = await Promise.all([
		db.query.vacationAllowance.findFirst({
			where: and(
				eq(vacationAllowance.organizationId, organizationId),
				eq(vacationAllowance.isActive, true),
				eq(vacationAllowance.isCompanyDefault, true),
				isNull(vacationAllowance.validUntil),
			),
		}),
		db.query.employeeVacationAllowance.findMany({
			where: and(
				inArray(employeeVacationAllowance.employeeId, employeeIds),
				eq(employeeVacationAllowance.year, year),
			),
		}),
		db.query.absenceEntry.findMany({
			where: and(
				eq(absenceEntry.organizationId, organizationId),
				inArray(absenceEntry.employeeId, employeeIds),
			),
			with: { category: true },
		}),
	]);

	const allowancesByEmployeeId = new Map(
		employeeAllowances.map((employeeAllowance) => [employeeAllowance.employeeId, employeeAllowance]),
	);
	const absencesByEmployeeId = new Map<string, AbsenceWithCategory[]>();
	for (const absence of absences as AbsenceWithCategory[]) {
		const existing = absencesByEmployeeId.get(absence.employeeId) ?? [];
		existing.push(absence);
		absencesByEmployeeId.set(absence.employeeId, existing);
	}

	return rows.map((row) => {
		const metrics = calculateManagerAbsenceMetrics({
			year,
			allowance: allowance
				? {
						defaultAnnualDays: allowance.defaultAnnualDays,
						allowCarryover: allowance.allowCarryover,
						maxCarryoverDays: allowance.maxCarryoverDays,
						carryoverExpiryMonths: allowance.carryoverExpiryMonths,
					}
				: null,
			employeeAllowance: allowancesByEmployeeId.get(row.id) ?? null,
			absences: absencesByEmployeeId.get(row.id) ?? [],
		});

		return {
			id: row.id,
			userId: row.userId,
			name: row.userName,
			email: row.userEmail,
			employeeNumber: row.employeeNumber,
			position: row.position,
			role: row.role,
			teamName: row.teamName,
			...metrics,
		};
	});
}

async function resolveAccessibleTarget(
	actor: ManagerAbsenceActor,
	employeeId: string,
): Promise<ServerActionResult<TargetEmployee>> {
	const target = (await db.query.employee.findFirst({
		where: and(
			eq(employee.id, employeeId),
			eq(employee.organizationId, actor.organizationId),
			eq(employee.isActive, true),
		),
		with: { user: true },
	})) as TargetEmployee | undefined;

	if (!target) {
		return { success: false, error: ACCESS_ERROR, code: "NotFoundError" };
	}

	const managerRows = await db.query.employeeManagers.findMany({
		where: eq(employeeManagers.employeeId, target.id),
		columns: { managerId: true },
	});

	const canAccess = canActorManageTarget({
		actor,
		target,
		managerIdsForTarget: managerRows.map((row) => row.managerId),
	});

	if (!canAccess) {
		return { success: false, error: ACCESS_ERROR, code: "NotFoundError" };
	}

	return { success: true, data: target };
}

async function notifyEmployeeOfManagerRecordedAbsence(params: {
	absenceId: string;
	actor: ManagerAbsenceActor;
	target: TargetEmployee;
	categoryName: string;
	input: RecordAbsenceForEmployeeInput;
}) {
	try {
		const { onAbsenceRecordedByManager } = await import("@/lib/notifications/triggers");
		const days = calculateBusinessDaysWithHalfDays(
			params.input.startDate,
			params.input.startPeriod,
			params.input.endDate,
			params.input.endPeriod,
			[],
		);

		await onAbsenceRecordedByManager({
			absenceId: params.absenceId,
			employeeUserId: params.target.userId,
			employeeName: params.target.user.name,
			organizationId: params.actor.organizationId,
			categoryName: params.categoryName,
			startDate: params.input.startDate,
			endDate: params.input.endDate,
			managerName: params.actor.name,
			days,
		});
	} catch (error) {
		logger.error(
			{ error, absenceId: params.absenceId },
			"Failed to notify employee about manager-recorded absence",
		);
	}
}
