"use client";

import { IconSearch, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { Command as CommandPrimitive } from "cmdk";
import { useState } from "react";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { EmployeeSelectList } from "./employee-select-list";
import type { EmployeeSelectModalProps, SelectableEmployee } from "./types";
import { useEmployeeSelect } from "./use-employee-select";

const EMPTY_EXCLUDE_IDS: string[] = [];

/**
 * Modal dialog for selecting employees with search and filters
 */
export function EmployeeSelectModal({
	open,
	onOpenChange,
	listboxId,
	mode,
	selectedIds,
	onSelect,
	onDeselect,
	onConfirm,
	excludeIds,
	filters,
	showFilters = true,
	maxSelections,
	employees: preFilteredEmployees,
}: EmployeeSelectModalProps) {
	const { t } = useTranslate();

	const effectiveExcludeIds = excludeIds ?? EMPTY_EXCLUDE_IDS;

	// Determine if we're using pre-filtered employees
	const usePreFiltered = preFilteredEmployees !== undefined;

	// Track pending selections (for multi-select confirmation)
	const [pendingIds, setPendingIds] = useState<string[]>([]);
	const [hasPendingChanges, setHasPendingChanges] = useState(false);
	const activePendingIds = hasPendingChanges ? pendingIds : selectedIds;

	// Local search state for pre-filtered mode
	const [localSearch, setLocalSearch] = useState("");

	// Use the employee select hook (only when not using pre-filtered list)
	const serverData = useEmployeeSelect({
		filters,
		excludeIds: effectiveExcludeIds,
		enabled: open && !usePreFiltered,
	});

	// Determine which data source to use
	const search = usePreFiltered ? localSearch : serverData.search;
	const setSearch = usePreFiltered ? setLocalSearch : serverData.setSearch;

	// Filter pre-filtered employees by search (client-side)
	const filteredPreFilteredEmployees = (() => {
		if (!usePreFiltered || !preFilteredEmployees) return [];
		if (!localSearch) return preFilteredEmployees;

		const searchLower = localSearch.toLowerCase();
		return preFilteredEmployees.filter((emp) => {
			const displayName = buildAuthUserDisplayName(emp.user).toLowerCase();

			return (
				displayName.includes(searchLower) ||
				emp.user.email.toLowerCase().includes(searchLower) ||
				emp.position?.toLowerCase().includes(searchLower)
			);
		});
	})();

	// Select the appropriate data source
	const employees = usePreFiltered ? filteredPreFilteredEmployees : serverData.employees;
	const total = usePreFiltered ? (preFilteredEmployees?.length ?? 0) : serverData.total;
	const hasMore = usePreFiltered ? false : serverData.hasMore;
	const isLoading = usePreFiltered ? false : serverData.isLoading;
	const isFetching = usePreFiltered ? false : serverData.isFetching;
	const loadMore = usePreFiltered ? () => {} : serverData.loadMore;

	// Filter controls (only for server-side mode)
	const roleFilter = serverData.roleFilter;
	const setRoleFilter = serverData.setRoleFilter;
	const statusFilter = serverData.statusFilter;
	const setStatusFilter = serverData.setStatusFilter;
	const teamFilter = serverData.teamFilter;
	const setTeamFilter = serverData.setTeamFilter;

	// Don't show filters when using pre-filtered list
	const effectiveShowFilters = showFilters && !usePreFiltered;

	// Fetch teams for filter dropdown
	const teamsQuery = useQuery({
		queryKey: queryKeys.teams.list(""),
		queryFn: async () => {
			const result = await listTeams();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch teams");
			}
			return result.data;
		},
		enabled: open && effectiveShowFilters,
		staleTime: 5 * 60 * 1000,
	});

	// Track selected employees for display
	const [selectedEmployeesMap, setSelectedEmployeesMap] = useState<Map<string, SelectableEmployee>>(
		new Map(),
	);

	// Handle selection
	const handleSelect = (employee: SelectableEmployee) => {
		if (mode === "single") {
			// In single mode, directly call onSelect and close
			onSelect(employee);
			onOpenChange(false);
		} else {
			// In multi mode, add to pending
			if (!activePendingIds.includes(employee.id)) {
				setHasPendingChanges(true);
				setPendingIds([...activePendingIds, employee.id]);
				setSelectedEmployeesMap((prev) => new Map(prev).set(employee.id, employee));
			}
		}
	};

	// Handle deselection
	const handleDeselect = (employeeId: string) => {
		if (mode === "single") {
			onDeselect(employeeId);
		} else {
			setHasPendingChanges(true);
			setPendingIds(activePendingIds.filter((id) => id !== employeeId));
			setSelectedEmployeesMap((prev) => {
				const newMap = new Map(prev);
				newMap.delete(employeeId);
				return newMap;
			});
		}
	};

	// Handle confirm for multi-select
	const handleConfirm = () => {
		if (mode === "multiple") {
			// Apply all pending selections
			const toDeselect = selectedIds.filter((id) => !activePendingIds.includes(id));
			const toSelect = activePendingIds.filter((id) => !selectedIds.includes(id));

			for (const id of toDeselect) {
				onDeselect(id);
			}

			for (const id of toSelect) {
				const employee = selectedEmployeesMap.get(id);
				if (employee) {
					onSelect(employee);
				}
			}
		}
		onConfirm();
		onOpenChange(false);
	};

	// Handle cancel
	const handleCancel = () => {
		setPendingIds([]);
		setHasPendingChanges(false);
		onOpenChange(false);
	};

	// Select all visible employees
	const handleSelectAll = () => {
		const availableIds = employees
			.filter((emp) => !activePendingIds.includes(emp.id))
			.map((emp) => emp.id);

		// Respect max selections
		let idsToAdd = availableIds;
		if (maxSelections) {
			const remaining = maxSelections - activePendingIds.length;
			idsToAdd = availableIds.slice(0, remaining);
		}

		const newMap = new Map(selectedEmployeesMap);
		for (const id of idsToAdd) {
			const employee = employees.find((e) => e.id === id);
			if (employee) {
				newMap.set(id, employee);
			}
		}

		setHasPendingChanges(true);
		setPendingIds([...activePendingIds, ...idsToAdd]);
		setSelectedEmployeesMap(newMap);
	};

	// Clear all selections
	const handleClearAll = () => {
		setHasPendingChanges(true);
		setPendingIds([]);
		setSelectedEmployeesMap(new Map());
	};

	const effectiveSelectedIds = mode === "multiple" ? activePendingIds : selectedIds;
	const selectionCount = effectiveSelectedIds.length;
	const hasChanges =
		mode === "multiple" &&
		(effectiveSelectedIds.length !== selectedIds.length ||
			!effectiveSelectedIds.every((id) => selectedIds.includes(id)));

	return (
		<ActionPanel open={open} onOpenChange={handleCancel}>
			<ActionPanelContent showCloseButton={false}>
				<ActionPanelHeader className="sr-only">
					<ActionPanelTitle>
						{mode === "single"
							? t("common:employeeSelect.selectEmployee", "Select Employee")
							: t("common:employeeSelect.selectEmployees", "Select Employees")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{mode === "single"
							? t("common:employeeSelect.selectOneEmployee", "Choose an employee from the list")
							: t(
									"common:employeeSelect.selectMultipleEmployees",
									"Choose one or more employees from the list",
								)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody className="p-0">
					<CommandPrimitive
						shouldFilter={false}
						className={cn(
							"bg-popover text-popover-foreground flex h-full flex-col overflow-hidden",
							"border-0",
						)}
					>
						{/* IconSearch input */}
						<div className="flex items-center gap-2 border-b border-border/50 px-4">
							<IconSearch className="size-4 shrink-0 text-muted-foreground" />
							<CommandPrimitive.Input
								placeholder={t(
									"common:employeeSelect.searchPlaceholder",
									"IconSearch by name, email, or position...",
								)}
								value={search}
								onValueChange={setSearch}
								className={cn(
									"flex h-12 w-full bg-transparent py-3 text-sm outline-none",
									"placeholder:text-muted-foreground",
									"disabled:cursor-not-allowed disabled:opacity-50",
								)}
							/>
							{/* Close button integrated in search bar */}
							<button
								type="button"
								aria-label={t("common.close", "Close")}
								onClick={handleCancel}
								className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
							>
								<IconX className="size-4" />
							</button>
						</div>

						{/* Filters - more subtle styling */}
						{effectiveShowFilters && (
							<div className="flex flex-wrap gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/30">
								{/* Role filter */}
								<Select value={roleFilter} onValueChange={setRoleFilter}>
									<SelectTrigger className="w-[120px] h-7 text-xs bg-background/50">
										<SelectValue placeholder={t("common:employeeSelect.role", "Role")} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">{t("common.all", "All")}</SelectItem>
										<SelectItem value="admin">{t("common:roles.admin", "Admin")}</SelectItem>
										<SelectItem value="manager">{t("common:roles.manager", "Manager")}</SelectItem>
										<SelectItem value="employee">
											{t("common:roles.employee", "Employee")}
										</SelectItem>
									</SelectContent>
								</Select>

								{/* Status filter */}
								<Select value={statusFilter} onValueChange={setStatusFilter}>
									<SelectTrigger className="w-[120px] h-7 text-xs bg-background/50">
										<SelectValue placeholder={t("common:employeeSelect.status", "Status")} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">{t("common.all", "All")}</SelectItem>
										<SelectItem value="active">{t("common:status.active", "Active")}</SelectItem>
										<SelectItem value="inactive">
											{t("common:status.inactive", "Inactive")}
										</SelectItem>
									</SelectContent>
								</Select>

								{/* Team filter */}
								<Select value={teamFilter} onValueChange={setTeamFilter}>
									<SelectTrigger className="w-[140px] h-7 text-xs bg-background/50">
										<SelectValue placeholder={t("common:employeeSelect.team", "Team")} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="">{t("common.all", "All Teams")}</SelectItem>
										{teamsQuery.data?.map((team) => (
											<SelectItem key={team.id} value={team.id}>
												{team.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						{/* Multi-select controls - cleaner look */}
						{mode === "multiple" && (
							<div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/20">
								<div className="flex items-center gap-2">
									<span className="text-xs text-muted-foreground">
										{t("common:employeeSelect.selected", "{count} selected", {
											count: selectionCount,
										})}
										{maxSelections && <span className="ml-1 opacity-60">/ {maxSelections}</span>}
									</span>

									{/* Selected badges (show first 3) */}
									<div className="flex items-center gap-1">
										{activePendingIds.slice(0, 3).map((id) => {
											const emp =
												selectedEmployeesMap.get(id) || employees.find((e) => e.id === id);
											if (!emp) return null;
											const name = buildAuthUserDisplayName(emp.user);
											return (
												<Badge key={id} variant="secondary" className="text-xs pl-2 pr-1 gap-1 h-6">
													<span className="truncate max-w-[60px]">{name}</span>
													<button
														type="button"
														onClick={() => handleDeselect(id)}
														className="hover:bg-muted rounded-full p-0.5"
													>
														<IconX className="size-3" />
													</button>
												</Badge>
											);
										})}
										{activePendingIds.length > 3 && (
											<Badge variant="secondary" className="text-xs h-6">
												+{activePendingIds.length - 3}
											</Badge>
										)}
									</div>
								</div>

								<div className="flex gap-1">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 text-xs"
										onClick={handleSelectAll}
										disabled={
											isLoading ||
											employees.length === 0 ||
											(maxSelections !== undefined && selectionCount >= maxSelections)
										}
									>
										{t("common.selectAll", "Select All")}
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 text-xs"
										onClick={handleClearAll}
										disabled={selectionCount === 0}
									>
										{t("common.clear", "Clear")}
									</Button>
								</div>
							</div>
						)}

						{/* Employee list */}
						<CommandPrimitive.List
							id={listboxId}
							className="max-h-[320px] overflow-y-auto overflow-x-hidden scroll-py-2 p-2"
						>
							<EmployeeSelectList
								employees={employees}
								selectedIds={effectiveSelectedIds}
								mode={mode}
								onSelect={handleSelect}
								onDeselect={handleDeselect}
								isLoading={isLoading || isFetching}
								hasMore={hasMore}
								onLoadMore={loadMore}
								maxSelections={maxSelections}
							/>
						</CommandPrimitive.List>

						{/* Footer - minimal, integrated */}
						<div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 bg-muted/20">
							<span className="text-xs text-muted-foreground">
								{t("common:employeeSelect.totalEmployees", "{count} employees", { count: total })}
							</span>
							<div className="flex gap-2">
								{mode === "multiple" && (
									<Button
										type="button"
										size="sm"
										className="h-8"
										onClick={handleConfirm}
										disabled={!hasChanges && selectionCount === 0}
									>
										{t("common.confirm", "Confirm")}
										{selectionCount > 0 && ` (${selectionCount})`}
									</Button>
								)}
							</div>
						</div>
					</CommandPrimitive>
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}
