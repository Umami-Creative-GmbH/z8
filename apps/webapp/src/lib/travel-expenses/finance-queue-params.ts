/**
 * What the finance queue shows (#753), kept in the page's search params so a
 * filtered page survives opening an expense and coming back, and can be linked.
 */

export const FINANCE_QUEUE_STATUSES = ["open", "reimbursed", "all"] as const;
/**
 * `open`: awaiting reimbursement, overpaid or needs review (mixed).
 * `reimbursed`: nothing owed either way. `all`: every approved expense.
 */
export type FinanceQueueStatus = (typeof FINANCE_QUEUE_STATUSES)[number];

export interface FinanceQueueFilters {
	status: FinanceQueueStatus;
	employeeId: string | null;
	/** Matched against the teams recorded at approval, never the employee's current ones. */
	teamId: string | null;
	currency: string | null;
	/** Only reports whose approved revision is in no export batch that is not cancelled. */
	notExported: boolean;
}

export interface FinanceQueueView extends FinanceQueueFilters {
	/** 1-based. */
	page: number;
}

export const DEFAULT_FINANCE_QUEUE_VIEW: FinanceQueueView = {
	status: "open",
	employeeId: null,
	teamId: null,
	currency: null,
	notExported: false,
	page: 1,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const PAGE = /^[1-9][0-9]{0,5}$/;

function match(value: string | null, pattern: RegExp): string | null {
	return value !== null && pattern.test(value) ? value : null;
}

export function parseFinanceQueueView(params: URLSearchParams): FinanceQueueView {
	const status = params.get("status");
	const page = match(params.get("page"), PAGE);
	return {
		status: FINANCE_QUEUE_STATUSES.find((value) => value === status) ?? "open",
		employeeId: match(params.get("employee"), UUID),
		teamId: match(params.get("team"), UUID),
		currency: match(params.get("currency"), CURRENCY),
		notExported: params.get("notExported") === "1",
		page: page ? Number(page) : 1,
	};
}

/** The finance page's search param that opens one payroll run's confirm dialog (#853, #855). */
const CONFIRM_RUN_PARAM = "confirmRun";

/**
 * Where officers confirm a payroll run: the finance page's "Payroll runs
 * awaiting confirmation" card, with the run's confirm dialog open.
 */
export function payrollRunToConfirmHref(jobId: string): string {
	return `/travel-expenses/finance?${new URLSearchParams({ [CONFIRM_RUN_PARAM]: jobId })}#payroll-runs`;
}

/** The payroll run whose confirm dialog the finance page opens; null for none or a malformed id. */
export function parseConfirmRun(
	params: Record<string, string | string[] | undefined>,
): string | null {
	const value = params[CONFIRM_RUN_PARAM];
	return typeof value === "string" ? match(value, UUID) : null;
}

/** The search string of a view, without defaults and without the leading `?`. */
export function financeQueueSearch(view: FinanceQueueView): string {
	const params = new URLSearchParams();
	if (view.status !== "open") params.set("status", view.status);
	if (view.employeeId) params.set("employee", view.employeeId);
	if (view.teamId) params.set("team", view.teamId);
	if (view.currency) params.set("currency", view.currency);
	if (view.notExported) params.set("notExported", "1");
	if (view.page > 1) params.set("page", String(view.page));
	return params.toString();
}
