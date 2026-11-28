"use client";

import {
	IconCalendarX,
	IconEye,
	IconEyeOff,
	IconLoader2,
	IconPencil,
	IconUserShield,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { revealEmployeePersonalDetails } from "@/app/[locale]/(app)/settings/employees/personal-details-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type {
	BankAccountView,
	PersonalDetailsEntry,
	PersonalDetailsHistory,
	PersonalDetailsPart,
	PersonalDetailsView,
} from "@/lib/organization/personal-details/types";
import { BankAccountForm } from "./bank-account-form";
import { BankAccountHistoryList, CurrentBankAccount } from "./bank-account-history";
import { EndPersonalDetailsForm } from "./end-personal-details-form";
import { CurrentHealthInsurance, HealthInsuranceHistoryList } from "./health-insurance-history";
import { HealthInsuranceForm } from "./health-insurance-form";
import { PERSONAL_DETAILS_REFUSALS } from "./personal-details-copy";

/**
 * Personal details on the employee page (#2069), shown only to viewers with a
 * right to them: the bank account in force and its history, IBANs masked until
 * "show", the health insurance and its history (#2070, not for an External
 * Contractor), and the change and end forms for those who may change them (#2071).
 */
export function PersonalDetailsCard({ view: pageView }: { view: PersonalDetailsView }) {
	const { t } = useTranslate();
	const router = useRouter();
	// The view a reveal fetched, the page's view it was fetched over, and whether its
	// IBANs are shown. Hiding them keeps the fetched view: it is the freshest one.
	const [reveal, setReveal] = useState<{
		of: PersonalDetailsView;
		revealed: PersonalDetailsView;
		shown: boolean;
	} | null>(null);
	const [editing, setEditing] = useState<{
		part: PersonalDetailsPart;
		mode: "change" | "end";
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [revealing, startReveal] = useTransition();
	const [refreshing, startRefresh] = useTransition();

	// A fetched view only counts over the page's view it was fetched over: once the
	// page delivers a newer view (a refresh after anyone's change), that one is the
	// freshest and the IBANs need a fresh reveal. Everything renders from the
	// freshest view, the health insurance too (gone for an External Contractor).
	const fetched = reveal?.of === pageView ? reveal : null;
	const view = fetched?.revealed ?? pageView;
	const showRevealed = fetched?.shown === true;
	const bankAccount =
		fetched && !showRevealed ? withIbansMasked(view.bankAccount) : view.bankAccount;
	const canReveal = !pageView.viewer.revealed && view.bankAccount.history.length > 0;
	// Any value on file can be ended, also one that already ended (to correct the
	// end to an earlier day); the module refuses a day with nothing to end.
	const canEndBankAccount = view.bankAccount.history.some((entry) => entry.value !== null);
	const canEndHealthInsurance =
		view.healthInsurance?.history.some((entry) => entry.value !== null) ?? false;
	const mayEdit = view.viewer.mayChange && editing === null;
	const isEditing = (part: PersonalDetailsPart, mode: "change" | "end") =>
		view.viewer.mayChange && editing?.part === part && editing.mode === mode;
	const afterWrite = () => {
		setEditing(null);
		setReveal(null);
		startRefresh(() => router.refresh());
	};

	const toggleReveal = () => {
		setError(null);
		if (fetched && showRevealed) {
			setReveal({ ...fetched, shown: false });
			return;
		}
		const of = pageView;
		startReveal(async () => {
			const result = await revealEmployeePersonalDetails({ employeeId: of.employeeId });
			if (result.success) {
				setReveal({ of, revealed: result.data, shown: true });
			} else {
				setError(
					actionErrorMessage(t, result, PERSONAL_DETAILS_REFUSALS, [
						"settings.personalDetails.revealFailed",
						"Could not show the IBAN. Try again.",
					]),
				);
			}
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconUserShield className="size-5 text-primary" aria-hidden="true" />
					{t("settings.personalDetails.title", "Personal details")}
				</CardTitle>
				<CardDescription>
					{view.viewer.own
						? t(
								"settings.personalDetails.ownDescription",
								"Your own personal details. They are changed by a request that someone else decides.",
							)
						: t(
								"settings.personalDetails.description",
								"Bank account and health insurance as this organization records them. The employee is told about every change.",
							)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="text-sm font-semibold">
						{t("settings.personalDetails.bankAccount.title", "Bank account")}
					</h3>
					<div className="flex flex-wrap gap-2">
						{canReveal ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={toggleReveal}
								disabled={revealing}
								aria-pressed={showRevealed}
							>
								{revealing ? (
									<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
								) : showRevealed ? (
									<IconEyeOff className="size-4" aria-hidden="true" />
								) : (
									<IconEye className="size-4" aria-hidden="true" />
								)}
								{showRevealed
									? t("settings.personalDetails.hideIban", "Hide IBAN")
									: t("settings.personalDetails.showIban", "Show IBAN")}
							</Button>
						) : null}
						{mayEdit ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => setEditing({ part: "bank_account", mode: "change" })}
							>
								<IconPencil className="size-4" aria-hidden="true" />
								{t("settings.personalDetails.bankAccount.change", "Change bank account")}
							</Button>
						) : null}
						{mayEdit && canEndBankAccount ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setEditing({ part: "bank_account", mode: "end" })}
							>
								<IconCalendarX className="size-4" aria-hidden="true" />
								{t("settings.personalDetails.bankAccount.end", "End bank account")}
							</Button>
						) : null}
					</div>
				</div>
				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : null}
				<CurrentBankAccount bankAccount={bankAccount} />
				{isEditing("bank_account", "change") ? (
					<BankAccountForm
						employeeId={view.employeeId}
						today={view.on}
						onCancel={() => setEditing(null)}
						onSaved={afterWrite}
					/>
				) : null}
				{isEditing("bank_account", "end") ? (
					<EndPersonalDetailsForm
						employeeId={view.employeeId}
						part="bank_account"
						today={view.on}
						onCancel={() => setEditing(null)}
						onEnded={afterWrite}
					/>
				) : null}
				<div aria-busy={refreshing}>
					<BankAccountHistoryList bankAccount={bankAccount} on={view.on} />
				</div>
				{view.healthInsurance ? (
					<section className="space-y-4 border-t pt-4">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="text-sm font-semibold">
								{t("settings.personalDetails.healthInsurance.title", "Health insurance")}
							</h3>
							<div className="flex flex-wrap gap-2">
								{mayEdit ? (
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => setEditing({ part: "health_insurance", mode: "change" })}
									>
										<IconPencil className="size-4" aria-hidden="true" />
										{t(
											"settings.personalDetails.healthInsurance.change",
											"Change health insurance",
										)}
									</Button>
								) : null}
								{mayEdit && canEndHealthInsurance ? (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => setEditing({ part: "health_insurance", mode: "end" })}
									>
										<IconCalendarX className="size-4" aria-hidden="true" />
										{t("settings.personalDetails.healthInsurance.end", "End health insurance")}
									</Button>
								) : null}
							</div>
						</div>
						<CurrentHealthInsurance healthInsurance={view.healthInsurance} />
						{isEditing("health_insurance", "change") ? (
							<HealthInsuranceForm
								employeeId={view.employeeId}
								today={view.on}
								onCancel={() => setEditing(null)}
								onSaved={afterWrite}
							/>
						) : null}
						{isEditing("health_insurance", "end") ? (
							<EndPersonalDetailsForm
								employeeId={view.employeeId}
								part="health_insurance"
								today={view.on}
								onCancel={() => setEditing(null)}
								onEnded={afterWrite}
							/>
						) : null}
						<div aria-busy={refreshing}>
							<HealthInsuranceHistoryList healthInsurance={view.healthInsurance} on={view.on} />
						</div>
					</section>
				) : null}
			</CardContent>
		</Card>
	);
}

/** The bank account as a decider sees it before "show": IBANs by their last four only. */
function withIbansMasked(
	bankAccount: PersonalDetailsHistory<BankAccountView>,
): PersonalDetailsHistory<BankAccountView> {
	const mask = (entry: PersonalDetailsEntry<BankAccountView>) =>
		entry.value ? { ...entry, value: { ...entry.value, iban: null } } : entry;
	return {
		current: bankAccount.current ? mask(bankAccount.current) : null,
		history: bankAccount.history.map(mask),
	};
}
