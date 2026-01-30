"use client";

import {
	IconDots,
	IconLoader2,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	deleteChangePolicy,
	getChangePolicies,
	type ChangePolicyRecord,
} from "@/app/[locale]/(app)/settings/change-policies/actions";
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
import { queryKeys } from "@/lib/query";

interface ChangePolicyTableProps {
	organizationId: string;
	onCreateClick: () => void;
	onEditClick: (policy: ChangePolicyRecord) => void;
}

export function ChangePolicyTable({
	organizationId,
	onCreateClick,
	onEditClick,
}: ChangePolicyTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [policyToDelete, setPolicyToDelete] = useState<ChangePolicyRecord | null>(null);
	const [search, setSearch] = useState("");

	// Fetch policies
	const {
		data: policies,
		isLoading,
		isFetching,
		isError,
		refetch,
	} = useQuery({
		queryKey: queryKeys.changePolicies.list(organizationId),
		queryFn: async () => {
			const result = await getChangePolicies(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch policies");
			}
			return result.data;
		},
		staleTime: 30 * 1000,
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (policyId: string) => deleteChangePolicy(policyId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.changePolicies.deleted", "Policy deleted"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.changePolicies.list(organizationId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.changePolicies.assignments(organizationId),
				});
				setDeleteDialogOpen(false);
				setPolicyToDelete(null);
			} else {
				toast.error(result.error || t("settings.changePolicies.deleteFailed", "Failed to delete"));
			}
		},
		onError: () => {
			toast.error(t("settings.changePolicies.deleteFailed", "Failed to delete policy"));
		},
	});

	const handleDeleteClick = (policy: ChangePolicyRecord) => {
		setPolicyToDelete(policy);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (policyToDelete) {
			deleteMutation.mutate(policyToDelete.id);
		}
	};

	// Filter policies by search (client-side since typically small list)
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

	// Format days for display
	const formatDays = (days: number): string => {
		if (days === 0) {
			return t("settings.changePolicies.sameDay", "Same day only");
		}
		return t("settings.changePolicies.daysFormat", "{days} days", { days });
	};

	// Column definitions
	const columns = useMemo<ColumnDef<ChangePolicyRecord>[]>(
		() => [
			{
				accessorKey: "name",
				header: t("settings.changePolicies.name", "Name"),
				cell: ({ row }) => (
					<div>
						<div className="flex items-center gap-2">
							<span className="font-medium">{row.original.name}</span>
							{row.original.noApprovalRequired && (
								<Badge variant="outline" className="text-xs">
									{t("settings.changePolicies.trustMode", "Trust Mode")}
								</Badge>
							)}
						</div>
						{row.original.description && (
							<p className="text-xs text-muted-foreground mt-0.5">{row.original.description}</p>
						)}
					</div>
				),
			},
			{
				accessorKey: "selfServiceDays",
				header: () => (
					<div className="text-center">
						{t("settings.changePolicies.selfService", "Self-Service")}
					</div>
				),
				cell: ({ row }) => (
					<div className="text-center">
						{row.original.noApprovalRequired ? (
							<span className="text-muted-foreground">—</span>
						) : (
							<Badge variant="secondary">{formatDays(row.original.selfServiceDays)}</Badge>
						)}
					</div>
				),
			},
			{
				accessorKey: "approvalDays",
				header: () => (
					<div className="text-center">
						{t("settings.changePolicies.approvalWindow", "Approval Window")}
					</div>
				),
				cell: ({ row }) => (
					<div className="text-center">
						{row.original.noApprovalRequired ? (
							<span className="text-muted-foreground">—</span>
						) : row.original.selfServiceDays === 0 && row.original.approvalDays === 0 ? (
							<Badge variant="destructive">
								{t("settings.changePolicies.allClockOuts", "All clock-outs")}
							</Badge>
						) : (
							<Badge variant="outline">{formatDays(row.original.approvalDays)}</Badge>
						)}
					</div>
				),
			},
			{
				accessorKey: "notifyAllManagers",
				header: () => (
					<div className="text-center">
						{t("settings.changePolicies.notification", "Notification")}
					</div>
				),
				cell: ({ row }) => (
					<div className="text-center text-sm text-muted-foreground">
						{row.original.noApprovalRequired ? (
							<span>—</span>
						) : row.original.notifyAllManagers ? (
							t("settings.changePolicies.allManagers", "All managers")
						) : (
							t("settings.changePolicies.primaryOnly", "Primary only")
						)}
					</div>
				),
			},
			{
				id: "actions",
				cell: ({ row }) => (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" className="h-8 w-8">
								<IconDots className="h-4 w-4" />
								<span className="sr-only">{t("common.actions", "Actions")}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => onEditClick(row.original)}>
								<IconPencil className="h-4 w-4 mr-2" />
								{t("common.edit", "Edit")}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onClick={() => handleDeleteClick(row.original)}
								className="text-destructive focus:text-destructive"
							>
								<IconTrash className="h-4 w-4 mr-2" />
								{t("common.delete", "Delete")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				),
			},
		],
		[t, formatDays, onEditClick],
	);

	if (isLoading) {
		return <DataTableSkeleton columnCount={5} rowCount={5} />;
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center justify-center py-12 gap-4">
				<p className="text-muted-foreground">
					{t("settings.changePolicies.loadError", "Failed to load change policies")}
				</p>
				<Button variant="outline" onClick={() => refetch()}>
					<IconRefresh className="h-4 w-4 mr-2" />
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}

	return (
		<>
			<DataTableToolbar
				search={search}
				onSearchChange={setSearch}
				searchPlaceholder={t("settings.changePolicies.searchPlaceholder", "Search policies...")}
				actions={
					<div className="flex items-center gap-2">
						{isFetching && <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
						<Button onClick={onCreateClick}>
							<IconPlus className="h-4 w-4 mr-2" />
							{t("settings.changePolicies.create", "Create Policy")}
						</Button>
					</div>
				}
			/>

			{filteredPolicies.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 gap-4 border rounded-lg">
					<p className="text-muted-foreground">
						{search
							? t("settings.changePolicies.noSearchResults", "No policies match your search")
							: t("settings.changePolicies.noPolicies", "No change policies configured yet")}
					</p>
					{!search && (
						<>
							<p className="text-sm text-muted-foreground max-w-md text-center">
								{t(
									"settings.changePolicies.noPoliciesHint",
									"Without a change policy, employees can edit their time entries without restrictions. Create a policy to enforce approval workflows.",
								)}
							</p>
							<Button onClick={onCreateClick}>
								<IconPlus className="h-4 w-4 mr-2" />
								{t("settings.changePolicies.createFirst", "Create Your First Policy")}
							</Button>
						</>
					)}
				</div>
			) : (
				<DataTable columns={columns} data={filteredPolicies} />
			)}

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.changePolicies.deleteTitle", "Delete Change Policy")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.changePolicies.deleteDescription",
								"Are you sure you want to delete this policy? Any assignments using this policy will also be removed. Employees previously using this policy will have no restrictions until a new policy is assigned.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							disabled={deleteMutation.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deleteMutation.isPending ? (
								<IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
							) : (
								<IconTrash className="h-4 w-4 mr-2" />
							)}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
