"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/keys";
import { EmployeeSelectList } from "./employee-select-list";
import type { EmployeeSelectModalProps, SelectableEmployee } from "./types";
import { useEmployeeSelect } from "./use-employee-select";

/**
 * Modal dialog for selecting employees with search and filters
 */
export function EmployeeSelectModal({
	open,
	onOpenChange,
	mode,
	selectedIds,
	onSelect,
	onDeselect,
	onConfirm,
	excludeIds = [],
	filters,
	showFilters = true,
	maxSelections,
	employees: preFilteredEmployees,
}: EmployeeSelectModalProps) {
	const { t } = useTranslate();

	// Determine if we're using pre-filtered employees
	const usePreFiltered = preFilteredEmployees !== undefined;

	// Track pending selections (for multi-select confirmation)
	const [pendingIds, setPendingIds] = useState<string[]>(selectedIds);

	// Local search state for pre-filtered mode
	const [localSearch, setLocalSearch] = useState("");

	// Sync pending state when modal opens
	useMemo(() => {
		if (open) {
			setPendingIds(selectedIds);
			setLocalSearch("");
		}
	}, [open, selectedIds]);

	// Use the employee select hook (only when not using pre-filtered list)
	const serverData = useEmployeeSelect({
		filters,
		excludeIds,
		enabled: open && !usePreFiltered,
	});

	// Determine which data source to use
	const search = usePreFiltered ? localSearch : serverData.search;
	const setSearch = usePreFiltered ? setLocalSearch : serverData.setSearch;

	// Filter pre-filtered employees by search (client-side)
	const filteredPreFilteredEmployees = useMemo(() => {
		if (!usePreFiltered || !preFilteredEmployees) return [];
		if (!localSearch) return preFilteredEmployees;

		const searchLower = localSearch.toLowerCase();
		return preFilteredEmployees.filter(
			(emp) =>
				emp.user.name?.toLowerCase().includes(searchLower) ||
				emp.user.email.toLowerCase().includes(searchLower) ||
				emp.firstName?.toLowerCase().includes(searchLower) ||
				emp.lastName?.toLowerCase().includes(searchLower) ||
				emp.position?.toLowerCase().includes(searchLower),
		);
	}, [usePreFiltered, preFilteredEmployees, localSearch]);

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
			if (!pendingIds.includes(employee.id)) {
				setPendingIds((prev) => [...prev, employee.id]);
				setSelectedEmployeesMap((prev) => new Map(prev).set(employee.id, employee));
			}
		}
	};

	// Handle deselection
	const handleDeselect = (employeeId: string) => {
		if (mode === "single") {
			onDeselect(employeeId);
		} else {
			setPendingIds((prev) => prev.filter((id) => id !== employeeId));
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
			const toDeselect = selectedIds.filter((id) => !pendingIds.includes(id));
			const toSelect = pendingIds.filter((id) => !selectedIds.includes(id));

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
		setPendingIds(selectedIds);
		onOpenChange(false);
	};

	// Select all visible employees
	const handleSelectAll = () => {
		const availableIds = employees
			.filter((emp) => !pendingIds.includes(emp.id))
			.map((emp) => emp.id);

		// Respect max selections
		let idsToAdd = availableIds;
		if (maxSelections) {
			const remaining = maxSelections - pendingIds.length;
			idsToAdd = availableIds.slice(0, remaining);
		}

		const newMap = new Map(selectedEmployeesMap);
		for (const id of idsToAdd) {
			const employee = employees.find((e) => e.id === id);
			if (employee) {
				newMap.set(id, employee);
			}
		}

		setPendingIds((prev) => [...prev, ...idsToAdd]);
		setSelectedEmployeesMap(newMap);
	};

	// Clear all selections
	const handleClearAll = () => {
		setPendingIds([]);
		setSelectedEmployeesMap(new Map());
	};

	const effectiveSelectedIds = mode === "multiple" ? pendingIds : selectedIds;
	const selectionCount = effectiveSelectedIds.length;
	const hasChanges =
		mode === "multiple" &&
		(pendingIds.length !== selectedIds.length ||
			!pendingIds.every((id) => selectedIds.includes(id)));

	return (
		<DialogPrimitive.Root open={open} onOpenChange={handleCancel}>
			<DialogPrimitive.Portal>
				{/* Overlay with fade animation */}
				<DialogPrimitive.Overlay
					className={cn(
						"fixed inset-0 z-50 bg-black/50",
						"data-[state=open]:animate-in data-[state=closed]:animate-out",
						"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
					)}
				/>

				{/* Floating command palette */}
				<DialogPrimitive.Content
					className={cn(
						"fixed left-[50%] top-[50%] z-50 w-full max-w-[540px] translate-x-[-50%] translate-y-[-50%]",
						"data-[state=open]:animate-in data-[state=closed]:animate-out",
						"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
						"data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
						"duration-200 outline-none",
					)}
				>
					{/* Accessibility - hidden but required */}
					<DialogPrimitive.Title className="sr-only">
						{mode === "single"
							? t("employeeSelect.selectEmployee", "Select Employee")
							: t("employeeSelect.selectEmployees", "Select Employees")}
					</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">
						{mode === "single"
							? t("employeeSelect.selectOneEmployee", "Choose an employee from the list")
							: t(
									"employeeSelect.selectMultipleEmployees",
									"Choose one or more employees from the list",
								)}
					</DialogPrimitive.Description>

					{/* Command palette container - floating style */}
					<CommandPrimitive
						shouldFilter={false}
						className={cn(
							"bg-popover text-popover-foreground flex flex-col overflow-hidden",
							"rounded-xl shadow-2xl",
							"border-0",
						)}
					>
						{/* Search input */}
						<div className="flex items-center gap-2 border-b border-border/50 px-4">
							<SearchIcon className="size-4 shrink-0 text-muted-foreground" />
							<CommandPrimitive.Input
								placeholder={t(
									"employeeSelect.searchPlaceholder",
									"Search by name, email, or position...",
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
								onClick={handleCancel}
								className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
							>
								<IconX className="h-4 w-4" />
							</button>
						</div>

						{/* Filters - more subtle styling */}
						{effectiveShowFilters && (
							<div className="flex flex-wrap gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/30">
								{/* Role filter */}
								<Select value={roleFilter} onValueChange={setRoleFilter}>
									<SelectTrigger className="w-[120px] h-7 text-xs bg-background/50">
										<SelectValue placeholder={t("employeeSelect.role", "Role")} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">{t("common.all", "All")}</SelectItem>
										<SelectItem value="admin">{t("roles.admin", "Admin")}</SelectItem>
										<SelectItem value="manager">{t("roles.manager", "Manager")}</SelectItem>
										<SelectItem value="employee">{t("roles.employee", "Employee")}</SelectItem>
									</SelectContent>
								</Select>

								{/* Status filter */}
								<Select value={statusFilter} onValueChange={setStatusFilter}>
									<SelectTrigger className="w-[120px] h-7 text-xs bg-background/50">
										<SelectValue placeholder={t("employeeSelect.status", "Status")} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">{t("common.all", "All")}</SelectItem>
										<SelectItem value="active">{t("status.active", "Active")}</SelectItem>
										<SelectItem value="inactive">{t("status.inactive", "Inactive")}</SelectItem>
									</SelectContent>
								</Select>

								{/* Team filter */}
								<Select value={teamFilter} onValueChange={setTeamFilter}>
									<SelectTrigger className="w-[140px] h-7 text-xs bg-background/50">
										<SelectValue placeholder={t("employeeSelect.team", "Team")} />
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
										{t("employeeSelect.selected", "{count} selected", { count: selectionCount })}
										{maxSelections && (
											<span className="ml-1 opacity-60">
												/ {maxSelections}
											</span>
										)}
									</span>

									{/* Selected badges (show first 3) */}
									<div className="flex items-center gap-1">
										{pendingIds.slice(0, 3).map((id) => {
											const emp = selectedEmployeesMap.get(id) || employees.find((e) => e.id === id);
											if (!emp) return null;
											const name =
												emp.firstName || emp.lastName
													? `${emp.firstName || ""} ${emp.lastName || ""}`.trim()
													: emp.user.email.split("@")[0];
											return (
												<Badge key={id} variant="secondary" className="text-xs pl-2 pr-1 gap-1 h-6">
													<span className="truncate max-w-[60px]">{name}</span>
													<button
														type="button"
														onClick={() => handleDeselect(id)}
														className="hover:bg-muted rounded-full p-0.5"
													>
														<IconX className="h-3 w-3" />
													</button>
												</Badge>
											);
										})}
										{pendingIds.length > 3 && (
											<Badge variant="secondary" className="text-xs h-6">
												+{pendingIds.length - 3}
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
						<CommandPrimitive.List className="max-h-[320px] overflow-y-auto overflow-x-hidden scroll-py-2 p-2">
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
								{t("employeeSelect.totalEmployees", "{count} employees", { count: total })}
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
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
