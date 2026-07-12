"use client";

import { IconLoader2, IconPlus, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query";
import { getWorkPolicyTableColumns } from "./work-policy-table-columns";

interface WorkPolicyTableProps {
	organizationId: string;
	canManagePolicies?: boolean;
	onCreateClick: () => void;
	onEditClick: (policy: WorkPolicyWithDetails) => void;
}

export function WorkPolicyTable({
	organizationId,
	canManagePolicies = true,
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

	const columns = getWorkPolicyTableColumns({
		t,
		canManagePolicies,
		onEdit: onEditClick,
		onDuplicate: (policyId) => duplicateMutation.mutate(policyId),
		onSetDefault: (policyId) => setDefaultMutation.mutate(policyId),
		onDelete: handleDeleteClick,
		isDuplicatePending: duplicateMutation.isPending,
		isSetDefaultPending: setDefaultMutation.isPending,
	});

	if (isLoading) {
		return (
			<div className="space-y-4">
				{canManagePolicies ? (
					<div className="flex justify-end">
						<Button onClick={onCreateClick}>
							<IconPlus className="mr-2 size-4" />
							{t("settings.workPolicies.create", "Create Policy")}
						</Button>
					</div>
				) : null}
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
					<IconRefresh className="mr-2 size-4" />
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
								<IconLoader2 className="size-4 animate-spin" />
							) : (
								<IconRefresh className="size-4" />
							)}
							<span className="sr-only">{t("common.refresh", "Refresh")}</span>
						</Button>
						{canManagePolicies ? (
							<Button onClick={onCreateClick}>
								<IconPlus className="mr-2 size-4" />
								{t("settings.workPolicies.create", "Create Policy")}
							</Button>
						) : null}
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
							{deleteMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
