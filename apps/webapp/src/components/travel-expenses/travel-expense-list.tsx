"use client";

import { useTranslate } from "@tolgee/react";
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
import { LegacyClaimActions } from "./legacy-draft-conversion";
import { TravelExpenseDateRange } from "./travel-expense-date-range";

interface TravelExpenseListItem {
	id: string;
	type: "receipt" | "mileage" | "per_diem";
	status: string;
	calculatedAmount: string;
	calculatedCurrency: string;
	tripStartDate?: string | null;
	tripEndDate?: string | null;
	/** The report a legacy draft was continued as (#616). */
	convertedReportId?: string | null;
}

interface TravelExpenseListProps {
	claims: TravelExpenseListItem[];
	isLoading?: boolean;
}

function prettify(value: string): string {
	return value
		.replaceAll("_", " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function TravelExpenseList({
	claims,
	isLoading = false,
}: TravelExpenseListProps) {
	const { t } = useTranslate();

	if (isLoading) {
		return (
			<Card>
				<CardContent className="space-y-3 p-6">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</CardContent>
			</Card>
		);
	}

	if (claims.length === 0) {
		return (
			<Card>
				<CardContent className="py-12 text-center">
					<p className="text-lg font-medium">
						{t(
							"travelExpenses.list.emptyTitle",
							"No travel expense claims yet",
						)}
					</p>
					<p className="mt-2 text-sm text-muted-foreground">
						{t(
							"travelExpenses.list.emptyDescription",
							"Create your first claim to start the approval process.",
						)}
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardContent className="p-0">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("travelExpenses.list.type", "Type")}</TableHead>
							<TableHead>{t("travelExpenses.list.status", "Status")}</TableHead>
							<TableHead>{t("travelExpenses.list.amount", "Amount")}</TableHead>
							<TableHead>
								{t("travelExpenses.list.dateRange", "Date Range")}
							</TableHead>
							<TableHead>
								<span className="sr-only">
									{t("travelExpenses.list.actions", "Actions")}
								</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{claims.map((claim) => (
							<TableRow key={claim.id}>
								<TableCell>
									{t(
										`travelExpenses.claimTypes.${claim.type}`,
										prettify(claim.type),
									)}
								</TableCell>
								<TableCell>
									{claim.convertedReportId
										? t("travelExpenses.legacyDraft.status", "Continued as report")
										: t(
												`travelExpenses.status.${claim.status}`,
												prettify(claim.status),
											)}
								</TableCell>
								<TableCell>
									{claim.calculatedAmount} {claim.calculatedCurrency}
								</TableCell>
								<TableCell>
									<TravelExpenseDateRange
										startDate={claim.tripStartDate}
										endDate={claim.tripEndDate}
									/>
								</TableCell>
								<TableCell>
									<LegacyClaimActions claim={claim} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
