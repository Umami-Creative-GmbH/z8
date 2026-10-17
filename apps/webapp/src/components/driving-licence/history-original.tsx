"use client";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { DrivingLicenceHistory } from "@/lib/organization/driving-licence/history";
export function DrivingHistoryOriginal({
	check,
	canSupplement,
	onSupplement,
	supplementForm,
}: {
	check: DrivingLicenceHistory["checks"][number];
	canSupplement: boolean;
	onSupplement: (checkId: string) => void;
	supplementForm?: { checkId: string; content: ReactNode } | null;
}) {
	const { t } = useTranslate();
	return (
		<>
			<h3 className="font-semibold">
				{t(
					"drivingLicence.history.original",
					"Original check and confirmation",
				)}
			</h3>
			<p className="text-sm">
				{check.employeeName} · {check.verifierName}
			</p>
			<p className="text-sm">
				{t(
					"drivingLicence.evidence.document",
					"Document issued {issued}; expires {expiry}",
					{
						issued: check.documentIssuedOn,
						expiry: check.documentExpiresOn,
					},
				)}
			</p>
			<p className="text-sm">
				{t(
					"drivingLicence.history.snapshot",
					"Policy {version}; interval {months} months; deadline timezone {timezone}",
					{
						version: check.policyVersion,
						months: check.intervalMonths,
						timezone: check.deadlineTimezone,
					},
				)}
			</p>
			<ul className="text-sm">
				{check.classes.map((c) => (
					<li key={c.code}>
						{c.code} ·{" "}
						{c.result === "successful"
							? t("drivingLicence.result.successful", "Successful")
							: c.result === "unsuccessful"
								? t("drivingLicence.result.unsuccessful", "Unsuccessful")
								: t("drivingLicence.result.inconclusive", "Inconclusive")}
						{c.expiryDate ? ` · ${c.expiryDate}` : ""}
						{c.restrictions ? ` · ${c.restrictions}` : ""}
					</li>
				))}
			</ul>
			<p className="text-sm">
				{check.originalInspected && check.identityConfirmed
					? t(
							"drivingLicence.history.originalConfirmed",
							"Original and identity confirmed",
						)
					: t(
							"drivingLicence.history.originalUnconfirmed",
							"Original or identity not confirmed",
						)}
			</p>
			<p className="text-sm">
				{check.employeeDeclaration
					? t(
							"drivingLicence.history.declarationConfirmed",
							"Employee declaration confirmed at the original check",
						)
					: t(
							"drivingLicence.history.declarationUnconfirmed",
							"Employee declaration not confirmed",
						)}
			</p>
			<blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">
				{check.declarationText}
			</blockquote>
			<p className="text-sm">
				{t(
					"drivingLicence.history.verifierConfirmation",
					"Verifier confirmation recorded at the original check time",
				)}
			</p>
			{canSupplement && (
				<Button
					type="button"
					variant="outline"
					onClick={() => onSupplement(check.id)}
				>
					{t(
						"drivingLicence.history.openSupplement",
						"Supplement original check {date}",
						{ date: check.controlledAt },
					)}
				</Button>
			)}
			{supplementForm?.checkId === check.id && supplementForm.content}
		</>
	);
}
