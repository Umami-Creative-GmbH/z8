import type { EmployeeClockStatus } from "@/components/user-avatar";
import type { invitation, member, user } from "@/db/auth-schema";
import type { employee, employeeInvitationDraft, team } from "@/db/schema";
import type { ContractType } from "@/lib/validations/employee";

export type EmployeeRole = (typeof employee.$inferSelect)["role"];
export const EMPLOYEE_DRAFT_ID_PREFIX = "draft:";
export type EmployeeRecordKind = "employee" | "invitationDraft";
/**
 * Which employees a list or picker shows (#1438): the current roster, former
 * employees (deactivated or past a due departure), or both.
 */
export type EmployeeRosterStatus = "current" | "former" | "all";
export type EmployeeDirectoryStatus = EmployeeRosterStatus | "draft";
/** Status values older clients still send: "active" reads as current, "inactive" as former. */
export type LegacyEmployeeStatus = "active" | "inactive";

/**
 * The directory status a request asks for. Legacy values keep working, and an
 * unknown value falls back to `fallback`.
 */
export function normalizeEmployeeDirectoryStatus(
	status: string | undefined,
	fallback: EmployeeDirectoryStatus,
): EmployeeDirectoryStatus {
	switch (status) {
		case "current":
		case "active":
			return "current";
		case "former":
		case "inactive":
			return "former";
		case "draft":
		case "all":
			return status;
		default:
			return fallback;
	}
}

/** The picker status a request asks for: the current roster unless it opts in to former employees. */
export function normalizeEmployeeSelectStatus(status: string | undefined): EmployeeRosterStatus {
	const normalized = normalizeEmployeeDirectoryStatus(status, "current");
	return normalized === "draft" ? "current" : normalized;
}
export type EmployeeMembershipSummary = Pick<
	typeof member.$inferSelect,
	"id" | "role" | "status"
>;

export function encodeEmployeeInvitationDraftId(draftId: string) {
	return `${EMPLOYEE_DRAFT_ID_PREFIX}${draftId}`;
}

export function decodeEmployeeInvitationDraftId(id: string) {
	const normalizedId = decodeURIComponent(id);
	return normalizedId.startsWith(EMPLOYEE_DRAFT_ID_PREFIX)
		? normalizedId.slice(EMPLOYEE_DRAFT_ID_PREFIX.length)
		: null;
}

export type EmployeeWithRelations = typeof employee.$inferSelect & {
	kind: "employee";
	user: typeof user.$inferSelect;
	team: typeof team.$inferSelect | null;
	membership: EmployeeMembershipSummary | null;
	/** Deactivated or past a due departure (#1438); set by the directory list. */
	isFormer?: boolean;
	/**
	 * The organization-local date a former employee left (`YYYY-MM-DD`, #1439),
	 * `null` when it isn't recorded; set by the directory list on former rows only.
	 */
	formerSince?: string | null;
	/** A required custom field the viewer sees has no value (#818); set by the directory list. */
	missingRequiredCustomFields?: boolean;
	/**
	 * The contract type of the confirmed terms in force today in the
	 * organization's timezone, or null without such terms; set by the detail read.
	 */
	contractTypeToday?: ContractType | null;
};

export type EmployeeInvitationDraftWithRelations = typeof employeeInvitationDraft.$inferSelect & {
	kind: "invitationDraft";
	encodedId: string;
	userId: string;
	invitation: typeof invitation.$inferSelect;
	team: typeof team.$inferSelect | null;
	membership: null;
	user: typeof user.$inferSelect;
	isActive: false;
	invitationStatus: string;
	realEmployeeId: string | null;
};

export type EmployeeDirectoryRow = EmployeeWithRelations | EmployeeInvitationDraftWithRelations;
export type EmployeeManagerRelation = {
	id: string;
	isPrimary: boolean;
	manager: {
		id: string;
		userId: string;
		user: Pick<
			typeof user.$inferSelect,
			"firstName" | "lastName" | "name" | "email" | "image"
		>;
	};
};
export type EmployeeDetailRecord = EmployeeDirectoryRow & {
	managers?: EmployeeManagerRelation[];
};

export interface EmployeeListParams {
	search?: string;
	role?: EmployeeRole | "all";
	/** Every employee and draft when omitted. */
	status?: EmployeeDirectoryStatus | LegacyEmployeeStatus;
	limit?: number;
	offset?: number;
}

export interface PaginatedEmployeeResponse {
	employees: EmployeeDirectoryRow[];
	total: number;
	hasMore: boolean;
}

export interface SelectableEmployee {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	pronouns: string | null;
	position: string | null;
	role: EmployeeRole;
	isActive: boolean;
	/** Deactivated or past a due departure (#1438): pickers label the row "Former". */
	isFormer?: boolean;
	/**
	 * The organization-local date a former employee left (`YYYY-MM-DD`, #1439),
	 * `null` when it isn't recorded. Only on former rows.
	 */
	formerSince?: string | null;
	clockStatus?: EmployeeClockStatus;
	teamId: string | null;
	user: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		name: string;
		email: string;
		image: string | null;
	};
	team: {
		id: string;
		name: string;
	} | null;
}

export interface EmployeeSelectParams {
	search?: string;
	role?: EmployeeRole | "all";
	roles?: EmployeeRole[];
	/**
	 * The current roster when omitted (#1438). Only pickers for views of the past
	 * opt in to former employees with "all" or "former".
	 */
	status?: EmployeeRosterStatus | LegacyEmployeeStatus;
	teamId?: string;
	excludeIds?: string[];
	limit?: number;
	offset?: number;
	managerId?: string;
}

export interface EmployeeSelectResponse {
	employees: SelectableEmployee[];
	total: number;
	hasMore: boolean;
}
