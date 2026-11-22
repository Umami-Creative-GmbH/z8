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
import { useState } from "react";
import { toast } from "sonner";
import {
	type ChangePolicyRecord,
	deleteChangePolicy,
	getChangePolicies,
} from "@/app/[locale]/(app)/settings/work-policies/change-policy-actions";
import { DataTable, DataTableSkeleton, DataTableToolbar } from "@/components/data-table-server";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";

interface ChangePolicyTableProps {
	canManage: boolean;
	organizationId: string;
	onCreateClick: () => void;
	onEditClick: (policy: ChangePolicyRecord) => void;
}

export function ChangePolicyTable({
	canManage,
	organizationId,
	onCreateClick,
	onEditClick,
}: ChangePolicyTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [policyToDelete, setPolicyToDelete] = useState<ChangePolicyRecord | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
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
			const result = await getChangePolicies();
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
			} else {
				// The dialog stays open with the reason so the deletion can be retried.
				setDeleteError(
					actionErrorMessage(t, result, {}, [
						"settings.changePolicies.deleteFailed",
						"Failed to delete",
					]),
				);
			}
		},
		onError: () => {
			setDeleteError(t("settings.changePolicies.deleteFailed", "Failed to delete policy"));
		},
	});

	const handleDeleteClick = (policy: ChangePolicyRecord) => {
		setPolicyToDelete(policy);
		setDeleteError(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (policyToDelete && !deleteMutation.isPending) {
			setDeleteError(null);
			deleteMutation.mutate(policyToDelete.id);
		}
	};

	// Filter policies by search (client-side since typically small list)
	const filteredPolicies = (() => {
		if (!policies) return [];
		if (!search) return policies;

		const searchLower = search.toLowerCase();
		return policies.filter(
			(policy) =>
				policy.name.toLowerCase().includes(searchLower) ||
				policy.description?.toLowerCase().includes(searchLower),
		);
	})();

	// Format days for display
	const formatDays = (days: number): string => {
		if (days === 0) {
			return t("settings.changePolicies.sameDay", "Same day only");
		}
		return t("settings.changePolicies.daysFormat", "{days} days", { days });
	};

	// Column definitions
	const columns: ColumnDef<DataTableFeatures, ChangePolicyRecord>[] = [
		{
			accessorKey: "name",
			header: t("settings.changePolicies.name", "Name"),
			cell: ({ row }) => (
				<div className="min-w-0 max-w-[300px]">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<span className="min-w-0 truncate font-medium" title={row.original.name}>
							{row.original.name}
						</span>
						{row.original.noApprovalRequired && (
							<Badge variant="outline" className="text-xs">
								{t("settings.changePolicies.trustMode", "Trust Mode")}
							</Badge>
						)}
					</div>
					{row.original.description && (
						<p className="mt-0.5 break-words text-xs text-muted-foreground">
							{row.original.description}
						</p>
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
						<span className="text-muted-foreground">{t("common.notApplicable", "N/A")}</span>
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
						<span className="text-muted-foreground">{t("common.notApplicable", "N/A")}</span>
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
						<span>{t("common.notApplicable", "N/A")}</span>
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
			cell: ({ row }) =>
				canManage ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-8"
								aria-label={t("settings.changePolicies.actionsFor", "Actions for {name}", {
									name: row.original.name,
								})}
							>
								<IconDots className="size-4" aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => onEditClick(row.original)}>
								<IconPencil className="size-4 mr-2" />
								{t("common.edit", "Edit")}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onClick={() => handleDeleteClick(row.original)}
								className="text-destructive focus:text-destructive"
							>
								<IconTrash className="size-4 mr-2" />
								{t("common.delete", "Delete")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				) : null,
		},
	];

	if (isLoading) {
		return <DataTableSkeleton columnCount={5} rowCount={5} />;
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center justify-center py-12 gap-4">
				<p role="alert" className="text-destructive">
					{t("settings.changePolicies.loadError", "Failed to load change policies")}
				</p>
				<Button variant="outline" onClick={() => refetch()}>
					<IconRefresh className="size-4 mr-2" />
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
						{isFetching && (
							<IconLoader2
								className="size-4 animate-spin text-muted-foreground"
								role="status"
								aria-label={t("common.refreshing", "Refreshing...")}
							/>
						)}
						{canManage ? (
							<Button onClick={onCreateClick}>
								<IconPlus className="size-4 mr-2" />
								{t("settings.changePolicies.create", "Create Policy")}
							</Button>
						) : null}
					</div>
				}
			/>

			{filteredPolicies.length === 0 ? (
				<ChangePoliciesEmptyState
					search={search}
					canManage={canManage}
					onCreateClick={onCreateClick}
				/>
			) : (
				<DataTable mobileLayout="stacked" columns={columns} data={filteredPolicies} />
			)}

			<DeleteConfirmDialog
				open={canManage && deleteDialogOpen}
				onOpenChange={(open) => {
					setDeleteDialogOpen(open);
					if (!open) setDeleteError(null);
				}}
				title={t("settings.changePolicies.deleteTitle", "Delete Change Policy")}
				description={
					policyToDelete
						? t(
								"settings.changePolicies.deleteNamedDescription",
								'Delete the change policy "{name}"? Any assignments using this policy will also be removed. Employees previously using this policy will have no restrictions until a new policy is assigned.',
								{ name: policyToDelete.name },
							)
						: t(
								"settings.changePolicies.deleteDescription",
								"Are you sure you want to delete this policy? Any assignments using this policy will also be removed. Employees previously using this policy will have no restrictions until a new policy is assigned.",
							)
				}
				isDeleting={deleteMutation.isPending}
				error={deleteError}
				onConfirm={handleDeleteConfirm}
			/>
		</>
	);
}

function ChangePoliciesEmptyState({
	search,
	canManage,
	onCreateClick,
}: {
	search: string;
	canManage: boolean;
	onCreateClick: () => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex flex-col items-center justify-center py-12 gap-4 border rounded-lg">
			<p className="text-muted-foreground">
				{search
					? t("settings.changePolicies.noSearchResults", "No policies match your search")
					: t("settings.changePolicies.noPolicies", "No change policies configured yet")}
			</p>
			{!search && canManage ? (
				<>
					<p className="text-sm text-muted-foreground max-w-md text-center">
						{t(
							"settings.changePolicies.noPoliciesHint",
							"Without a change policy, employees can edit their time entries without restrictions. Create a policy to enforce approval workflows.",
						)}
					</p>
					<Button onClick={onCreateClick}>
						<IconPlus className="size-4 mr-2" />
						{t("settings.changePolicies.createFirst", "Create Your First Policy")}
					</Button>
				</>
			) : null}
		</div>
	);
}
