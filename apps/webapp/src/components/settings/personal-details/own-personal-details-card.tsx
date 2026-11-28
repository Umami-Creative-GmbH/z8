"use client";

import { IconUserShield } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PersonalDetailsView } from "@/lib/organization/personal-details/types";
import { BankAccountHistoryList, CurrentBankAccount } from "./bank-account-history";
import { CurrentHealthInsurance, HealthInsuranceHistoryList } from "./health-insurance-history";

/**
 * The employee's own personal details in their settings (#2069, #2070): what
 * their organization has on file, in full and read-only; no health insurance for
 * an External Contractor. Changes go through a
 * personal details change request (#2072).
 */
export function OwnPersonalDetailsCard({ view }: { view: PersonalDetailsView }) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconUserShield className="size-5 text-primary" aria-hidden="true" />
					{t("settings.profile.personalDetails.title", "Personal details")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.profile.personalDetails.description",
						"The bank account and health insurance your organization has on file for you. You're told by email whenever they change.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<h3 className="text-sm font-semibold">
					{t("settings.personalDetails.bankAccount.title", "Bank account")}
				</h3>
				<CurrentBankAccount bankAccount={view.bankAccount} />
				<BankAccountHistoryList bankAccount={view.bankAccount} on={view.on} />
				{view.healthInsurance ? (
					<section className="space-y-4 border-t pt-4">
						<h3 className="text-sm font-semibold">
							{t("settings.personalDetails.healthInsurance.title", "Health insurance")}
						</h3>
						<CurrentHealthInsurance healthInsurance={view.healthInsurance} />
						<HealthInsuranceHistoryList healthInsurance={view.healthInsurance} on={view.on} />
					</section>
				) : null}
			</CardContent>
		</Card>
	);
}
