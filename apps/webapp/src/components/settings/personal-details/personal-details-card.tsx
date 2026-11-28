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
import type { PersonalDetailsView } from "@/lib/organization/personal-details/types";
import { BankAccountForm } from "./bank-account-form";
import { BankAccountHistoryList, CurrentBankAccount } from "./bank-account-history";
import { EndBankAccountForm } from "./end-bank-account-form";
import { PERSONAL_DETAILS_REFUSALS } from "./personal-details-copy";

/**
 * Personal details on the employee page (#2069), shown only to viewers with a
 * right to them: the bank account in force and its history, IBANs masked until
 * "show", and the change and end forms for those who may change them (#2071).
 */
export function PersonalDetailsCard({ view }: { view: PersonalDetailsView }) {
	const { t } = useTranslate();
	const router = useRouter();
	// The revealed copy and the server view it was revealed for.
	const [reveal, setReveal] = useState<{
		of: PersonalDetailsView;
		revealed: PersonalDetailsView;
	} | null>(null);
	const [editing, setEditing] = useState<"change" | "end" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [revealing, startReveal] = useTransition();
	const [refreshing, startRefresh] = useTransition();

	// A revealed copy is only shown for the view it was revealed from: once the page
	// delivers a newer view (a refresh after anyone's change), it needs a fresh reveal.
	const revealed = reveal?.of === view ? reveal.revealed : null;
	const showRevealed = revealed !== null;
	const current = revealed ?? view;
	const canReveal = !view.viewer.revealed && view.bankAccount.history.length > 0;
	// An end needs a bank account in force today or one coming into force later.
	const canEnd =
		view.bankAccount.current !== null ||
		view.bankAccount.history.some((entry) => entry.value !== null && entry.validFrom > view.on);
	const afterWrite = () => {
		setEditing(null);
		setReveal(null);
		startRefresh(() => router.refresh());
	};

	const toggleReveal = () => {
		setError(null);
		if (showRevealed) {
			setReveal(null);
			return;
		}
		const of = view;
		startReveal(async () => {
			const result = await revealEmployeePersonalDetails({ employeeId: of.employeeId });
			if (result.success) {
				setReveal({ of, revealed: result.data });
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
								"Bank account as this organization records it. The employee is told about every change.",
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
						{view.viewer.mayChange && editing === null ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => setEditing("change")}
							>
								<IconPencil className="size-4" aria-hidden="true" />
								{t("settings.personalDetails.bankAccount.change", "Change bank account")}
							</Button>
						) : null}
						{view.viewer.mayChange && editing === null && canEnd ? (
							<Button type="button" variant="ghost" size="sm" onClick={() => setEditing("end")}>
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
				<CurrentBankAccount bankAccount={current.bankAccount} />
				{view.viewer.mayChange && editing === "change" ? (
					<BankAccountForm
						employeeId={view.employeeId}
						today={view.on}
						onCancel={() => setEditing(null)}
						onSaved={afterWrite}
					/>
				) : null}
				{view.viewer.mayChange && editing === "end" ? (
					<EndBankAccountForm
						employeeId={view.employeeId}
						today={view.on}
						onCancel={() => setEditing(null)}
						onEnded={afterWrite}
					/>
				) : null}
				<div aria-busy={refreshing}>
					<BankAccountHistoryList bankAccount={current.bankAccount} on={view.on} />
				</div>
			</CardContent>
		</Card>
	);
}
