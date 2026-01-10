"use client";

import {
	IconChevronLeft,
	IconChevronRight,
	IconDots,
	IconLoader2,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
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
	year: number;
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

const accrualTypeLabels: Record<string, string> = {
	annual: "Annual",
	monthly: "Monthly",
	biweekly: "Biweekly",
};

export function VacationPoliciesTable({
	organizationId,
	initialPolicies,
}: VacationPoliciesTableProps) {
	const currentYear = new Date().getFullYear();
	const [selectedYear, setSelectedYear] = useState<number>(currentYear);
	const [policies, setPolicies] = useState<VacationPolicy[]>(initialPolicies);
	const [loading, setLoading] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [policyToDelete, setPolicyToDelete] = useState<VacationPolicy | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [editingPolicy, setEditingPolicy] = useState<VacationPolicy | null>(null);
	const [createFormOpen, setCreateFormOpen] = useState(false);
	const [createYear, setCreateYear] = useState<number>(currentYear);

	const fetchPolicies = useCallback(async () => {
		setLoading(true);
		try {
			const result = await getVacationPolicies(organizationId, selectedYear);
			if (result.success && result.data) {
				setPolicies(result.data);
			} else {
				toast.error(result.error || "Failed to load policies");
			}
		} catch {
			toast.error("Failed to load policies");
		} finally {
			setLoading(false);
		}
	}, [organizationId, selectedYear]);

	useEffect(() => {
		fetchPolicies();
	}, [fetchPolicies]);

	const goToPreviousYear = () => {
		setSelectedYear((prev) => prev - 1);
	};

	const goToNextYear = () => {
		setSelectedYear((prev) => prev + 1);
	};

	const goToCurrentYear = () => {
		setSelectedYear(currentYear);
	};

	const isCurrentYear = selectedYear === currentYear;

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
		setCreateYear(selectedYear);
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
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" onClick={goToPreviousYear}>
						<IconChevronLeft className="h-4 w-4" />
						<span className="sr-only">Previous year</span>
					</Button>
					<span className="min-w-[80px] text-center font-medium tabular-nums">{selectedYear}</span>
					<Button variant="outline" size="icon" onClick={goToNextYear}>
						<IconChevronRight className="h-4 w-4" />
						<span className="sr-only">Next year</span>
					</Button>
					{!isCurrentYear && (
						<Button variant="ghost" size="sm" onClick={goToCurrentYear}>
							Current Year
						</Button>
					)}
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={handleRefresh} disabled={loading}>
						<IconRefresh className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
						<span className="sr-only">Refresh</span>
					</Button>
					<Button onClick={handleCreateClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						Add Policy
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
					<p className="text-muted-foreground">No vacation policies for {selectedYear}</p>
					<p className="text-muted-foreground text-sm mt-1">
						Create a policy to define vacation allowances for your team.
					</p>
					<Button className="mt-4" onClick={handleCreateClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						Create Policy
					</Button>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Year</TableHead>
								<TableHead className="text-right">Annual Days</TableHead>
								<TableHead>Accrual</TableHead>
								<TableHead>Carryover</TableHead>
								<TableHead className="w-[70px]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{policies.map((policy) => (
								<TableRow key={policy.id}>
									<TableCell className="font-medium">{policy.name}</TableCell>
									<TableCell>
										<Badge variant="outline">{policy.year}</Badge>
									</TableCell>
									<TableCell className="text-right">{policy.defaultAnnualDays}</TableCell>
									<TableCell>
										<Badge variant="secondary">
											{accrualTypeLabels[policy.accrualType] || policy.accrualType}
										</Badge>
									</TableCell>
									<TableCell>
										{policy.allowCarryover ? (
											<Badge variant="outline">
												{policy.maxCarryoverDays
													? `Max ${policy.maxCarryoverDays} days`
													: "Unlimited"}
											</Badge>
										) : (
											<span className="text-muted-foreground text-sm">None</span>
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
													Edit
												</DropdownMenuItem>
												<DropdownMenuItem
													className="text-destructive"
													onClick={() => handleDeleteClick(policy)}
												>
													<IconTrash className="mr-2 h-4 w-4" />
													Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Vacation Policy</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete "{policyToDelete?.name}" ({policyToDelete?.year})?
							This will also remove all assignments for this policy. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleting}
						>
							{deleting && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{editingPolicy && (
				<VacationPolicyForm
					open={!!editingPolicy}
					onOpenChange={handleFormClose}
					organizationId={organizationId}
					year={editingPolicy.year}
					existingPolicy={editingPolicy}
				/>
			)}

			{createFormOpen && (
				<VacationPolicyForm
					open={createFormOpen}
					onOpenChange={handleFormClose}
					organizationId={organizationId}
					year={createYear}
				/>
			)}
		</div>
	);
}
