"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { getTravelExpensePolicies } from "@/app/[locale]/(app)/settings/travel-expenses/actions";
import { formatMoney, formatPlainDate } from "@/components/travel-expenses/report/format";
import { formatRatePerKm } from "@/components/travel-expenses/report/mileage-labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query/keys";

/**
 * Earlier travel expense policy records (read-only since #606). They were
 * never applied by a calculation; dated mileage rates are managed in the
 * mileage rates card. Shown only when an organization has such records.
 */
export function TravelExpensePolicyManagement() {
	const { t } = useTranslate();
	const locale = useLocale();
	const { data } = useQuery({
		queryKey: queryKeys.travelExpenses.legacyPolicies(),
		queryFn: async () => {
			const result = await getTravelExpensePolicies();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	if (!data || data.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.travelExpenses.legacy.title", "Earlier policy records")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.legacy.description",
						"Kept for reference only. These records were never used to calculate expenses and can no longer be edited; set up dated mileage rates above.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="overflow-x-auto">
				<Table>
					{/* Incidental: unrelated audit/export tables merely share a 4-column header. */}
					{/* react-doctor-disable-next-line react-doctor/duplicate-jsx-subtree */}
					<TableHeader>
						<TableRow>
							<TableHead>{t("settings.travelExpenses.effectiveFrom", "Effective From")}</TableHead>
							<TableHead>{t("settings.travelExpenses.effectiveTo", "Effective To")}</TableHead>
							<TableHead>{t("settings.travelExpenses.mileageRate", "Mileage / km")}</TableHead>
							<TableHead>{t("settings.travelExpenses.perDiemRate", "Per diem / day")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.map((policy) => (
							<TableRow key={policy.id}>
								<TableCell>{formatPlainDate(locale, policy.effectiveFrom)}</TableCell>
								<TableCell>
									{policy.effectiveTo ? formatPlainDate(locale, policy.effectiveTo) : "–"}
								</TableCell>
								<TableCell className="tabular-nums">
									{policy.mileageRatePerKm
										? formatRatePerKm(locale, policy.mileageRatePerKm, policy.currency)
										: "–"}
								</TableCell>
								<TableCell className="tabular-nums">
									{policy.perDiemRatePerDay
										? formatMoney(locale, policy.perDiemRatePerDay, policy.currency)
										: "–"}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
