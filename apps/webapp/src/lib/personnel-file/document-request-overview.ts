import {
	DOCUMENT_REQUEST_STATUSES,
	type DocumentRequestCategory,
	type DocumentRequestStatus,
	type DocumentRequestView,
} from "./document-request.types";

/**
 * The officer "Document requests" page (#1403): every request the viewer
 * covers, across employees, filtered by status and overdue. The query is in
 * document-request-store.ts (`listManagedDocumentRequests`); this module is
 * client and server safe.
 */

/** `active` = open and submitted (the default work list); `all` = every status. */
export type DocumentRequestStatusFilter = "active" | DocumentRequestStatus | "all";

export const DOCUMENT_REQUEST_STATUS_FILTERS: readonly DocumentRequestStatusFilter[] = [
	"active",
	...DOCUMENT_REQUEST_STATUSES,
	"all",
];

export interface DocumentRequestOverviewFilters {
	status: DocumentRequestStatusFilter;
	/** Only open requests past their deadline in the organization's calendar. */
	overdue: boolean;
	page: number;
	pageSize: number;
}

export const DOCUMENT_REQUEST_PAGE_SIZES = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 25;

/** A request on the page: the request as an officer sees it, with whose it is. */
export interface ManagedDocumentRequestView extends DocumentRequestView {
	employeeName: string;
	employeeNumber: string | null;
	/** A former employee: their requests stay listed. */
	isFormer: boolean;
}

/** An employee or team a bulk create may name (#1407). */
export interface DocumentRequestRecipientOption {
	id: string;
	name: string;
}

/**
 * What the bulk create offers per requestable category (#1407): the current
 * employees whose documents of that category the viewer manages, and the
 * teams they belong to. Empty for a category the viewer does not cover.
 */
export type DocumentRequestRecipientOptions = Record<
	DocumentRequestCategory,
	{ employees: DocumentRequestRecipientOption[]; teams: DocumentRequestRecipientOption[] }
>;

type RawParams = Record<string, string | string[] | undefined>;

function single(raw: RawParams, key: string): string | undefined {
	const value = raw[key];
	return typeof value === "string" ? value : undefined;
}

function positiveInteger(value: string | undefined): number | null {
	if (value === undefined || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** The page's filters from URL search params; unknown values fall back to the defaults. */
export function parseDocumentRequestOverviewParams(raw: RawParams): DocumentRequestOverviewFilters {
	const status = single(raw, "status");
	const pageSize = positiveInteger(single(raw, "pageSize"));
	return {
		status:
			status !== undefined &&
			(DOCUMENT_REQUEST_STATUS_FILTERS as readonly string[]).includes(status)
				? (status as DocumentRequestStatusFilter)
				: "active",
		overdue: single(raw, "overdue") === "1",
		page: positiveInteger(single(raw, "page")) ?? 1,
		pageSize:
			pageSize !== null && (DOCUMENT_REQUEST_PAGE_SIZES as readonly number[]).includes(pageSize)
				? pageSize
				: DEFAULT_PAGE_SIZE,
	};
}
