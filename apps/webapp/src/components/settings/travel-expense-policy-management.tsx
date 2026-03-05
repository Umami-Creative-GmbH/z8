"use client";

import { IconPencil, IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import {
	getTravelExpensePolicies,
	type TravelExpensePolicyData,
} from "@/app/[locale]/(app)/settings/travel-expenses/actions";
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
import { queryKeys } from "@/lib/query";
import { TravelExpensePolicyDialog } from "./travel-expense-policy-dialog";

interface TravelExpensePolicyManagementProps {
	organizationId: string;
}

export const travelExpensePolicyQueryKey = (organizationId: string) =>
	["travel-expense-policies", organizationId] as const;

function toDateTime(value: Date | string | null): DateTime | null {
	if (!value) {
		return null;
	}

	if (value instanceof Date) {
		const dt = DateTime.fromJSDate(value);
		return dt.isValid ? dt : null;
	}

	const dt = DateTime.fromISO(value);
	return dt.isValid ? dt : null;
}

function formatDate(value: Date | string | null): string {
	const date = toDateTime(value);
	return date ? date.toFormat("yyyy-LL-dd") : "-";
}

function formatRate(value: string | null, currency: string): string {
	if (value === null) {
		return "-";
	}

	const amount = Number(value);
	if (!Number.isFinite(amount)) {
		return "-";
	}

	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount);
}

export function TravelExpensePolicyManagement({ organizationId }: TravelExpensePolicyManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingPolicy, setEditingPolicy] = useState<TravelExpensePolicyData | null>(null);

	const policyQueryKey = useMemo(() => travelExpensePolicyQueryKey(organizationId), [organizationId]);

	const { data, isLoading } = useQuery({
		queryKey: policyQueryKey,
		queryFn: async () => {
			const result = await getTravelExpensePolicies();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch travel expense policies");
			}
			return result.data;
		},
	});

	const policies = data || [];

	const handleCreate = () => {
		setEditingPolicy(null);
		setDialogOpen(true);
	};

	const handleEdit = (policy: TravelExpensePolicyData) => {
		setEditingPolicy(policy);
		setDialogOpen(true);
	};

	const handleSuccess = async () => {
		await queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.list() });
		await queryClient.invalidateQueries({ queryKey: policyQueryKey });
		setDialogOpen(false);
		setEditingPolicy(null);
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.travelExpenses.title", "Travel Expense Policies")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.travelExpenses.description",
						"Configure reimbursement rates and effective periods for mileage and per diem claims.",
					)}
				</p>
			</div>

			<div className="flex justify-end">
				<Button onClick={handleCreate}>
					<IconPlus className="mr-2 h-4 w-4" />
					{t("settings.travelExpenses.addPolicy", "Add Policy")}
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t("settings.travelExpenses.policies", "Policies")}</CardTitle>
					<CardDescription>
						{t(
							"settings.travelExpenses.policiesDescription",
							"Only one policy should be active at a time. Active policy is used for new claims.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="py-6 text-sm text-muted-foreground">
							{t("settings.travelExpenses.loading", "Loading policies…")}
						</div>
					) : policies.length === 0 ? (
						<div className="py-6 text-sm text-muted-foreground">
							{t(
								"settings.travelExpenses.empty",
								"No policies configured yet. Create your first travel expense policy.",
							)}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.travelExpenses.effectiveFrom", "Effective From")}</TableHead>
									<TableHead>{t("settings.travelExpenses.effectiveTo", "Effective To")}</TableHead>
									<TableHead>{t("settings.travelExpenses.currency", "Currency")}</TableHead>
									<TableHead>{t("settings.travelExpenses.mileageRate", "Mileage / km")}</TableHead>
									<TableHead>{t("settings.travelExpenses.perDiemRate", "Per diem / day")}</TableHead>
									<TableHead>{t("common.status", "Status")}</TableHead>
									<TableHead className="w-[80px]" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{policies.map((policy) => (
									<TableRow key={policy.id}>
										<TableCell>{formatDate(policy.effectiveFrom)}</TableCell>
										<TableCell>{formatDate(policy.effectiveTo)}</TableCell>
										<TableCell>{policy.currency}</TableCell>
										<TableCell>{formatRate(policy.mileageRatePerKm, policy.currency)}</TableCell>
										<TableCell>{formatRate(policy.perDiemRatePerDay, policy.currency)}</TableCell>
										<TableCell>
											<Badge variant={policy.isActive ? "default" : "outline"}>
												{policy.isActive
													? t("common.active", "Active")
													: t("common.inactive", "Inactive")}
											</Badge>
										</TableCell>
										<TableCell>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => handleEdit(policy)}
												aria-label={t("common.edit", "Edit")}
											>
												<IconPencil className="h-4 w-4" />
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<TravelExpensePolicyDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				editingPolicy={editingPolicy}
				onSuccess={handleSuccess}
			/>
		</div>
	);
}
