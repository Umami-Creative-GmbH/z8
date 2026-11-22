"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { toast } from "sonner";
import { loadPermissionsPageData } from "@/app/[locale]/(app)/settings/roles/team-permission-actions";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { TeamPermissionEditorPanel } from "./team-permission-editor-panel";
import { TeamPermissionsTableCard } from "./team-permissions-table-card";
import {
	buildPermissionMap,
	filterEmployeesByQuery,
	getPermissionSummary,
	initialTeamPermissionsState,
	teamPermissionsReducer,
} from "./team-permissions-utils";

export function TeamPermissionsTab({ organizationId }: { organizationId: string }) {
	const { t } = useTranslate();
	const [state, dispatch] = useReducer(teamPermissionsReducer, initialTeamPermissionsState);
	const currentRequest = useRef<symbol | null>(null);
	const activeOrganizationId = useRef(organizationId);
	const mounted = useRef(false);
	const loadFailedMessage = t(
		"settings.permissions.toast.loadEmployeesFailed",
		"Failed to load employees",
	);
	const loadFailedMessageRef = useRef(loadFailedMessage);

	useLayoutEffect(() => {
		loadFailedMessageRef.current = loadFailedMessage;
	}, [loadFailedMessage]);

	useLayoutEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			currentRequest.current = null;
		};
	}, []);

	useLayoutEffect(() => {
		activeOrganizationId.current = organizationId;
		currentRequest.current = null;
	}, [organizationId]);

	useEffect(() => {
		let cancelled = false;
		const requestId = Symbol();
		currentRequest.current = requestId;
		dispatch({ type: "resetForOrganization" });

		async function loadData() {
			let result: Awaited<ReturnType<typeof loadPermissionsPageData>>;
			try {
				result = await loadPermissionsPageData();
			} catch {
				if (cancelled || currentRequest.current !== requestId) return;
				toast.error(loadFailedMessageRef.current);
				dispatch({
					type: "setBootstrapped",
					payload: {
						loadedOrganizationId: organizationId,
						loadFailed: true,
						employees: [],
						teams: [],
						permissions: {},
					},
				});
				return;
			}

			if (cancelled || currentRequest.current !== requestId) return;

			if (!result.success || !result.data || result.data.organizationId !== organizationId) {
				toast.error((!result.success ? result.error : undefined) || loadFailedMessageRef.current);
				dispatch({
					type: "setBootstrapped",
					payload: {
						loadedOrganizationId: organizationId,
						loadFailed: true,
						employees: [],
						teams: [],
						permissions: {},
					},
				});
				return;
			}

			dispatch({
				type: "setBootstrapped",
				payload: {
					loadedOrganizationId: result.data.organizationId,
					employees: result.data.employees,
					teams: result.data.teams,
					permissions: buildPermissionMap(result.data.permissions),
				},
			});
		}

		void loadData();
		return () => {
			cancelled = true;
		};
	}, [organizationId]);

	const handleRefresh = async (background = false) => {
		if (!mounted.current || activeOrganizationId.current !== organizationId) {
			return;
		}
		const requestId = Symbol();
		currentRequest.current = requestId;
		if (!background) dispatch({ type: "setLoading", value: true });

		let result: Awaited<ReturnType<typeof loadPermissionsPageData>>;
		try {
			result = await loadPermissionsPageData();
		} catch {
			if (
				!mounted.current ||
				currentRequest.current !== requestId ||
				activeOrganizationId.current !== organizationId
			) {
				return;
			}
			toast.error(loadFailedMessageRef.current);
			dispatch({ type: "setLoading", value: false });
			return;
		}

		if (
			!mounted.current ||
			currentRequest.current !== requestId ||
			activeOrganizationId.current !== organizationId
		) {
			return;
		}

		if (!result.success || !result.data || result.data.organizationId !== organizationId) {
			toast.error((!result.success ? result.error : undefined) || loadFailedMessageRef.current);
			dispatch({ type: "setLoading", value: false });
			return;
		}

		dispatch({
			type: "setBootstrapped",
			payload: {
				loadedOrganizationId: result.data.organizationId,
				employees: result.data.employees,
				teams: result.data.teams,
				permissions: buildPermissionMap(result.data.permissions),
			},
		});
	};

	useViewRefresh(() => handleRefresh(true));

	const filteredEmployees = filterEmployeesByQuery(state.employees, state.searchQuery);
	const isCurrentOrganization = state.loadedOrganizationId === organizationId;

	return (
		<div className="min-w-0 space-y-6">
			<TeamPermissionsTableCard
				loading={state.loading || !isCurrentOrganization}
				loadFailed={isCurrentOrganization && state.loadFailed}
				searchQuery={state.searchQuery}
				onSearchChange={(searchQuery) => dispatch({ type: "setSearchQuery", searchQuery })}
				onRefresh={() => void handleRefresh()}
				employees={isCurrentOrganization ? filteredEmployees : []}
				onEdit={(employee) => dispatch({ type: "setSelectedEmployee", employee })}
				getSummary={(employeeId) => getPermissionSummary(state.permissions, employeeId)}
			/>

			<TeamPermissionEditorPanel
				selectedEmployee={isCurrentOrganization ? state.selectedEmployee : null}
				teams={isCurrentOrganization ? state.teams : []}
				currentPermissions={isCurrentOrganization ? state.permissions : {}}
				onClose={() => dispatch({ type: "setSelectedEmployee", employee: null })}
				onSuccess={() => {
					dispatch({ type: "setSelectedEmployee", employee: null });
					void handleRefresh();
				}}
			/>
		</div>
	);
}
