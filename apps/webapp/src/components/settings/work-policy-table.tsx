"use client";

import {
	IconCalendar,
	IconCopy,
	IconDots,
	IconGavel,
	IconLoader2,
	IconMapPin,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconStar,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	deleteWorkPolicy,
	duplicateWorkPolicy,
	getWorkPolicies,
	setDefaultWorkPolicy,
	type WorkPolicyWithDetails,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { DataTable, DataTableSkeleton, DataTableToolbar } from "@/components/data-table-server";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { queryKeys } from "@/lib/query";

interface WorkPolicyTableProps {
	organizationId: string;
	onCreateClick: () => void;
	onEditClick: (policy: WorkPolicyWithDetails) => void;
}

export function WorkPolicyTable({
	organizationId,
	onCreateClick,
	onEditClick,
}: WorkPolicyTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [policyToDelete, setPolicyToDelete] = useState<WorkPolicyWithDetails | null>(null);
	const [search, setSearch] = useState("");

	// Fetch policies
	const {
		data: policies,
		isLoading,
		isFetching,
		isError,
		refetch,
	} = useQuery({
		queryKey: queryKeys.workPolicies.list(organizationId),
		queryFn: async () => {
			const result = await getWorkPolicies(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch policies");
			}
			return result.data;
		},
		staleTime: 30 * 1000,
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (policyId: string) => deleteWorkPolicy(policyId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.deleted", "Policy deleted"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workPolicies.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setPolicyToDelete(null);
			} else {
				toast.error(result.error || t("settings.workPolicies.deleteFailed", "Failed to delete"));
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.deleteFailed", "Failed to delete policy"));
		},
	});

	// Duplicate mutation
	const duplicateMutation = useMutation({
		mutationFn: (policyId: string) => duplicateWorkPolicy(policyId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.duplicated", "Policy duplicated"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workPolicies.list(organizationId),
				});
			} else {
				toast.error(
					result.error || t("settings.workPolicies.duplicateFailed", "Failed to duplicate"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.duplicateFailed", "Failed to duplicate policy"));
		},
	});

	// Set default mutation
	const setDefaultMutation = useMutation({
		mutationFn: (policyId: string) => setDefaultWorkPolicy(policyId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workPolicies.defaultSet", "Default policy set"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workPolicies.list(organizationId),
				});
			} else {
				toast.error(
					result.error || t("settings.workPolicies.setDefaultFailed", "Failed to set default"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workPolicies.setDefaultFailed", "Failed to set default policy"));
		},
	});

	const handleDeleteClick = (policy: WorkPolicyWithDetails) => {
		setPolicyToDelete(policy);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (policyToDelete) {
			deleteMutation.mutate(policyToDelete.id);
		}
	};

	// Filter policies by search
	const filteredPolicies = useMemo(() => {
		if (!policies) return [];
		if (!search) return policies;

		const searchLower = search.toLowerCase();
		return policies.filter(
			(policy) =>
				policy.name.toLowerCase().includes(searchLower) ||
				policy.description?.toLowerCase().includes(searchLower),
		);
	}, [policies, search]);

	// Column definitions
	const columns = useMemo<ColumnDef<WorkPolicyWithDetails>[]>(
		() => [
			{
				accessorKey: "name",
				header: t("settings.workPolicies.name", "Name"),
				cell: ({ row }) => (
					<div className="max-w-[300px]">
						<div className="flex items-center gap-2">
							<span className="font-medium truncate">{row.original.name}</span>
							{row.original.isDefault && (
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger>
											<IconStar className="h-4 w-4 text-yellow-500 fill-yellow-500 shrink-0" />
										</TooltipTrigger>
										<TooltipContent>
											{t("settings.workPolicies.defaultPolicy", "Default policy")}
										</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							)}
						</div>
						{row.original.description && (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
											{row.original.description}
										</p>
									</TooltipTrigger>
									<TooltipContent className="max-w-sm">
										<p>{row.original.description}</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						)}
					</div>
				),
			},
			{
				accessorKey: "features",
				header: () => (
					<div className="text-center">{t("settings.workPolicies.features", "Features")}</div>
				),
				cell: ({ row }) => (
					<div className="flex justify-center gap-1">
						{row.original.scheduleEnabled && (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger>
										<Badge variant="outline" className="gap-1">
											<IconCalendar className="h-3 w-3" />
											{t("settings.workPolicies.schedule", "Schedule")}
										</Badge>
									</TooltipTrigger>
									<TooltipContent>
										{t("settings.workPolicies.scheduleEnabled", "Work schedule enabled")}
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						)}
						{row.original.regulationEnabled && (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger>
										<Badge variant="outline" className="gap-1">
											<IconGavel className="h-3 w-3" />
											{t("settings.workPolicies.regulation", "Regulation")}
										</Badge>
									</TooltipTrigger>
									<TooltipContent>
										{t("settings.workPolicies.regulationEnabled", "Time regulation enabled")}
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						)}
						{row.original.presenceEnabled && (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger>
										<Badge variant="outline" className="gap-1">
											<IconMapPin className="h-3 w-3" />
											{t("settings.workPolicies.presenceEnabled", "Presence")}
										</Badge>
									</TooltipTrigger>
									<TooltipContent>
										{row.original.presence
											? row.original.presence.presenceMode === "minimum_count"
												? t("settings.workPolicies.presenceSummaryDaysPerWeek", "{count} days/{period} on-site", {
													count: row.original.presence.requiredOnsiteDays,
													period: row.original.presence.evaluationPeriod,
												})
												: t("settings.workPolicies.presenceSummaryFixedDays", "Fixed days on-site")
											: t("settings.workPolicies.presenceEnabledTooltip", "On-site presence required")
										}
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						)}
					</div>
				),
			},
			{
				accessorKey: "scheduleHours",
				header: () => (
					<div className="text-center">
						{t("settings.workPolicies.weeklyHours", "Weekly Hours")}
					</div>
				),
				cell: ({ row }) => {
					if (!row.original.scheduleEnabled || !row.original.schedule) {
						return <div className="text-center text-muted-foreground">—</div>;
					}
					const schedule = row.original.schedule;
					if (schedule.scheduleType === "simple" && schedule.hoursPerCycle) {
						return <div className="text-center tabular-nums">{schedule.hoursPerCycle}h</div>;
					}
					if (schedule.scheduleType === "detailed" && schedule.days) {
						const totalHours = schedule.days
							.filter((d) => d.isWorkDay)
							.reduce((sum, d) => sum + parseFloat(d.hoursPerDay || "0"), 0);
						return <div className="text-center tabular-nums">{totalHours.toFixed(1)}h</div>;
					}
					return <div className="text-center text-muted-foreground">—</div>;
				},
			},
			{
				accessorKey: "breakRules",
				header: () => (
					<div className="text-center">{t("settings.workPolicies.breakRules", "Break Rules")}</div>
				),
				cell: ({ row }) => {
					if (!row.original.regulationEnabled || !row.original.regulation) {
						return <div className="text-center text-muted-foreground">—</div>;
					}
					return (
						<div className="text-center">
							<Badge variant="outline">{row.original.regulation.breakRules?.length || 0}</Badge>
						</div>
					);
				},
			},
			{
				id: "actions",
				cell: ({ row }) => (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" className="h-8 w-8">
								<IconDots className="h-4 w-4" />
								<span className="sr-only">{t("common.openMenu", "Open menu")}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => onEditClick(row.original)}>
								<IconPencil className="mr-2 h-4 w-4" />
								{t("common.edit", "Edit")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => duplicateMutation.mutate(row.original.id)}
								disabled={duplicateMutation.isPending}
							>
								<IconCopy className="mr-2 h-4 w-4" />
								{t("common.duplicate", "Duplicate")}
							</DropdownMenuItem>
							{!row.original.isDefault && (
								<DropdownMenuItem
									onClick={() => setDefaultMutation.mutate(row.original.id)}
									disabled={setDefaultMutation.isPending}
								>
									<IconStar className="mr-2 h-4 w-4" />
									{t("settings.workPolicies.setAsDefault", "Set as Default")}
								</DropdownMenuItem>
							)}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive"
								onClick={() => handleDeleteClick(row.original)}
								disabled={row.original.isDefault}
							>
								<IconTrash className="mr-2 h-4 w-4" />
								{t("common.delete", "Delete")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				),
			},
		],
		[t, onEditClick, duplicateMutation, setDefaultMutation],
	);

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-end">
					<Button onClick={onCreateClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.workPolicies.create", "Create Policy")}
					</Button>
				</div>
				<DataTableSkeleton columnCount={5} rowCount={5} />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
				<p className="text-destructive">
					{t("settings.workPolicies.loadError", "Failed to load policies")}
				</p>
				<Button className="mt-4" variant="outline" onClick={() => refetch()}>
					<IconRefresh className="mr-2 h-4 w-4" />
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<DataTableToolbar
				search={search}
				onSearchChange={setSearch}
				searchPlaceholder={t("settings.workPolicies.searchPlaceholder", "Search policies...")}
				actions={
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
							{isFetching ? (
								<IconLoader2 className="h-4 w-4 animate-spin" />
							) : (
								<IconRefresh className="h-4 w-4" />
							)}
							<span className="sr-only">{t("common.refresh", "Refresh")}</span>
						</Button>
						<Button onClick={onCreateClick}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.workPolicies.create", "Create Policy")}
						</Button>
					</div>
				}
			/>

			<DataTable
				columns={columns}
				data={filteredPolicies}
				isFetching={isFetching}
				emptyMessage={
					search
						? t("settings.workPolicies.noSearchResults", "No policies match your search.")
						: t(
								"settings.workPolicies.noPolicies",
								"No work policies. Create a policy to define work schedules and time regulations.",
							)
				}
			/>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.workPolicies.deleteTitle", "Delete Policy")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.workPolicies.deleteDescription",
								'Are you sure you want to delete "{name}"? This will also remove all assignments for this policy. This action cannot be undone.',
								{ name: policyToDelete?.name },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
