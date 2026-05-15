"use server";

import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
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
	buildInaccessibleTeamAbsenceListResult,
	clampManagerAbsencePage,
	getAbsenceOverlapConflictMessage,
	isManagerAbsenceMetricSort,
	managerAbsenceAdvisoryLockKey,
	type ManagerAbsenceListInput,
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
	ManagerAbsenceSortDirection,
	ManagerAbsenceSortKey,
	ManagerAbsenceTeamOption,
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
	userImage: string | null;
	teamId: string | null;
	teamName: string | null;
};

type TargetEmployee = typeof employee.$inferSelect & {
	user: { name: string; email: string };
};

export async function getManagerAbsenceEmployees(
	params: ManagerAbsenceListInput,
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
		if (normalized.teamId) {
			baseConditions.push(eq(employee.teamId, normalized.teamId));
		}

		const teams = await selectVisibleTeams(actor);
		const accessibleTeamIds = new Set(teams.map((teamOption) => teamOption.id));
		if (normalized.teamId && !accessibleTeamIds.has(normalized.teamId)) {
			return {
				success: true,
				data: buildInaccessibleTeamAbsenceListResult(normalized, teams),
			};
		}

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
		const total = totalRows[0]?.value ?? 0;
		const pageCount = Math.ceil(total / normalized.pageSize);
		const effectivePage = clampManagerAbsencePage({
			requestedPage: normalized.page,
			pageSize: normalized.pageSize,
			total,
		});
		const offset = (effectivePage - 1) * normalized.pageSize;

		const rowsWithMetrics = isManagerAbsenceMetricSort(normalized.sort)
			? await selectMetricSortedRows({
					baseConditions,
					managerId: actor.role === "manager" ? actor.id : undefined,
					year: normalized.year,
					organizationId: actor.organizationId,
					sort: normalized.sort,
					direction: normalized.direction,
					offset,
					pageSize: normalized.pageSize,
				})
			: await selectNonMetricSortedRows({
					baseConditions,
					managerId: actor.role === "manager" ? actor.id : undefined,
					year: normalized.year,
					organizationId: actor.organizationId,
					sort: normalized.sort,
					direction: normalized.direction,
					offset,
					pageSize: normalized.pageSize,
				});

		return {
			success: true,
			data: {
				rows: rowsWithMetrics,
				teams,
				total,
				page: effectivePage,
				pageSize: normalized.pageSize,
				year: normalized.year,
				teamId: normalized.teamId,
				sort: normalized.sort,
				direction: normalized.direction,
				pageCount,
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
	options: {
		managerId?: string;
		sort?: Extract<ManagerAbsenceSortKey, "employee" | "team">;
		direction?: ManagerAbsenceSortDirection;
		limit?: number;
		offset?: number;
	} = {},
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
		userImage: user.image,
		teamId: employee.teamId,
		teamName: team.name,
	};

	const query = db
		.select(selectedFields)
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.leftJoin(team, and(eq(employee.teamId, team.id), eq(team.organizationId, employee.organizationId)));

	const orderBy = buildNonMetricEmployeeOrderBy(options.sort ?? "employee", options.direction ?? "asc");

	if (options.managerId) {
		const managerQuery = query
			.innerJoin(employeeManagers, eq(employeeManagers.employeeId, employee.id))
			.where(and(...baseConditions, eq(employeeManagers.managerId, options.managerId)))
			.orderBy(...orderBy);

		if (options.limit !== undefined && options.offset !== undefined) {
			return await managerQuery.limit(options.limit).offset(options.offset);
		}

		return await managerQuery;
	}

	const organizationQuery = query.where(and(...baseConditions)).orderBy(...orderBy);
	if (options.limit !== undefined && options.offset !== undefined) {
		return await organizationQuery.limit(options.limit).offset(options.offset);
	}

	return await organizationQuery;
}

async function selectMetricSortedRows(params: {
	baseConditions: NonNullable<Parameters<typeof and>[number]>[];
	managerId?: string;
	year: number;
	organizationId: string;
	sort: ManagerAbsenceSortKey;
	direction: ManagerAbsenceSortDirection;
	offset: number;
	pageSize: number;
}): Promise<ManagerAbsenceEmployeeRow[]> {
	const allRows = await selectVisibleEmployees(params.baseConditions, {
		managerId: params.managerId,
	});
	const allRowsWithMetrics = await addMetricsToRows(allRows, params.year, params.organizationId);
	const sortedRows = sortManagerAbsenceRows(allRowsWithMetrics, params.sort, params.direction);

	return sortedRows.slice(params.offset, params.offset + params.pageSize);
}

async function selectNonMetricSortedRows(params: {
	baseConditions: NonNullable<Parameters<typeof and>[number]>[];
	managerId?: string;
	year: number;
	organizationId: string;
	sort: Extract<ManagerAbsenceSortKey, "employee" | "team">;
	direction: ManagerAbsenceSortDirection;
	offset: number;
	pageSize: number;
}): Promise<ManagerAbsenceEmployeeRow[]> {
	const pageRows = await selectVisibleEmployees(params.baseConditions, {
		managerId: params.managerId,
		sort: params.sort,
		direction: params.direction,
		limit: params.pageSize,
		offset: params.offset,
	});

	return await addMetricsToRows(pageRows, params.year, params.organizationId);
}

function buildNonMetricEmployeeOrderBy(
	sort: Extract<ManagerAbsenceSortKey, "employee" | "team">,
	direction: ManagerAbsenceSortDirection,
) {
	if (sort === "team") {
		const teamSortValue = sql<string>`coalesce(${team.name}, ${employee.position}, '')`;

		return [direction === "desc" ? desc(teamSortValue) : asc(teamSortValue), asc(user.name)];
	}

	return [direction === "desc" ? desc(user.name) : asc(user.name), asc(employee.employeeNumber)];
}

async function selectVisibleTeams(actor: ManagerAbsenceActor): Promise<ManagerAbsenceTeamOption[]> {
	const selectedFields = {
		id: team.id,
		name: team.name,
	};

	if (actor.role === "manager") {
		return await db
			.selectDistinct(selectedFields)
			.from(team)
			.innerJoin(employee, eq(employee.teamId, team.id))
			.innerJoin(employeeManagers, eq(employeeManagers.employeeId, employee.id))
			.where(
				and(
					eq(team.organizationId, actor.organizationId),
					eq(employee.organizationId, actor.organizationId),
					eq(employee.isActive, true),
					eq(employeeManagers.managerId, actor.id),
				),
			)
			.orderBy(asc(team.name));
	}

	return await db
		.select(selectedFields)
		.from(team)
		.where(eq(team.organizationId, actor.organizationId))
		.orderBy(asc(team.name));
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
			image: row.userImage,
			employeeNumber: row.employeeNumber,
			position: row.position,
			role: row.role,
			teamName: row.teamName,
			...metrics,
		};
	});
}

function sortManagerAbsenceRows(
	rows: ManagerAbsenceEmployeeRow[],
	sort: ManagerAbsenceSortKey,
	direction: ManagerAbsenceSortDirection,
): ManagerAbsenceEmployeeRow[] {
	return [...rows].sort((a, b) => compareManagerAbsenceRows(a, b, sort, direction));
}

function compareManagerAbsenceRows(
	a: ManagerAbsenceEmployeeRow,
	b: ManagerAbsenceEmployeeRow,
	sort: ManagerAbsenceSortKey,
	direction: ManagerAbsenceSortDirection,
): number {
	const multiplier = direction === "desc" ? -1 : 1;
	const compared = compareManagerAbsenceRowValues(a, b, sort) * multiplier;

	if (compared !== 0) {
		return compared;
	}

	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function compareManagerAbsenceRowValues(
	a: ManagerAbsenceEmployeeRow,
	b: ManagerAbsenceEmployeeRow,
	sort: ManagerAbsenceSortKey,
): number {
	if (sort === "employee") {
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	}

	if (sort === "team") {
		const teamA = a.teamName ?? a.position ?? "";
		const teamB = b.teamName ?? b.position ?? "";

		return teamA.localeCompare(teamB, undefined, { sensitivity: "base" });
	}

	return a[sort] - b[sort];
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
