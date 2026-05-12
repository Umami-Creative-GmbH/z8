"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateOrganizationFiscalYearStartMonth } from "@/app/[locale]/(app)/settings/organizations/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useRouter } from "@/navigation";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

const MONTHS = [
	{ value: 1, label: "January" },
	{ value: 2, label: "February" },
	{ value: 3, label: "March" },
	{ value: 4, label: "April" },
	{ value: 5, label: "May" },
	{ value: 6, label: "June" },
	{ value: 7, label: "July" },
	{ value: 8, label: "August" },
	{ value: 9, label: "September" },
	{ value: 10, label: "October" },
	{ value: 11, label: "November" },
	{ value: 12, label: "December" },
] as const;

interface OrganizationFiscalYearCardProps {
	organizationId: string;
	fiscalYearStartMonth: number;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationFiscalYearCard({
	organizationId,
	fiscalYearStartMonth,
	currentMemberRole,
}: OrganizationFiscalYearCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [month, setMonth] = useState(fiscalYearStartMonth);
	const [isSaving, setIsSaving] = useState(false);
	const isSavingRef = useRef(false);
	const setOrgSettings = useOrganizationSettings((state) => state.setSettings);
	const canEdit = currentMemberRole === "owner";
	const fiscalYearStartMonthLabel = t(
		"organization.fiscalYear.startMonth",
		"Fiscal year start month",
	);

	const handleMonthChange = async (value: string) => {
		if (!canEdit || isSavingRef.current) return;

		const nextMonth = Number(value);
		const previousMonth = month;

		setMonth(nextMonth);
		isSavingRef.current = true;
		setIsSaving(true);
		setOrgSettings({ fiscalYearStartMonth: nextMonth });

		try {
			const result = await updateOrganizationFiscalYearStartMonth(organizationId, nextMonth);

			if (result.success) {
				toast.success(t("organization.fiscalYear.updated", "Fiscal year setting updated"));
				startTransition(() => {
					router.refresh();
				});
				return;
			}

			setMonth(previousMonth);
			setOrgSettings({ fiscalYearStartMonth: previousMonth });
			toast.error(
				result.error ||
					t("organization.fiscalYear.updateFailed", "Failed to update fiscal year setting"),
			);
		} finally {
			isSavingRef.current = false;
			setIsSaving(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("organization.fiscalYear.title", "Fiscal year")}</CardTitle>
				<CardDescription>
					{t(
						"organization.fiscalYear.description",
						"Reports, vacation balances, and carryover calculations use this setting.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<Label htmlFor="fiscal-year-start-month">{fiscalYearStartMonthLabel}</Label>
						{(isPending || isSaving) && (
							<IconLoader2 aria-hidden="true" className="h-4 w-4 animate-spin text-muted-foreground" />
						)}
					</div>
					<Select
						value={String(month)}
						onValueChange={handleMonthChange}
						disabled={!canEdit || isPending || isSaving}
					>
						<SelectTrigger id="fiscal-year-start-month">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{MONTHS.map((monthOption) => (
								<SelectItem key={monthOption.value} value={String(monthOption.value)}>
									{t(
										`organization.fiscalYear.month.${monthOption.value}`,
										monthOption.label,
									)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{!canEdit && (
					<p className="text-xs text-muted-foreground">
						{t(
							"organization.fiscalYear.ownerOnly",
							"Only organization owners can change the fiscal year setting.",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
