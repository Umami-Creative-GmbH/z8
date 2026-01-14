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
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	deleteVacationPolicy,
	getVacationPolicies,
} from "@/app/[locale]/(app)/settings/vacation/actions";
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
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
	initialPolicies: VacationPolicy[];
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

export function VacationPoliciesTable({
	organizationId,
	initialPolicies,
}: VacationPoliciesTableProps) {
	const { t } = useTranslate();
	const [policies, setPolicies] = useState<VacationPolicy[]>(initialPolicies);
	const [loading, setLoading] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [policyToDelete, setPolicyToDelete] = useState<VacationPolicy | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [editingPolicy, setEditingPolicy] = useState<VacationPolicy | null>(null);
	const [createFormOpen, setCreateFormOpen] = useState(false);

	const fetchPolicies = useCallback(async () => {
		setLoading(true);
		try {
			const result = await getVacationPolicies(organizationId);
			if (result.success) {
				setPolicies(result.data as VacationPolicy[]);
			} else {
				toast.error(result.error || "Failed to load policies");
			}
		} catch {
			toast.error("Failed to load policies");
		} finally {
			setLoading(false);
		}
	}, [organizationId]);

	useEffect(() => {
		fetchPolicies();
	}, [fetchPolicies]);

	const handleRefresh = () => {
		fetchPolicies();
	};

	const handleDeleteClick = (policy: VacationPolicy) => {
		setPolicyToDelete(policy);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = async () => {
		if (!policyToDelete) return;

		setDeleting(true);
		try {
			const result = await deleteVacationPolicy(policyToDelete.id);
			if (result.success) {
				toast.success("Policy deleted successfully");
				fetchPolicies();
			} else {
				toast.error(result.error || "Failed to delete policy");
			}
		} catch {
			toast.error("Failed to delete policy");
		} finally {
			setDeleting(false);
			setDeleteDialogOpen(false);
			setPolicyToDelete(null);
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
			fetchPolicies();
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-4">
				<div className="text-sm text-muted-foreground">
					{t(
						"vacation.policies.list-description",
						"Manage vacation policies for your organization",
					)}
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={handleRefresh} disabled={loading}>
						<IconRefresh className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
						<span className="sr-only">Refresh</span>
					</Button>
					<Button onClick={handleCreateClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("vacation.policies.add-policy", "Add Policy")}
					</Button>
				</div>
			</div>

			{loading ? (
				<div className="space-y-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : policies.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
					<p className="text-muted-foreground">
						{t("vacation.policies.no-policies-created", "No vacation policies created yet")}
					</p>
					<p className="text-muted-foreground text-sm mt-1">
						{t(
							"vacation.policies.create-first",
							"Create a policy to define vacation allowances for your team.",
						)}
					</p>
					<Button className="mt-4" onClick={handleCreateClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("vacation.policies.create-policy", "Create Policy")}
					</Button>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("vacation.policies.header.name", "Name")}</TableHead>
								<TableHead>{t("vacation.policies.header.start-date", "Start Date")}</TableHead>
								<TableHead>{t("vacation.policies.header.valid-until", "Valid Until")}</TableHead>
								<TableHead className="text-right">
									{t("vacation.policies.header.annual-days", "Annual Days")}
								</TableHead>
								<TableHead>{t("vacation.policies.header.accrual", "Accrual")}</TableHead>
								<TableHead>{t("vacation.policies.header.carryover", "Carryover")}</TableHead>
								<TableHead>{t("vacation.policies.header.status", "Status")}</TableHead>
								<TableHead className="w-[70px]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{policies.map((policy) => {
								const isSuperseded = isPolicySuperseded(policy);
								return (
									<TableRow key={policy.id} className={isSuperseded ? "opacity-60" : ""}>
										<TableCell className="font-medium">{policy.name}</TableCell>
										<TableCell>{formatDate(policy.startDate)}</TableCell>
										<TableCell>
											{policy.validUntil ? (
												formatDate(policy.validUntil)
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>
										<TableCell className="text-right">{policy.defaultAnnualDays}</TableCell>
										<TableCell>
											<Badge variant="secondary">
												{getAccrualTypeLabel(t, policy.accrualType)}
											</Badge>
										</TableCell>
										<TableCell>
											{policy.allowCarryover ? (
												<Badge variant="outline">
													{policy.maxCarryoverDays
														? t("vacation.policies.max-days", "Max {{days}} days", {
																days: policy.maxCarryoverDays,
															})
														: t("vacation.policies.unlimited", "Unlimited")}
												</Badge>
											) : (
												<span className="text-muted-foreground text-sm">
													{t("vacation.policies.none", "None")}
												</span>
											)}
										</TableCell>
										<TableCell>
											{policy.isCompanyDefault ? (
												<Badge className="bg-primary">
													<IconStar className="mr-1 h-3 w-3" />
													{t("vacation.policies.company-default", "Company Default")}
												</Badge>
											) : isSuperseded ? (
												<Badge variant="secondary" className="text-muted-foreground">
													{t("vacation.policies.superseded", "Superseded")}
												</Badge>
											) : (
												<Badge variant="outline">{t("vacation.policies.active", "Active")}</Badge>
											)}
										</TableCell>
										<TableCell>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" size="icon" className="h-8 w-8">
														<IconDots className="h-4 w-4" />
														<span className="sr-only">Open menu</span>
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem onClick={() => handleEditClick(policy)}>
														<IconPencil className="mr-2 h-4 w-4" />
														{t("common.edit", "Edit")}
													</DropdownMenuItem>
													<DropdownMenuItem
														className="text-destructive"
														onClick={() => handleDeleteClick(policy)}
													>
														<IconTrash className="mr-2 h-4 w-4" />
														{t("common.delete", "Delete")}
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}

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
										'Warning: "{{name}}" is the company default policy. You must set another policy as default before deleting this one.',
										{ name: policyToDelete?.name },
									)
								: t(
										"vacation.policies.delete-description-v2",
										'Are you sure you want to delete "{{name}}"? This will also remove all assignments for this policy.',
										{ name: policyToDelete?.name },
									)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleting}
						>
							{deleting && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
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
		</div>
	);
}
