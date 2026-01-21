"use client";

import {
	IconDots,
	IconLoader2,
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
	deleteVacationPolicy,
	getVacationPolicies,
} from "@/app/[locale]/(app)/settings/vacation/actions";
import {
	DataTable,
	DataTableSkeleton,
	DataTableToolbar,
} from "@/components/data-table-server";
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
import { VacationPolicyForm } from "./vacation-policy-form";

interface VacationPolicy {
	id: string;
	name: string;
	startDate: string; // YYYY-MM-DD
	validUntil: string | null; // YYYY-MM-DD or null
	isCompanyDefault: boolean;
	isActive: boolean;
	defaultAnnualDays: string;
	accrualType: string;
	accrualStartMonth: number | null;
	allowCarryover: boolean;
	maxCarryoverDays: string | null;
	carryoverExpiryMonths: number | null;
	creator?: {
		name: string;
	} | null;
}

interface VacationPoliciesTableProps {
	organizationId: string;
}

const getAccrualTypeLabel = (t: ReturnType<typeof useTranslate>["t"], type: string) => {
	const labels: Record<string, string> = {
		annual: t("vacation.accrual-type.annual", "Annual"),
		monthly: t("vacation.accrual-type.monthly", "Monthly"),
		biweekly: t("vacation.accrual-type.biweekly", "Biweekly"),
	};
	return labels[type] || type;
};

const formatDate = (dateStr: string) => {
	const date = new Date(dateStr);
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
};

const isPolicySuperseded = (policy: VacationPolicy) => {
	if (!policy.validUntil) return false;
	const today = new Date().toISOString().split("T")[0];
	return policy.validUntil < today;
};

export function VacationPoliciesTable({ organizationId }: VacationPoliciesTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [policyToDelete, setPolicyToDelete] = useState<VacationPolicy | null>(null);
	const [editingPolicy, setEditingPolicy] = useState<VacationPolicy | null>(null);
	const [createFormOpen, setCreateFormOpen] = useState(false);

	// Fetch policies with React Query
	const {
		data: policies,
		isLoading,
		isFetching,
		isError,
		refetch,
	} = useQuery({
		queryKey: queryKeys.vacationPolicies.list(organizationId),
		queryFn: async () => {
			const result = await getVacationPolicies(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch policies");
			}
			return result.data as VacationPolicy[];
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (policyId: string) => deleteVacationPolicy(policyId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("vacation.policies.deleted", "Policy deleted successfully"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.vacationPolicies.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setPolicyToDelete(null);
			} else {
				toast.error(result.error || t("vacation.policies.deleteFailed", "Failed to delete policy"));
			}
		},
		onError: () => {
			toast.error(t("vacation.policies.deleteFailed", "Failed to delete policy"));
		},
	});

	const handleDeleteClick = (policy: VacationPolicy) => {
		setPolicyToDelete(policy);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (policyToDelete) {
			deleteMutation.mutate(policyToDelete.id);
		}
	};

	const handleEditClick = (policy: VacationPolicy) => {
		setEditingPolicy(policy);
	};

	const handleCreateClick = () => {
		setCreateFormOpen(true);
	};

	const handleFormClose = (open: boolean) => {
		if (!open) {
			setEditingPolicy(null);
			setCreateFormOpen(false);
			queryClient.invalidateQueries({
				queryKey: queryKeys.vacationPolicies.list(organizationId),
			});
		}
	};

	// Filter policies by search (client-side since typically small list)
	const filteredPolicies = useMemo(() => {
		if (!policies) return [];
		if (!search) return policies;

		const searchLower = search.toLowerCase();
		return policies.filter((pol) => pol.name.toLowerCase().includes(searchLower));
	}, [policies, search]);

	// Column definitions
	const columns = useMemo<ColumnDef<VacationPolicy>[]>(
		() => [
			{
				accessorKey: "name",
				header: t("vacation.policies.header.name", "Name"),
				cell: ({ row }) => {
					const isSuperseded = isPolicySuperseded(row.original);
					return (
						<span className={`font-medium ${isSuperseded ? "opacity-60" : ""}`}>
							{row.original.name}
						</span>
					);
				},
			},
			{
				accessorKey: "startDate",
				header: t("vacation.policies.header.start-date", "Start Date"),
				cell: ({ row }) => formatDate(row.original.startDate),
			},
			{
				accessorKey: "validUntil",
				header: t("vacation.policies.header.valid-until", "Valid Until"),
				cell: ({ row }) =>
					row.original.validUntil ? (
						formatDate(row.original.validUntil)
					) : (
						<span className="text-muted-foreground">—</span>
					),
			},
			{
				accessorKey: "defaultAnnualDays",
				header: () => (
					<div className="text-right">{t("vacation.policies.header.annual-days", "Annual Days")}</div>
				),
				cell: ({ row }) => (
					<div className="text-right tabular-nums">{row.original.defaultAnnualDays}</div>
				),
			},
			{
				accessorKey: "accrualType",
				header: t("vacation.policies.header.accrual", "Accrual"),
				cell: ({ row }) => (
					<Badge variant="secondary">{getAccrualTypeLabel(t, row.original.accrualType)}</Badge>
				),
			},
			{
				accessorKey: "allowCarryover",
				header: t("vacation.policies.header.carryover", "Carryover"),
				cell: ({ row }) =>
					row.original.allowCarryover ? (
						<Badge variant="outline">
							{row.original.maxCarryoverDays
								? t("vacation.policies.max-days", "Max {days} days", {
										days: row.original.maxCarryoverDays,
									})
								: t("vacation.policies.unlimited", "Unlimited")}
						</Badge>
					) : (
						<span className="text-muted-foreground text-sm">
							{t("vacation.policies.none", "None")}
						</span>
					),
			},
			{
				accessorKey: "status",
				header: t("vacation.policies.header.status", "Status"),
				cell: ({ row }) => {
					const isSuperseded = isPolicySuperseded(row.original);
					if (row.original.isCompanyDefault) {
						return (
							<Badge className="bg-primary">
								<IconStar className="mr-1 h-3 w-3" />
								{t("vacation.policies.company-default", "Company Default")}
							</Badge>
						);
					}
					if (isSuperseded) {
						return (
							<Badge variant="secondary" className="text-muted-foreground">
								{t("vacation.policies.superseded", "Superseded")}
							</Badge>
						);
					}
					return <Badge variant="outline">{t("vacation.policies.active", "Active")}</Badge>;
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
							<DropdownMenuItem onClick={() => handleEditClick(row.original)}>
								<IconPencil className="mr-2 h-4 w-4" />
								{t("common.edit", "Edit")}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive"
								onClick={() => handleDeleteClick(row.original)}
							>
								<IconTrash className="mr-2 h-4 w-4" />
								{t("common.delete", "Delete")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				),
			},
		],
		[t],
	);

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-end">
					<Button onClick={handleCreateClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("vacation.policies.add-policy", "Add Policy")}
					</Button>
				</div>
				<DataTableSkeleton columnCount={8} rowCount={5} />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
				<p className="text-destructive">
					{t("vacation.policies.loadError", "Failed to load policies")}
				</p>
				<Button className="mt-4" variant="outline" onClick={() => refetch()}>
					<IconRefresh className="mr-2 h-4 w-4" />
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}

	return (
		<>
			<div className="space-y-4">
				<DataTableToolbar
					search={search}
					onSearchChange={setSearch}
					searchPlaceholder={t("vacation.policies.searchPlaceholder", "Search policies...")}
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
							<Button onClick={handleCreateClick}>
								<IconPlus className="mr-2 h-4 w-4" />
								{t("vacation.policies.add-policy", "Add Policy")}
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
							? t("vacation.policies.noSearchResults", "No policies match your search.")
							: t(
									"vacation.policies.no-policies-created",
									"No vacation policies created yet. Create a policy to define vacation allowances for your team.",
								)
					}
				/>
			</div>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("vacation.policies.delete-title", "Delete Vacation Policy")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{policyToDelete?.isCompanyDefault
								? t(
										"vacation.policies.delete-default-warning",
										'Warning: "{name}" is the company default policy. You must set another policy as default before deleting this one.',
										{ name: policyToDelete?.name },
									)
								: t(
										"vacation.policies.delete-description-v2",
										'Are you sure you want to delete "{name}"? This will also remove all assignments for this policy.',
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

			{editingPolicy && (
				<VacationPolicyForm
					open={!!editingPolicy}
					onOpenChange={handleFormClose}
					organizationId={organizationId}
					existingPolicy={editingPolicy}
				/>
			)}

			{createFormOpen && (
				<VacationPolicyForm
					open={createFormOpen}
					onOpenChange={handleFormClose}
					organizationId={organizationId}
				/>
			)}
		</>
	);
}
