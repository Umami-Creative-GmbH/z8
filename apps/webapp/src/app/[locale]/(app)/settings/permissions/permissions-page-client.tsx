"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { toast } from "sonner";
import { loadPermissionsPageData } from "./actions";
import {
	PermissionEditorDialog,
	PermissionsEmptyState,
	PermissionsTableCard,
} from "./page-sections";
import {
	buildPermissionMap,
	filterEmployeesByQuery,
	getPermissionSummary,
	initialPermissionsPageState,
	permissionsPageReducer,
} from "./page-utils";

export function PermissionsPageClient(props: {
	organizationId: string;
	isOrgAdmin: boolean;
}) {
	const { t } = useTranslate();
	const [state, dispatch] = useReducer(
		permissionsPageReducer,
		initialPermissionsPageState,
	);
	const requestSequence = useRef(0);
	const activeOrganizationId = useRef(props.organizationId);
	const mounted = useRef(false);
	const deniedOrganizationId = useRef<string | null>(null);

	useLayoutEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			requestSequence.current++;
		};
	}, []);

	useLayoutEffect(() => {
		activeOrganizationId.current = props.organizationId;
		requestSequence.current++;
	}, [props.organizationId]);

	useEffect(() => {
		if (!props.isOrgAdmin) {
			if (deniedOrganizationId.current === props.organizationId) return;
			deniedOrganizationId.current = props.organizationId;
			toast.error(
				t(
					"settings.permissions.toast.adminRequired",
					"You must be an admin to manage permissions",
				),
			);
			dispatch({
				type: "setBootstrapped",
				payload: {
					currentEmployee: {
						id: props.organizationId,
						role: "employee",
						organizationId: props.organizationId,
					},
					isAdmin: false,
					noEmployee: true,
					employees: [],
					teams: [],
					permissions: {},
				},
			});
			return;
		}
		deniedOrganizationId.current = null;
		let cancelled = false;
		const requestId = ++requestSequence.current;
		dispatch({ type: "setLoading", value: true });
		dispatch({ type: "setEmployees", employees: [] });
		dispatch({ type: "setPermissions", permissions: {} });
		dispatch({ type: "setSelectedEmployee", employee: null });

		async function loadData() {
			let result: Awaited<ReturnType<typeof loadPermissionsPageData>>;
			try {
				result = await loadPermissionsPageData(props.organizationId);
			} catch {
				if (cancelled) return;
				if (requestSequence.current !== requestId) return;
				toast.error(
					t(
						"settings.permissions.toast.loadEmployeesFailed",
						"Failed to load employees",
					),
				);
				dispatch({
					type: "setBootstrapped",
					payload: {
						currentEmployee: {
							id: props.organizationId,
							role: "admin",
							organizationId: props.organizationId,
						},
						isAdmin: props.isOrgAdmin,
						noEmployee: false,
						employees: [],
						teams: [],
						permissions: {},
					},
				});
				return;
			}
			if (cancelled) return;
			if (requestSequence.current !== requestId) return;

			if (
				!result.success ||
				!result.data ||
				result.data.organizationId !== props.organizationId
			) {
				toast.error(
					(!result.success ? result.error : undefined) ||
						t(
							"settings.permissions.toast.loadEmployeesFailed",
							"Failed to load employees",
						),
				);
				dispatch({
					type: "setBootstrapped",
					payload: {
						currentEmployee: {
							id: props.organizationId,
							role: "admin",
							organizationId: props.organizationId,
						},
						isAdmin: props.isOrgAdmin,
						noEmployee: false,
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
					currentEmployee: {
						id: props.organizationId,
						role: "admin",
						organizationId: result.data.organizationId,
					},
					isAdmin: props.isOrgAdmin,
					noEmployee: false,
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
	}, [props.isOrgAdmin, props.organizationId, t]);

	const handleRefresh = async () => {
		const organizationId = props.organizationId;
		if (!mounted.current) return;
		if (activeOrganizationId.current !== organizationId) return;
		const requestId = ++requestSequence.current;
		dispatch({ type: "setLoading", value: true });

		let result: Awaited<ReturnType<typeof loadPermissionsPageData>>;
		try {
			result = await loadPermissionsPageData(organizationId);
		} catch {
			if (
				!mounted.current ||
				requestSequence.current !== requestId ||
				activeOrganizationId.current !== organizationId
			)
				return;
			toast.error(
				t(
					"settings.permissions.toast.loadEmployeesFailed",
					"Failed to load employees",
				),
			);
			dispatch({ type: "setLoading", value: false });
			return;
		}
		if (
			!mounted.current ||
			requestSequence.current !== requestId ||
			activeOrganizationId.current !== organizationId
		)
			return;

		if (
			!result.success ||
			!result.data ||
			result.data.organizationId !== organizationId
		) {
			toast.error(
				(!result.success ? result.error : undefined) ||
					t(
						"settings.permissions.toast.loadEmployeesFailed",
						"Failed to load employees",
					),
			);
			dispatch({ type: "setLoading", value: false });
			return;
		}

		dispatch({
			type: "setBootstrapped",
			payload: {
				currentEmployee: {
					id: organizationId,
					role: "admin",
					organizationId: result.data.organizationId,
				},
				isAdmin: props.isOrgAdmin,
				noEmployee: false,
				employees: result.data.employees,
				teams: result.data.teams,
				permissions: buildPermissionMap(result.data.permissions),
			},
		});
	};

	const filteredEmployees = filterEmployeesByQuery(
		state.employees,
		state.searchQuery,
	);
	const isCurrentOrganization =
		state.currentEmployee?.organizationId === props.organizationId &&
		state.isAdmin === props.isOrgAdmin;

	if (!props.isOrgAdmin) {
		return <PermissionsEmptyState noEmployee />;
	}

	if (isCurrentOrganization && (state.noEmployee || !state.isAdmin)) {
		return <PermissionsEmptyState noEmployee={state.noEmployee} />;
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.permissions.title", "Team Permissions")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.permissions.description",
							"Manage employee permissions for team operations",
						)}
					</p>
				</div>
			</div>

			<PermissionsTableCard
				loading={state.loading || !isCurrentOrganization}
				searchQuery={state.searchQuery}
				onSearchChange={(searchQuery) =>
					dispatch({ type: "setSearchQuery", searchQuery })
				}
				onRefresh={handleRefresh}
				employees={isCurrentOrganization ? filteredEmployees : []}
				onEdit={(employee) =>
					dispatch({ type: "setSelectedEmployee", employee })
				}
				getSummary={(employeeId) =>
					getPermissionSummary(state.permissions, employeeId)
				}
			/>

			<PermissionEditorDialog
				selectedEmployee={isCurrentOrganization ? state.selectedEmployee : null}
				currentEmployee={isCurrentOrganization ? state.currentEmployee : null}
				teams={isCurrentOrganization ? state.teams : []}
				currentPermissions={isCurrentOrganization ? state.permissions : {}}
				onClose={() =>
					dispatch({ type: "setSelectedEmployee", employee: null })
				}
				onSuccess={() => {
					dispatch({ type: "setSelectedEmployee", employee: null });
					void handleRefresh();
				}}
			/>
		</div>
	);
}
