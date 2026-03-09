"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useLocale } from "next-intl";
import { useMemo, useState } from "react";
import { getTravelExpenseApprovalQueue } from "@/app/[locale]/(app)/travel-expenses/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query/keys";
import { TravelExpenseDecisionDialog } from "./travel-expense-decision-dialog";

type AppRole = "admin" | "manager" | "employee";

interface TravelExpenseApprovalQueueProps {
	currentEmployeeId: string;
	currentRole: AppRole;
}

interface TravelExpenseApprovalQueueItem {
	id: string;
	type: "receipt" | "mileage" | "per_diem";
	status: string;
	approverId: string | null;
	employeeId: string;
	calculatedAmount: string;
	calculatedCurrency: string;
	tripStart: string | Date;
	tripEnd: string | Date;
	submittedAt: string | Date | null;
}

type DecisionAction = "approve" | "reject";

export function canDecideClaim(role: AppRole, approverId: string | null, currentEmployeeId: string): boolean {
	if (role === "admin") {
		return true;
	}

	if (role === "manager") {
		return approverId === currentEmployeeId;
	}

	return false;
}

function prettify(value: string): string {
	return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: string | Date | null, locale: string): string {
	if (!value) {
		return "-";
	}

	const dateTime = typeof value === "string" ? DateTime.fromISO(value) : DateTime.fromJSDate(value);
	if (!dateTime.isValid) {
		return "-";
	}

	return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(dateTime.toJSDate());
}

function formatDateRange(start: string | Date, end: string | Date, locale: string): string {
	const startDateTime = typeof start === "string" ? DateTime.fromISO(start) : DateTime.fromJSDate(start);
	const endDateTime = typeof end === "string" ? DateTime.fromISO(end) : DateTime.fromJSDate(end);

	if (!startDateTime.isValid || !endDateTime.isValid) {
		return "-";
	}

	const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
	return `${formatter.format(startDateTime.toJSDate())} - ${formatter.format(endDateTime.toJSDate())}`;
}

export function TravelExpenseApprovalQueue({
	currentEmployeeId,
	currentRole,
}: TravelExpenseApprovalQueueProps) {
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
	const [dialogAction, setDialogAction] = useState<DecisionAction>("approve");
	const [dialogOpen, setDialogOpen] = useState(false);

	const { data, isLoading, isFetching } = useQuery({
		queryKey: queryKeys.travelExpenses.approvals(),
		queryFn: async () => {
			const result = await getTravelExpenseApprovalQueue();
			if (!result.success) {
				throw new Error(result.error || "Failed to load travel expense approval queue");
			}
			return result.data as TravelExpenseApprovalQueueItem[];
		},
	});

	const claims = useMemo(() => data ?? [], [data]);

	const openDecisionDialog = (claimId: string, action: DecisionAction) => {
		setSelectedClaimId(claimId);
		setDialogAction(action);
		setDialogOpen(true);
	};

	const handleActioned = async (claimId: string) => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.approvals() }),
			queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.list() }),
			queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.detail(claimId) }),
		]);
		setDialogOpen(false);
		setSelectedClaimId(null);
	};

	if (isLoading || isFetching) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
				<div className="px-4 lg:px-6">
					<Skeleton className="h-8 w-72" />
					<Skeleton className="mt-2 h-4 w-96" />
				</div>
				<div className="px-4 lg:px-6">
					<Card>
						<CardContent className="space-y-3 p-6">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="flex items-center justify-between px-4 lg:px-6">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Travel Expense Approvals</h1>
					<p className="text-sm text-muted-foreground">
						Review submitted travel expense claims and record your decision.
					</p>
				</div>
			</div>

			<div className="px-4 lg:px-6">
				{claims.length === 0 ? (
					<Card>
						<CardContent className="py-12 text-center">
							<p className="text-lg font-medium">No claims pending approval</p>
							<p className="mt-2 text-sm text-muted-foreground">
								Submitted claims assigned to you will appear here.
							</p>
						</CardContent>
					</Card>
				) : (
					<Card>
						<CardContent className="p-0">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Type</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>Date Range</TableHead>
										<TableHead>Submitted</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{claims.map((claim) => {
										const canDecide = canDecideClaim(
											currentRole,
											claim.approverId,
											currentEmployeeId,
										);

										return (
											<TableRow key={claim.id}>
												<TableCell>{prettify(claim.type)}</TableCell>
												<TableCell>
													{claim.calculatedAmount} {claim.calculatedCurrency}
												</TableCell>
												<TableCell>{formatDateRange(claim.tripStart, claim.tripEnd, locale)}</TableCell>
												<TableCell>{formatDate(claim.submittedAt, locale)}</TableCell>
												<TableCell>
													<Badge variant="secondary">{prettify(claim.status)}</Badge>
												</TableCell>
												<TableCell>
													<div className="flex justify-end gap-2">
														<Button
															size="sm"
															onClick={() => openDecisionDialog(claim.id, "approve")}
															disabled={!canDecide}
														>
															Approve
														</Button>
														<Button
															size="sm"
															variant="destructive"
															onClick={() => openDecisionDialog(claim.id, "reject")}
															disabled={!canDecide}
														>
															Reject
														</Button>
													</div>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				)}
			</div>

			<TravelExpenseDecisionDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				action={dialogAction}
				claimId={selectedClaimId}
				onActioned={handleActioned}
			/>
		</div>
	);
}
