import "server-only";

import { and, eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import { auditLog, payrollExpenseWageTypeMapping } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	isPayrollLineKind,
	PAYROLL_LINE_KINDS,
	type PayrollLineKind,
} from "@/lib/travel-expenses/payroll-line-kind";
import {
	EMPTY_EXPENSE_WAGE_TYPE_CODES,
	EXPENSE_PAYROLL_FORMATS,
	type ExpensePayrollFormat,
	type ExpenseWageTypeCodes,
	type ExpenseWageTypeMapping,
	isExpensePayrollFormat,
	normalizeExpenseWageTypeCode,
} from "./expense-wage-type.types";

/**
 * Expense wage types (#851): which wage type each payroll line kind is paid
 * under, per payroll file format. No default codes ship; an unmapped kind keeps
 * its report out of payroll runs (#745, decision 13). Mappings stay when the
 * organization pays by bank transfer.
 */

type Database = typeof appDb;
type Executor = Pick<Database, "select">;
type MappingRow = typeof payrollExpenseWageTypeMapping.$inferSelect;

/** The row is keyed by organization and kind, not a uuid; as in `logAudit`, the nil uuid stands in. */
const NO_AUDIT_ENTITY_ID = "00000000-0000-0000-0000-000000000000";

const CODE_COLUMNS = {
	datev_lohn: "datevWageTypeCode",
	lexware_lohn: "lexwareWageTypeCode",
	sage_lohn: "sageWageTypeCode",
	successfactors_csv: "successFactorsWageTypeCode",
} as const satisfies Record<ExpensePayrollFormat, keyof MappingRow>;

function rowCodes(row: MappingRow | undefined): ExpenseWageTypeCodes {
	if (!row) return { ...EMPTY_EXPENSE_WAGE_TYPE_CODES };
	return {
		datev_lohn: row.datevWageTypeCode,
		lexware_lohn: row.lexwareWageTypeCode,
		sage_lohn: row.sageWageTypeCode,
		successfactors_csv: row.successFactorsWageTypeCode,
	};
}

/** Every payroll line kind with its codes; unmapped kinds have `null` codes. */
export async function getExpenseWageTypeMappings(
	organizationId: string,
	options: { database?: Executor } = {},
): Promise<ExpenseWageTypeMapping[]> {
	const rows = await (options.database ?? appDb)
		.select()
		.from(payrollExpenseWageTypeMapping)
		.where(eq(payrollExpenseWageTypeMapping.organizationId, organizationId));
	const byKind = new Map(rows.map((row) => [row.payrollLineKind, row]));
	return PAYROLL_LINE_KINDS.map((kind) => ({ kind, codes: rowCodes(byKind.get(kind)) }));
}

/** The code `kind` is paid under in `format`, or `null` when it is unmapped. */
export async function resolveExpenseWageType(
	organizationId: string,
	format: ExpensePayrollFormat,
	kind: PayrollLineKind,
	options: { database?: Executor } = {},
): Promise<string | null> {
	const [row] = await (options.database ?? appDb)
		.select({ code: payrollExpenseWageTypeMapping[CODE_COLUMNS[format]] })
		.from(payrollExpenseWageTypeMapping)
		.where(
			and(
				eq(payrollExpenseWageTypeMapping.organizationId, organizationId),
				eq(payrollExpenseWageTypeMapping.payrollLineKind, kind),
			),
		)
		.limit(1);
	return row?.code ?? null;
}

export type SaveExpenseWageTypeMappingResult =
	| { status: "saved" | "unchanged"; mapping: ExpenseWageTypeMapping }
	| { status: "invalid" };

/**
 * Replaces one kind's codes for every file format; a missing or empty code
 * clears that format, and clearing all of them removes the mapping. Each change
 * is audited with the old and new codes. The caller checks that the actor
 * manages the organization's settings.
 */
export async function saveExpenseWageTypeMapping(
	input: { organizationId: string; actorUserId: string; kind: unknown; codes: unknown },
	options: { database?: Database } = {},
): Promise<SaveExpenseWageTypeMappingResult> {
	const { organizationId, actorUserId, kind } = input;
	const codes = parseCodes(input.codes);
	if (!isPayrollLineKind(kind) || !codes) return { status: "invalid" };
	const mapping = { kind, codes };

	return (options.database ?? appDb).transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(payrollExpenseWageTypeMapping)
			.where(
				and(
					eq(payrollExpenseWageTypeMapping.organizationId, organizationId),
					eq(payrollExpenseWageTypeMapping.payrollLineKind, kind),
				),
			)
			.for("update");
		const previous = rowCodes(existing);
		if (EXPENSE_PAYROLL_FORMATS.every((format) => previous[format] === codes[format])) {
			return { status: "unchanged", mapping };
		}

		const now = new Date();
		const values = {
			datevWageTypeCode: codes.datev_lohn,
			lexwareWageTypeCode: codes.lexware_lohn,
			sageWageTypeCode: codes.sage_lohn,
			successFactorsWageTypeCode: codes.successfactors_csv,
			updatedAt: now,
			updatedBy: actorUserId,
		};
		if (EXPENSE_PAYROLL_FORMATS.every((format) => codes[format] === null)) {
			await tx
				.delete(payrollExpenseWageTypeMapping)
				.where(
					and(
						eq(payrollExpenseWageTypeMapping.organizationId, organizationId),
						eq(payrollExpenseWageTypeMapping.payrollLineKind, kind),
					),
				);
		} else {
			await tx
				.insert(payrollExpenseWageTypeMapping)
				.values({ organizationId, payrollLineKind: kind, ...values })
				.onConflictDoUpdate({
					target: [
						payrollExpenseWageTypeMapping.organizationId,
						payrollExpenseWageTypeMapping.payrollLineKind,
					],
					set: values,
				});
		}
		await tx.insert(auditLog).values({
			organizationId,
			entityType: "payroll_expense_wage_type_mapping",
			entityId: NO_AUDIT_ENTITY_ID,
			action: AuditAction.PAYROLL_EXPENSE_WAGE_TYPE_CHANGED,
			performedBy: actorUserId,
			changes: JSON.stringify({ payrollLineKind: kind, from: previous, to: codes }),
			timestamp: now,
		});
		return { status: "saved", mapping };
	});
}

/** Codes for every file format, or `null` when any key or code is not acceptable. */
function parseCodes(value: unknown): ExpenseWageTypeCodes | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	if (!Object.keys(value).every(isExpensePayrollFormat)) return null;
	const record = value as Partial<Record<ExpensePayrollFormat, unknown>>;
	const codes = { ...EMPTY_EXPENSE_WAGE_TYPE_CODES };
	for (const format of EXPENSE_PAYROLL_FORMATS) {
		const code = normalizeExpenseWageTypeCode(record[format]);
		if (code === undefined) return null;
		codes[format] = code;
	}
	return codes;
}
