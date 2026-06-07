import type { PlatformOrganization } from "@/lib/effect/services/platform-admin.service";

export type OrganizationStatusFilter = "all" | "active" | "suspended" | "deleted";

export interface OrganizationsState {
	page: number;
	search: string;
	status: OrganizationStatusFilter;
	suspendDialogOrg: PlatformOrganization | null;
	suspendReason: string;
	deleteDialogOrg: PlatformOrganization | null;
	deleteImmediate: boolean;
	deleteSkipNotification: boolean;
	deleteConfirmName: string;
}

export type OrganizationsAction =
	| { type: "pageChanged"; page: number }
	| { type: "filtersChanged"; search: string; status: OrganizationStatusFilter }
	| { type: "suspendDialogOpened"; organization: PlatformOrganization }
	| { type: "suspendDialogClosed" }
	| { type: "suspendReasonChanged"; reason: string }
	| { type: "suspendCompleted" }
	| { type: "deleteDialogOpened"; organization: PlatformOrganization }
	| { type: "deleteDialogClosed" }
	| { type: "deleteImmediateChanged"; value: boolean }
	| { type: "deleteSkipNotificationChanged"; value: boolean }
	| { type: "deleteConfirmNameChanged"; value: string }
	| { type: "deleteCompleted" };

export function getOrganizationStatusFilter(status: string | null): OrganizationStatusFilter {
	return status === "active" || status === "suspended" || status === "deleted" ? status : "all";
}

export function getInitialOrganizationsState({
	search,
	status,
}: {
	search: string;
	status: OrganizationStatusFilter;
}): OrganizationsState {
	return {
		page: 1,
		search,
		status,
		suspendDialogOrg: null,
		suspendReason: "",
		deleteDialogOrg: null,
		deleteImmediate: false,
		deleteSkipNotification: false,
		deleteConfirmName: "",
	};
}

export function organizationsReducer(
	state: OrganizationsState,
	action: OrganizationsAction,
): OrganizationsState {
	if (action.type === "pageChanged") {
		return { ...state, page: action.page };
	}

	if (action.type === "filtersChanged") {
		return { ...state, search: action.search, status: action.status, page: 1 };
	}

	if (action.type === "suspendDialogOpened") {
		return { ...state, suspendDialogOrg: action.organization };
	}

	if (action.type === "suspendDialogClosed" || action.type === "suspendCompleted") {
		return { ...state, suspendDialogOrg: null, suspendReason: "" };
	}

	if (action.type === "suspendReasonChanged") {
		return { ...state, suspendReason: action.reason };
	}

	if (action.type === "deleteDialogOpened") {
		return { ...state, deleteDialogOrg: action.organization };
	}

	if (action.type === "deleteDialogClosed" || action.type === "deleteCompleted") {
		return {
			...state,
			deleteDialogOrg: null,
			deleteImmediate: false,
			deleteSkipNotification: false,
			deleteConfirmName: "",
		};
	}

	if (action.type === "deleteImmediateChanged") {
		return { ...state, deleteImmediate: action.value };
	}

	if (action.type === "deleteSkipNotificationChanged") {
		return { ...state, deleteSkipNotification: action.value };
	}

	if (action.type === "deleteConfirmNameChanged") {
		return { ...state, deleteConfirmName: action.value };
	}

	return state;
}
