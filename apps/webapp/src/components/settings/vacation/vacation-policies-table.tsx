"use client";

import {
	IconDots,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconStar,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteVacationPolicy,
	getVacationPolicies,
} from "@/app/[locale]/(app)/settings/vacation/actions";
import { DataTable, DataTableSkeleton, DataTableToolbar } from "@/components/data-table-server";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
import { useAppLocale } from "@/components/providers/app-locale-provider";
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
import {
	actionErrorMessage,
	type RefusalOverrides,
} from "@/lib/organization-action/action-error-message";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { queryKeys } from "@/lib/query";
import { useVacationPolicyHistoryContext } from "./use-vacation-policy-history-context";
import { VacationPolicyForm } from "./vacation-policy-form";
import { isPolicySuperseded, organizationToday } from "./vacation-policy-status";

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
	prorateInStartAndExitYear: boolean;
	statutoryMinimumDays: string;
	creator?: {
		name: string;
	} | null;
}

/** A delete refused because the policy is the only company default. */
const DELETE_REFUSALS: RefusalOverrides = {
	ConflictError: [
		"vacation.policies.deleteLastDefault",
		"This is the only company default policy. Set another policy as default first.",
	],
};

interface VacationPoliciesTableProps {
	organizationId: string;
	canManagePolicies?: boolean;
}

const getAccrualTypeLabel = (t: ReturnType<typeof useTranslate>["t"], type: string) => {
	const labels: Record<string, string> = {
		annual: t("vacation.accrual-type.annual", "Annual"),
		monthly: t("vacation.accrual-type.monthly", "Monthly"),
		biweekly: t("vacation.accrual-type.biweekly", "Biweekly"),
	};
	return labels[type] || type;
};

/**
 * A policy's calendar day (YYYY-MM-DD) in the reader's locale. A plain date never passes through
 * an instant, so it shows the stored day in every timezone.
 */
const formatDate = (dateStr: string, locale: string) => {
	try {
		return formatPlainDate(parsePlainDate(dateStr), locale, "dateMedium");
	} catch {
		return dateStr;
	}
};

// eslint-disable-next-line react-doctor/no-giant-component, react-doctor/prefer-useReducer
export function VacationPoliciesTable({
	organizationId,
	canManagePolicies = true,
}: VacationPoliciesTableProps) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [policyToDelete, setPolicyToDelete] = useState<VacationPolicy | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [editingPolicy, setEditingPolicy] = useState<VacationPolicy | null>(null);
	const [createFormOpen, setCreateFormOpen] = useState(false);
	// "Superseded" compares against the organization's calendar day (its timezone), not the
	// viewer's or UTC's day; until the timezone is known no policy is marked superseded.
	const historyContext = useVacationPolicyHistoryContext(organizationId);
	const today = organizationToday(historyContext.data?.timezone);

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
			const result = await getVacationPolicies();
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
			} else {
				// The dialog stays open with the reason so the deletion can be retried.
				setDeleteError(
					actionErrorMessage(t, result, DELETE_REFUSALS, [
						"vacation.policies.deleteFailed",
						"Failed to delete policy",
					]),
				);
			}
		},
		onError: () => {
			setDeleteError(t("vacation.policies.deleteFailed", "Failed to delete policy"));
		},
	});

	const handleDeleteClick = (policy: VacationPolicy) => {
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
	const filteredPolicies = (() => {
		if (!policies) return [];
		if (!search) return policies;

		const searchLower = search.toLowerCase();
		return policies.filter((pol) => pol.name.toLowerCase().includes(searchLower));
	})();

	// Column definitions
	const columns: ColumnDef<DataTableFeatures, VacationPolicy>[] = [
		{
			accessorKey: "name",
			header: t("vacation.policies.header.name", "Name"),
			cell: ({ row }) => {
				const isSuperseded = isPolicySuperseded(row.original.validUntil, today);
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
			cell: ({ row }) => (
				<span className="tabular-nums whitespace-nowrap">
					{formatDate(row.original.startDate, locale)}
				</span>
			),
		},
		{
			accessorKey: "validUntil",
			header: t("vacation.policies.header.valid-until", "Valid Until"),
			cell: ({ row }) =>
				row.original.validUntil ? (
					<span className="tabular-nums whitespace-nowrap">
						{formatDate(row.original.validUntil, locale)}
					</span>
				) : (
					<span className="text-muted-foreground">
						{t("vacation.policies.no-end-date", "No end date")}
					</span>
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
				const isSuperseded = isPolicySuperseded(row.original.validUntil, today);
				if (row.original.isCompanyDefault) {
					return (
						<Badge className="bg-primary">
							<IconStar className="mr-1 size-3" />
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
		...(canManagePolicies
			? [
					{
						id: "actions",
						cell: ({ row }: { row: { original: VacationPolicy } }) => (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="size-8"
										aria-label={`${t("common.openMenu", "Open menu")}: ${row.original.name}`}
									>
										<IconDots aria-hidden="true" className="size-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => handleEditClick(row.original)}>
										<IconPencil className="mr-2 size-4" />
										{t("common.edit", "Edit")}
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										className="text-destructive"
										onClick={() => handleDeleteClick(row.original)}
									>
										<IconTrash className="mr-2 size-4" />
										{t("common.delete", "Delete")}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						),
					},
				]
			: []),
	];

	if (isLoading) {
		return (
			<div className="space-y-4">
				{canManagePolicies ? (
					<div className="flex justify-end">
						<Button onClick={handleCreateClick}>
							<IconPlus className="mr-2 size-4" />
							{t("vacation.policies.add-policy", "Add Policy")}
						</Button>
					</div>
				) : null}
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
					<IconRefresh className="mr-2 size-4" />
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
						canManagePolicies ? (
							<Button onClick={handleCreateClick}>
								<IconPlus className="mr-2 size-4" />
								{t("vacation.policies.add-policy", "Add Policy")}
							</Button>
						) : undefined
					}
				/>

				<DataTable
					mobileLayout="stacked"
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

			<DeleteConfirmDialog
				open={deleteDialogOpen}
				onOpenChange={(open) => {
					setDeleteDialogOpen(open);
					if (!open) setDeleteError(null);
				}}
				title={t("vacation.policies.delete-title", "Delete Vacation Policy")}
				description={
					policyToDelete?.isCompanyDefault
						? t(
								"vacation.policies.delete-default-warning",
								'Warning: "{name}" is the company default policy. You must set another policy as default before deleting this one.',
								{ name: policyToDelete?.name },
							)
						: t(
								"vacation.policies.delete-description-v2",
								'Are you sure you want to delete "{name}"? This will also remove all assignments for this policy.',
								{ name: policyToDelete?.name },
							)
				}
				isDeleting={deleteMutation.isPending}
				error={deleteError}
				onConfirm={handleDeleteConfirm}
			/>

			{canManagePolicies && editingPolicy && (
				<VacationPolicyForm
					open={!!editingPolicy}
					onOpenChange={handleFormClose}
					organizationId={organizationId}
					existingPolicy={editingPolicy}
				/>
			)}

			{canManagePolicies && createFormOpen && (
				<VacationPolicyForm
					open={createFormOpen}
					onOpenChange={handleFormClose}
					organizationId={organizationId}
				/>
			)}
		</>
	);
}
