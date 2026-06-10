import type { EmployeeClockStatus } from "@/components/user-avatar";
import type { invitation, user } from "@/db/auth-schema";
import type { employee, employeeInvitationDraft, team } from "@/db/schema";

export type EmployeeRole = (typeof employee.$inferSelect)["role"];
export const EMPLOYEE_DRAFT_ID_PREFIX = "draft:";
export type EmployeeRecordKind = "employee" | "invitationDraft";
export type EmployeeDirectoryStatus = "active" | "inactive" | "draft" | "all";

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
};

export type EmployeeInvitationDraftWithRelations = typeof employeeInvitationDraft.$inferSelect & {
	kind: "invitationDraft";
	encodedId: string;
	userId: string;
	invitation: typeof invitation.$inferSelect;
	team: typeof team.$inferSelect | null;
	user: typeof user.$inferSelect & {
		canUseWebapp?: boolean;
		canUseDesktop?: boolean;
		canUseMobile?: boolean;
	};
	isActive: false;
	invitationStatus: string;
	realEmployeeId: string | null;
};

export type EmployeeDirectoryRow = EmployeeWithRelations | EmployeeInvitationDraftWithRelations;
export type EmployeeDetailRecord = EmployeeDirectoryRow & { managers?: unknown[] };

export interface EmployeeListParams {
	search?: string;
	role?: EmployeeRole | "all";
	status?: EmployeeDirectoryStatus;
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
	status?: "active" | "inactive" | "all";
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
