import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, ne, or, type SQL, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeDocument,
	team,
	teamMembership,
} from "@/db/schema";
import { getAbsenceDaysByAbsenceId } from "@/lib/absences/absence-days-resolver";
import { managesCategory, type PersonnelFileAccess } from "./access";
import {
	employeeInScope,
	listManagedEmployees,
	type ManagedEmployee,
	managedEmployeesCondition,
	visibleDocumentsCondition,
} from "./access-store";
import type {
	SickLeaveOverviewFilters,
	SickLeaveOverviewNote,
	SickLeaveOverviewRow,
	SickLeaveStatus,
} from "./sick-leave-overview";

/**
 * The officer "Sick leave" overview query (#985, Personnel File ADR 0002):
 * sick-leave absences of the employees whose sick notes the viewer manages,
 * with the number of linked sick notes. One org-scoped, paginated statement
 * scoped by the viewer's grants; document contents are never loaded.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

export type SickLeaveOverviewResult =
	/** The viewer manages no sick notes: the server refuses the query. */
	| { kind: "refused" }
	| {
			kind: "ok";
			rows: SickLeaveOverviewRow[];
			total: number;
			page: number;
			pageSize: number;
			pageCount: number;
	  };

const linkedNoteCount = (organizationId: string) =>
	sql<number>`(SELECT count(*)::int FROM ${employeeDocument}
		WHERE ${employeeDocument.organizationId} = ${organizationId}
		AND ${employeeDocument.absenceEntryId} = ${absenceEntry.id})`;

const hasLinkedNote = (organizationId: string) =>
	sql`EXISTS (SELECT 1 FROM ${employeeDocument}
		WHERE ${employeeDocument.organizationId} = ${organizationId}
		AND ${employeeDocument.absenceEntryId} = ${absenceEntry.id})`;

function notesCondition(
	filters: SickLeaveOverviewFilters,
	organizationId: string,
): SQL | undefined {
	switch (filters.notes) {
		case "missing":
			return and(
				eq(absenceEntry.sickDetail, "with_certificate"),
				sql`NOT ${hasLinkedNote(organizationId)}`,
			);
		case "present":
			return hasLinkedNote(organizationId);
		case "all":
			return undefined;
	}
}

export interface SickLeaveFilterOptions {
	employees: ManagedEmployee[];
	teams: Array<{ id: string; name: string }>;
}

/**
 * The employee and team filters of the overview: the employees whose sick
 * notes the viewer manages (former employees included, never the viewer) and
 * the teams they currently belong to. Empty without a sick note grant.
 */
export async function listSickLeaveFilterOptions(
	database: Reader,
	access: PersonnelFileAccess,
): Promise<SickLeaveFilterOptions> {
	if (!managesCategory(access, "sick_note")) return { employees: [], teams: [] };
	const { organizationId } = access;
	const managedPrimary = database
		.select({ teamId: employee.teamId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, organizationId),
				managedEmployeesCondition(access, "sick_note", employee.id),
			),
		);
	const managedMemberships = database
		.select({ teamId: teamMembership.teamId })
		.from(teamMembership)
		.where(
			and(
				eq(teamMembership.organizationId, organizationId),
				managedEmployeesCondition(access, "sick_note", teamMembership.employeeId),
			),
		);
	const [employees, teams] = await Promise.all([
		listManagedEmployees(database, access, { category: "sick_note" }),
		database
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(
				and(
					eq(team.organizationId, organizationId),
					or(inArray(team.id, managedPrimary), inArray(team.id, managedMemberships)),
				),
			)
			.orderBy(asc(team.name), asc(team.id)),
	]);
	return { employees, teams };
}

function absenceDayRange(row: {
	absenceId: string;
	employeeId: string;
	startDate: string;
	startPeriod: SickLeaveOverviewRow["startPeriod"];
	endDate: string;
	endPeriod: SickLeaveOverviewRow["endPeriod"];
}) {
	return {
		id: row.absenceId,
		employeeId: row.employeeId,
		startDate: row.startDate,
		startPeriod: row.startPeriod,
		endDate: row.endDate,
		endPeriod: row.endPeriod,
	};
}

/**
 * One page of the sick-leave absences (pending and approved) overlapping the
 * filter's range of plain days, of the employees whose sick notes the viewer
 * manages: everyone for owners and admins, the grant's scope for an officer,
 * never the viewer's own absences. Former employees stay listed. Refused when
 * no grant covers sick notes. Newest first.
 */
export async function listSickLeaveOverview(
	database: Reader,
	access: PersonnelFileAccess,
	filters: SickLeaveOverviewFilters,
): Promise<SickLeaveOverviewResult> {
	if (!managesCategory(access, "sick_note")) return { kind: "refused" };
	const { organizationId } = access;
	const where = and(
		eq(absenceEntry.organizationId, organizationId),
		ne(absenceEntry.status, "rejected"),
		lte(absenceEntry.startDate, filters.to),
		gte(absenceEntry.endDate, filters.from),
		managedEmployeesCondition(access, "sick_note", absenceEntry.employeeId),
		filters.employeeId ? eq(absenceEntry.employeeId, filters.employeeId) : undefined,
		filters.teamId
			? employeeInScope(
					organizationId,
					{ kind: "specific", employeeIds: [], teamIds: [filters.teamId] },
					absenceEntry.employeeId,
				)
			: undefined,
		filters.sickDetail ? eq(absenceEntry.sickDetail, filters.sickDetail) : undefined,
		filters.status ? eq(absenceEntry.status, filters.status) : undefined,
		notesCondition(filters, organizationId),
	) as SQL;
	// Sick leave is an absence of a sick category; child sick is a sick detail, not a category.
	const sickCategory = and(
		eq(absenceCategory.id, absenceEntry.categoryId),
		eq(absenceCategory.organizationId, organizationId),
		eq(absenceCategory.type, "sick"),
	);
	const ofEmployee = and(
		eq(employee.id, absenceEntry.employeeId),
		eq(employee.organizationId, organizationId),
	);

	const [countRow] = await database
		.select({ total: sql<number>`count(*)::int` })
		.from(absenceEntry)
		.innerJoin(absenceCategory, sickCategory)
		.innerJoin(employee, ofEmployee)
		.where(where);
	const total = countRow?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
	const page = Math.min(filters.page, pageCount);
	const rows = await database
		.select({
			absenceId: absenceEntry.id,
			employeeId: absenceEntry.employeeId,
			userName: user.name,
			employeeNumber: employee.employeeNumber,
			isActive: employee.isActive,
			startDate: absenceEntry.startDate,
			startPeriod: absenceEntry.startPeriod,
			endDate: absenceEntry.endDate,
			endPeriod: absenceEntry.endPeriod,
			status: absenceEntry.status,
			sickDetail: absenceEntry.sickDetail,
			sickNoteCount: linkedNoteCount(organizationId),
		})
		.from(absenceEntry)
		.innerJoin(absenceCategory, sickCategory)
		.innerJoin(employee, ofEmployee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(where)
		.orderBy(desc(absenceEntry.startDate), asc(user.name), asc(absenceEntry.id))
		.limit(filters.pageSize)
		.offset((page - 1) * filters.pageSize);

	const absenceIds = rows.map((row) => row.absenceId);
	const [notes, absenceDays] = await Promise.all([
		absenceIds.length === 0
			? []
			: database
					.select({
						id: employeeDocument.id,
						title: employeeDocument.title,
						absenceId: employeeDocument.absenceEntryId,
					})
					.from(employeeDocument)
					.where(
						and(
							visibleDocumentsCondition(access),
							inArray(employeeDocument.absenceEntryId, absenceIds),
						),
					)
					.orderBy(asc(employeeDocument.createdAt), asc(employeeDocument.id)),
		getAbsenceDaysByAbsenceId(database, { organizationId, absences: rows.map(absenceDayRange) }),
	]);
	const notesByAbsence = new Map<string, SickLeaveOverviewNote[]>();
	for (const note of notes) {
		if (!note.absenceId) continue;
		const list = notesByAbsence.get(note.absenceId) ?? [];
		list.push({ id: note.id, title: note.title });
		notesByAbsence.set(note.absenceId, list);
	}

	return {
		kind: "ok",
		rows: rows.map((row) => ({
			absenceId: row.absenceId,
			employeeId: row.employeeId,
			employeeName: row.userName?.trim() || row.employeeNumber || row.employeeId,
			employeeNumber: row.employeeNumber,
			isFormer: !row.isActive,
			startDate: row.startDate,
			startPeriod: row.startPeriod,
			endDate: row.endDate,
			endPeriod: row.endPeriod,
			status: row.status as SickLeaveStatus,
			sickDetail: row.sickDetail,
			absenceDays: absenceDays.get(row.absenceId) ?? 0,
			sickNoteCount: row.sickNoteCount,
			sickNotes: notesByAbsence.get(row.absenceId) ?? [],
		})),
		total,
		page,
		pageSize: filters.pageSize,
		pageCount,
	};
}
