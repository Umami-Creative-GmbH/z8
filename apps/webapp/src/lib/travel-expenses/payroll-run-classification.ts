import type { TravelExpensePayrollRunInclusionLine } from "@/db/schema";
import type { TravelExpenseReportSubmittedItem } from "@/lib/approvals/evidence/travel-expense-report-facts";
import { isExpensePayrollFormat } from "@/lib/payroll-export/expense-wage-type.types";
import type { PayrollLineKind } from "./payroll-line-kind";
import {
	computePayrollLines,
	type PayrollExclusionItem,
	type PayrollLine,
	type PayrollRevision,
} from "./payroll-lines";
import type { IncludedPayrollRun } from "./payroll-run-inclusion-read";
import type { SettlementAccount } from "./settlement-store";

/**
 * Whether a payroll run takes one report awaiting reimbursement, and if not,
 * why (#852, #854). The export includes exactly what this includes, and payroll
 * readiness lists exactly what it skips, so the two never disagree. Pure: the
 * caller loads the account, its latest approved revision and the format's
 * wage-type codes.
 */

/** An allowance item without a statutory baseline, as readiness names it. */
export interface PayrollRunSkippedItem extends PayrollExclusionItem {
	type: TravelExpenseReportSubmittedItem["type"];
	expenseDate: string;
	description: string;
}

/** Why a run does not take a report or legacy claim awaiting reimbursement. */
export type PayrollRunSkip =
	| { reason: "no_statutory_baseline"; items: PayrollRunSkippedItem[] }
	| { reason: "negative_difference"; kinds: PayrollLineKind[] }
	/** Payroll line kinds without a wage type mapped for the run's format. */
	| { reason: "unmapped_wage_type"; kinds: PayrollLineKind[] }
	/** An unconfirmed run of another period includes it. */
	| { reason: "included_in_other_run"; run: IncludedPayrollRun }
	| {
			reason:
				| "legacy_claim"
				| "currency_not_eur"
				| "reimbursed_outside_payroll"
				| "nothing_owed"
				/** The format is an API connector, which never carries expense lines. */
				| "api_connector";
	  };

export type PayrollRunSkipReason = PayrollRunSkip["reason"];

export type PayrollRunClassification =
	| {
			outcome: "include";
			basisRevisionId: string;
			lines: TravelExpensePayrollRunInclusionLine[];
			/** An unconfirmed run of the same period holds it: this run takes it over. */
			takesOver: boolean;
	  }
	| { outcome: "skip"; skip: PayrollRunSkip };

export interface PayrollRunCandidateInput {
	account: Pick<SettlementAccount, "source" | "entries" | "payrollRun">;
	/** The report's latest approved revision; null for a legacy claim. */
	revision: { id: string; facts: PayrollRevision } | null;
	/** Any payroll export format; API connectors take nothing. */
	format: string;
	period: { startDate: string; endDate: string };
	/** The format's wage-type code per payroll line kind; a missing kind is unmapped. */
	codes: ReadonlyMap<string, string>;
	/** Every line earlier confirmed payroll runs carried for the report. */
	priorLines: readonly PayrollLine[];
}

const skip = (reason: PayrollRunSkip): PayrollRunClassification => ({
	outcome: "skip",
	skip: reason,
});

export function classifyPayrollRunCandidate(
	input: PayrollRunCandidateInput,
): PayrollRunClassification {
	const { account, period } = input;
	if (!isExpensePayrollFormat(input.format)) return skip({ reason: "api_connector" });
	if (account.source.type === "legacy_claim" || !input.revision) {
		return skip({ reason: "legacy_claim" });
	}
	const held = account.payrollRun;
	if (held && !(held.periodStart === period.startDate && held.periodEnd === period.endDate)) {
		return skip({ reason: "included_in_other_run", run: held });
	}
	const { revision } = input;
	const result = computePayrollLines({
		source: "report",
		revision: revision.facts,
		// No reimbursement names a payroll run before confirmation exists (#853).
		settlementEntries: account.entries.map((entry) => ({ kind: entry.kind, payrollRunId: null })),
		priorLines: input.priorLines,
	});
	if (!result.ok) {
		switch (result.reason) {
			case "no_statutory_baseline":
				return skip({ reason: result.reason, items: describeItems(result.items, revision.facts) });
			case "negative_difference":
				return skip({ reason: result.reason, kinds: result.kinds });
			default:
				return skip({ reason: result.reason });
		}
	}
	const unmapped = result.lines.map((line) => line.kind).filter((kind) => !input.codes.has(kind));
	if (unmapped.length > 0) return skip({ reason: "unmapped_wage_type", kinds: unmapped });
	return {
		outcome: "include",
		basisRevisionId: revision.id,
		takesOver: held !== null,
		lines: result.lines.map((line) => ({
			...line,
			wageTypeCode: input.codes.get(line.kind) ?? "",
		})),
	};
}

function describeItems(
	items: readonly PayrollExclusionItem[],
	facts: PayrollRevision,
): PayrollRunSkippedItem[] {
	const byId = new Map(facts.items.map((item) => [item.itemId, item]));
	return items.map((excluded) => {
		const item = byId.get(excluded.itemId);
		return {
			...excluded,
			type: item?.type ?? "receipt",
			expenseDate: item?.expenseDate ?? "",
			description: item?.description ?? "",
		};
	});
}
