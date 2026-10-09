"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { AccountingConnectionCard } from "@/components/billable-time/accounting/accounting-connection-card";
import { CustomerAccountingPanel } from "@/components/billable-time/accounting/customer-accounting-panel";
import { useTaxTreatmentSummary } from "@/components/billable-time/accounting/tax-treatment-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { type AccountingSettings, getAccountingSettings } from "./actions";

/** The accounting settings page (#903): the connection and every customer's accounting side. */
export function AccountingSettingsView() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const summary = useTaxTreatmentSummary();
	const queryKey = queryKeys.billableTime.accountingSettings();
	const [selected, setSelected] = useState<{ customerId: string; name: string } | null>(null);

	const settings = useQuery({
		queryKey,
		queryFn: async (): Promise<AccountingSettings> => {
			const result = await getAccountingSettings();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.billableTime.all });
	};

	if (settings.isPending) {
		return (
			<div className="flex justify-center p-6">
				<IconLoader2
					aria-label={t("common.loading", "Loading")}
					className="size-6 animate-spin text-muted-foreground"
				/>
			</div>
		);
	}
	if (settings.isError) {
		return (
			<p className="text-sm text-destructive" role="alert">
				{settings.error.message}
			</p>
		);
	}

	const { connection, customers } = settings.data;

	return (
		<div className="space-y-6">
			<AccountingConnectionCard settings={settings.data} onChanged={refresh} />

			<Card>
				<CardHeader>
					<CardTitle>
						{t("settings.billableTime.accounting.customers.title", "Customers")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.billableTime.accounting.customers.description",
							"Link each customer to its existing contact in the accounting tool before its first hand-off, and override the tax treatment where needed.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{customers.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("settings.billableTime.accounting.customers.empty", "No customers yet")}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>
										{t("settings.billableTime.accounting.customers.customer", "Customer")}
									</TableHead>
									<TableHead>
										{t("settings.billableTime.accounting.customers.contact", "Contact")}
									</TableHead>
									<TableHead>
										{t("settings.billableTime.accounting.customers.tax", "Tax treatment")}
									</TableHead>
									<TableHead className="sr-only">
										{t("settings.billableTime.accounting.customers.actions", "Actions")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{customers.map((entry) => (
									<TableRow key={entry.customerId}>
										<TableCell className="font-medium">
											<div className="flex flex-wrap items-center gap-2">
												{entry.name}
												{!entry.isActive && (
													<Badge variant="secondary">
														{t("settings.billableTime.accounting.customers.inactive", "Inactive")}
													</Badge>
												)}
											</div>
										</TableCell>
										<TableCell>
											{entry.contactLink ? (
												<div>
													<div>{entry.contactLink.contactName}</div>
													{entry.contactLink.contactNumber && (
														<div className="text-xs text-muted-foreground">
															{entry.contactLink.contactNumber}
														</div>
													)}
												</div>
											) : (
												<span className="text-muted-foreground">
													{t("settings.billableTime.accounting.customers.notLinked", "Not linked")}
												</span>
											)}
										</TableCell>
										<TableCell>
											{entry.taxOverride ? (
												summary(entry.taxOverride)
											) : connection ? (
												<span className="text-muted-foreground">
													{t(
														"settings.billableTime.accounting.customers.defaultTax",
														"Default: {treatment}",
														{ treatment: summary(connection.defaultTaxTreatment) },
													)}
												</span>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell className="text-right">
											<Button
												size="sm"
												variant="outline"
												onClick={() =>
													setSelected({ customerId: entry.customerId, name: entry.name })
												}
											>
												{t("settings.billableTime.accounting.customers.edit", "Edit")}
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<CustomerAccountingPanel
				open={selected !== null}
				onOpenChange={(open) => {
					if (!open) setSelected(null);
				}}
				customerId={selected?.customerId ?? null}
				customerName={selected?.name ?? ""}
				onChanged={() =>
					void queryClient.invalidateQueries({
						queryKey: queryKeys.billableTime.accountingSettings(),
					})
				}
			/>
		</div>
	);
}
