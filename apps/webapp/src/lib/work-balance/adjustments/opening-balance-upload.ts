import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import type { db as globalDb } from "@/db";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { AuditTrail } from "@/lib/audit-trail";
import type { Instant } from "@/lib/datetime/temporal-core";
import { listBalanceAdjustmentGrantEmployees } from "@/lib/payroll-access/adjustment-coverage";
import type { WorkBalanceDbClient } from "@/lib/work-balance/service";
import { type BalanceAdjustmentAuthority, balanceAdjustmentAuditMetadata } from "./authorization";
import { type BalanceAdjustmentChange, notifyBalanceAdjustmentChanges } from "./notifications";
import { type OpeningBalanceCsvRow, parseOpeningBalanceCsv } from "./opening-balance-csv";
import {
	asMonthClosedRefusal,
	type BalanceAdjustmentDatabase,
	checkOpeningBalance,
	refreshAfterCommit,
	writeOpeningBalance,
} from "./store";
import {
	BalanceAdjustmentRefusal,
	type OpeningBalanceUploadOutcome,
	type OpeningBalanceUploadRow,
	type OpeningBalanceUploadRowError,
} from "./types";

/**
 * The bulk opening balance upload (#999, ADR-0008): one CSV row is one opening
 * balance, checked and written exactly like one set on the employee's page
 * (`checkOpeningBalance`, `writeOpeningBalance`). Rows are matched to the
 * organization's employees by personnel number (trimmed, letters ignoring
 * case, leading zeros significant). An owner or admin may write any of them;
 * a payroll grant holder only the employees their grant covers for balance
 * adjustments, including those who have left, never their own record (#995).
 *
 * The preview reads only. The commit parses and checks everything again inside
 * one transaction and writes every row there, or none while any row has an
 * error; it then rebuilds each written employee's balance and notifies them.
 */

type UploadInput = {
	organizationId: string;
	actorUserId: string;
	authority: BalanceAdjustmentAuthority;
	/** The uploaded file's text. */
	csv: string;
	now: Instant;
};

type UploadEmployee = { id: string; name: string; isActive: boolean; employeeNumber: string };

/** Which employees the rows may name: the organization's, and the ones the uploader may write. */
type UploadScope = { employees: UploadEmployee[]; writable: Set<string> | null };

const AUDIT_SOURCE = { source: "opening_balance_upload" } as const;

/** Rolls the commit back; carries the rows with their errors out of the transaction. */
class UploadRejected extends Error {
	constructor(readonly rows: OpeningBalanceUploadRow[]) {
		super("The opening balance upload has row errors");
	}
}

/** Every row of the file with its errors, without writing anything. */
export async function previewOpeningBalanceUpload(
	client: WorkBalanceDbClient,
	input: UploadInput,
): Promise<OpeningBalanceUploadOutcome> {
	const parsed = parseOpeningBalanceCsv(input.csv);
	if (!parsed.ok) return invalidFile(parsed);
	const rows = resolveRows(parsed.rows, await loadUploadScope(client, input));
	for (const row of rows) {
		if (row.errors.length > 0 || !row.employee) continue;
		await checkRow(row, () =>
			checkOpeningBalance(client, {
				organizationId: input.organizationId,
				employeeId: row.employee?.id as string,
				day: row.day as string,
				minutes: row.minutes as number,
				reason: row.reason,
				now: input.now,
			}).then((checked) => {
				row.replaces = checked.replaces
					? { day: checked.replaces.day, minutes: checked.replaces.minutes }
					: null;
			}),
		);
	}
	return rows.some((row) => row.errors.length > 0)
		? { status: "has_errors", rows }
		: { status: "ready", rows };
}

/**
 * Writes every row's opening balance in one transaction, or nothing while any
 * row has an error (then the rows come back with their errors). Each written
 * one cancels the opening balance in effect with the row's reason.
 */
export async function commitOpeningBalanceUpload(
	database: BalanceAdjustmentDatabase,
	input: UploadInput,
): Promise<OpeningBalanceUploadOutcome> {
	const parsed = parseOpeningBalanceCsv(input.csv);
	if (!parsed.ok) return invalidFile(parsed);

	// A trail of its own: a rolled-back upload forwards no audit entries.
	const audit = new AuditTrail();
	let written: { rows: OpeningBalanceUploadRow[]; changes: BalanceAdjustmentChange[] };
	try {
		written = await database.transaction(async (transaction) => {
			const tx = transaction as unknown as Parameters<typeof writeOpeningBalance>[0];
			const rows = resolveRows(parsed.rows, await loadUploadScope(tx, input));
			const changes: BalanceAdjustmentChange[] = [];
			const auditMetadata = {
				...balanceAdjustmentAuditMetadata(input.authority),
				...AUDIT_SOURCE,
			};
			// Every remaining row is written, so the refusal lists every error;
			// in employee order, so concurrent uploads take the ledger locks alike.
			const writable = rows
				.filter((row) => row.errors.length === 0 && row.employee)
				.sort((left, right) => (left.employee?.id ?? "").localeCompare(right.employee?.id ?? ""));
			for (const row of writable) {
				await checkRow(row, async () => {
					const result = await writeOpeningBalance(tx, audit, {
						organizationId: input.organizationId,
						actorUserId: input.actorUserId,
						employeeId: row.employee?.id as string,
						day: row.day as string,
						minutes: row.minutes as number,
						reason: row.reason,
						now: input.now,
						auditMetadata,
					});
					const cancelled = result.changes.find((change) => change.event === "cancelled");
					row.replaces = cancelled
						? { day: cancelled.adjustment.day, minutes: cancelled.adjustment.minutes }
						: null;
					changes.push(...result.changes);
				});
			}
			if (rows.some((row) => row.errors.length > 0)) throw new UploadRejected(rows);
			return { rows, changes };
		});
	} catch (error) {
		if (error instanceof UploadRejected) return { status: "has_errors", rows: error.rows };
		throw asMonthClosedRefusal(error);
	}
	audit.forwardCommitted();

	for (const row of written.rows) {
		await refreshAfterCommit({
			organizationId: input.organizationId,
			employeeId: row.employee?.id as string,
			fullRebuild: true,
		});
	}
	await notifyBalanceAdjustmentChanges(database, {
		organizationId: input.organizationId,
		changes: written.changes,
	});
	return {
		status: "committed",
		rows: written.rows,
		created: written.rows.length,
		replaced: written.rows.filter((row) => row.replaces).length,
	};
}

function invalidFile(
	parsed: Extract<ReturnType<typeof parseOpeningBalanceCsv>, { ok: false }>,
): OpeningBalanceUploadOutcome {
	return {
		status: "invalid_file",
		code: parsed.code,
		...(parsed.missingColumns ? { missingColumns: parsed.missingColumns } : {}),
	};
}

/** Runs one row's check or write; a refusal becomes the row's error. */
async function checkRow(row: OpeningBalanceUploadRow, run: () => Promise<void>) {
	try {
		await run();
	} catch (error) {
		if (!(error instanceof BalanceAdjustmentRefusal)) throw error;
		row.errors.push(rowErrorOf(error));
	}
}

function rowErrorOf(refusal: BalanceAdjustmentRefusal): OpeningBalanceUploadRowError {
	switch (refusal.code) {
		case "conflicting_payouts":
			return {
				code: "conflicting_payouts",
				conflictingPayouts: refusal.details.conflictingPayouts ?? [],
			};
		case "month_closed":
			return {
				code: "month_closed",
				...(refusal.details.closedMonth ? { closedMonth: refusal.details.closedMonth } : {}),
			};
		case "future_day":
			return { code: refusal.code };
		case "reason_required":
			return { code: "reason_required" };
		case "employee_not_found":
			return { code: "unknown_employee" };
		case "invalid_input":
			// The parser already refused malformed days, amounts and long reasons.
			return { code: "invalid_day" };
		default:
			throw refusal;
	}
}

async function loadUploadScope(
	client: Pick<typeof globalDb, "select" | "execute">,
	input: UploadInput,
): Promise<UploadScope> {
	const rows = await client
		.select({
			id: employee.id,
			employeeNumber: employee.employeeNumber,
			firstName: employee.firstName,
			lastName: employee.lastName,
			userName: user.name,
			isActive: employee.isActive,
		})
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(eq(employee.organizationId, input.organizationId), isNotNull(employee.employeeNumber)),
		);
	const employees = rows.map((row) => ({
		id: row.id,
		employeeNumber: row.employeeNumber as string,
		isActive: row.isActive,
		name:
			[row.firstName, row.lastName].filter(Boolean).join(" ").trim() ||
			row.userName?.trim() ||
			(row.employeeNumber as string),
	}));
	if (input.authority.via === "organization_admin") return { employees, writable: null };

	const coverage = await listBalanceAdjustmentGrantEmployees(client, input);
	if (!coverage || coverage.grantId !== input.authority.grantId) {
		throw new BalanceAdjustmentRefusal(
			"not_permitted",
			"The payroll access grant is no longer active",
		);
	}
	return { employees, writable: new Set(coverage.employees.map((covered) => covered.id)) };
}

function numberKey(value: string): string {
	return value.trim().toLocaleLowerCase("en");
}

/** Matches each row to an employee in the scope; parsing and matching errors only. */
function resolveRows(
	parsedRows: readonly OpeningBalanceCsvRow[],
	scope: UploadScope,
): OpeningBalanceUploadRow[] {
	const byNumber = new Map<string, UploadEmployee[]>();
	for (const candidate of scope.employees) {
		const key = numberKey(candidate.employeeNumber);
		if (!key) continue;
		byNumber.set(key, [...(byNumber.get(key) ?? []), candidate]);
	}

	const rows = parsedRows.map((parsed): OpeningBalanceUploadRow => {
		const errors: OpeningBalanceUploadRowError[] = parsed.errors.map((code) => ({ code }));
		let matched: UploadEmployee | null = null;
		if (parsed.employeeNumber) {
			const candidates = byNumber.get(numberKey(parsed.employeeNumber)) ?? [];
			if (candidates.length === 0) errors.push({ code: "unknown_employee" });
			else if (candidates.length > 1) errors.push({ code: "ambiguous_employee" });
			else if (scope.writable && !scope.writable.has((candidates[0] as UploadEmployee).id)) {
				errors.push({ code: "out_of_scope" });
			} else matched = candidates[0] as UploadEmployee;
		}
		return {
			row: parsed.row,
			employeeNumber: parsed.employeeNumber,
			employee: matched ? { id: matched.id, name: matched.name, isActive: matched.isActive } : null,
			day: parsed.day,
			minutes: parsed.minutes,
			reason: parsed.reason,
			replaces: null,
			errors,
		};
	});

	const rowsPerEmployee = new Map<string, number>();
	for (const row of rows) {
		if (row.employee) {
			rowsPerEmployee.set(row.employee.id, (rowsPerEmployee.get(row.employee.id) ?? 0) + 1);
		}
	}
	for (const row of rows) {
		if (row.employee && (rowsPerEmployee.get(row.employee.id) ?? 0) > 1) {
			row.errors.push({ code: "duplicate_employee" });
		}
	}
	return rows;
}
