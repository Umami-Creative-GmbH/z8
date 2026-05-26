"use client";

import { useTranslate } from "@tolgee/react";
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

const mediumDateFormatters = new Map<string, Intl.DateTimeFormat>();

function getMediumDateFormatter(locale: string) {
	const cachedFormatter = mediumDateFormatters.get(locale);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
	mediumDateFormatters.set(locale, formatter);
	return formatter;
}

function formatDateRange(start: string | Date, end: string | Date, locale: string): string {
	const startDateTime =
		typeof start === "string" ? DateTime.fromISO(start) : DateTime.fromJSDate(start);
	const endDateTime = typeof end === "string" ? DateTime.fromISO(end) : DateTime.fromJSDate(end);

	if (!startDateTime.isValid || !endDateTime.isValid) {
		return "-";
	}

	const formatter = getMediumDateFormatter(locale);
	return `${formatter.format(startDateTime.toJSDate())} - ${formatter.format(endDateTime.toJSDate())}`;
}

function prettify(value: string): string {
	return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function TravelExpenseList({ claims, isLoading = false }: TravelExpenseListProps) {
	const locale = useLocale();
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
						{t("travelExpenses.list.emptyTitle", "No travel expense claims yet")}
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
							<TableHead>{t("travelExpenses.list.dateRange", "Date Range")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{claims.map((claim) => (
							<TableRow key={claim.id}>
								<TableCell>
									{t(`travelExpenses.claimTypes.${claim.type}`, prettify(claim.type))}
								</TableCell>
								<TableCell>
									{t(`travelExpenses.status.${claim.status}`, prettify(claim.status))}
								</TableCell>
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
