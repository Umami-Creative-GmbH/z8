"use client";

import { DateTime } from "luxon";
import { useLocale } from "next-intl";
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

interface TravelExpenseListItem {
	id: string;
	type: "receipt" | "mileage" | "per_diem";
	status: string;
	calculatedAmount: string;
	calculatedCurrency: string;
	tripStart: string | Date;
	tripEnd: string | Date;
}

interface TravelExpenseListProps {
	claims: TravelExpenseListItem[];
	isLoading?: boolean;
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

function prettify(value: string): string {
	return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function TravelExpenseList({ claims, isLoading = false }: TravelExpenseListProps) {
	const locale = useLocale();

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
					<p className="text-lg font-medium">No travel expense claims yet</p>
					<p className="mt-2 text-sm text-muted-foreground">
						Create your first claim to start the approval process.
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
							<TableHead>Type</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Amount</TableHead>
							<TableHead>Date Range</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{claims.map((claim) => (
							<TableRow key={claim.id}>
								<TableCell>{prettify(claim.type)}</TableCell>
								<TableCell>{prettify(claim.status)}</TableCell>
								<TableCell>
									{claim.calculatedAmount} {claim.calculatedCurrency}
								</TableCell>
								<TableCell>{formatDateRange(claim.tripStart, claim.tripEnd, locale)}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
