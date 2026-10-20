"use client";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AuthorizationStatus } from "@/lib/organization/driving-licence/check-types";
import type { DrivingLicenceEmployeeRecord } from "@/lib/organization/driving-licence/checks";

/**
 * The one vocabulary for a person's driving status (#1418): `headline` for the status
 * summary, history and the header clock, `short` for table badges and filters. Someone the
 * control doesn't apply to is "not an intended driver".
 */
export function useDrivingStatusLabels(): Record<
	AuthorizationStatus,
	{ headline: string; short: string }
> {
	const { t } = useTranslate();
	return {
		active: {
			headline: t("drivingLicence.status.active", "Driving authorization active"),
			short: t("drivingLicence.checks.status.active", "Active"),
		},
		partially_active: {
			headline: t("drivingLicence.status.partial", "Some driving classes are suspended"),
			short: t("drivingLicence.checks.status.partiallyActive", "Partially active"),
		},
		suspended: {
			headline: t("drivingLicence.status.suspended", "Driving authorization suspended"),
			short: t("drivingLicence.checks.status.suspended", "Suspended"),
		},
		ended: {
			headline: t("drivingLicence.status.ended", "Driving authorization ended"),
			short: t("drivingLicence.checks.status.ended", "Ended"),
		},
		not_enrolled: {
			headline: t(
				"drivingLicence.status.notIntended",
				"Not an intended driver — no driving authorization",
			),
			short: t("drivingLicence.checks.status.notIntended", "Not an intended driver"),
		},
		not_yet_checked: {
			headline: t("drivingLicence.notChecked", "Not yet checked — no driving authorization"),
			short: t("drivingLicence.checks.status.notYetChecked", "Not yet checked"),
		},
	};
}
export function DrivingStatusLabel({ status }: { status: AuthorizationStatus }) {
	return <>{useDrivingStatusLabels()[status].headline}</>;
}
/** One class authorization's state: Authorized, Suspended or Ended. */
export function DrivingClassStatusLabel({ status }: { status: string }) {
	const { t } = useTranslate();
	return (
		<>
			{status === "active"
				? t("drivingLicence.class.active", "Authorized")
				: status === "ended"
					? t("drivingLicence.class.ended", "Ended")
					: t("drivingLicence.class.suspended", "Suspended")}
		</>
	);
}
/** Why a class is not authorized. */
export function DrivingClassReason({ reason }: { reason: string }) {
	const { t } = useTranslate();
	return (
		<>
			{reason === "check_overdue"
				? t(
						"drivingLicence.class.overdue",
						"Routine check overdue. This is an organizational suspension, not a statement that legal driving entitlement was withdrawn.",
					)
				: reason === "no_longer_intended"
					? t(
							"drivingLicence.class.noLongerIntended",
							"Ended because the employee is no longer an intended driver. Driving again requires a new check.",
						)
					: t(
							"drivingLicence.class.recheck",
							"A new original check and explicit reinstatement are required.",
						)}
		</>
	);
}
/** The original checks as recorded, newest first. */
export function DrivingLicenceCheckEvidence({
	record,
}: {
	record: Pick<DrivingLicenceEmployeeRecord, "checks">;
}) {
	const { t } = useTranslate();
	const titleId = useId();
	return (
		<Card role="region" aria-labelledby={titleId}>
			<CardHeader>
				<CardTitle>
					<h2 id={titleId} className="text-lg font-semibold">
						{t("drivingLicence.evidence.title", "Original check evidence")}
					</h2>
				</CardTitle>
			</CardHeader>
			<CardContent>
				{!record.checks.length && (
					<p className="text-sm text-muted-foreground">
						{t("drivingLicence.evidence.empty", "No original check has been completed.")}
					</p>
				)}
				<ol className="divide-y">
					{record.checks.map((check) => (
						<li key={check.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
							<p className="font-medium">
								{check.employeeName} · {check.controlledAt}
							</p>
							<p className="text-sm">
								{t("drivingLicence.evidence.verifier", "Original check recorded by {name}", {
									name: check.verifierName,
								})}
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
								{check.originalInspected && check.identityConfirmed
									? t(
											"drivingLicence.evidence.originalConfirmed",
											"Original personally inspected and employee identity confirmed.",
										)
									: t(
											"drivingLicence.evidence.originalUnconfirmed",
											"Original inspection or employee identity could not be confirmed.",
										)}
							</p>
							<p className="text-sm">
								{check.employeeDeclaration
									? t(
											"drivingLicence.evidence.declarationConfirmed",
											"The employee made the declaration in person; the verifier attested it at the control time.",
										)
									: t(
											"drivingLicence.evidence.declarationUnconfirmed",
											"The employee declaration could not be confirmed.",
										)}
							</p>
							<blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">
								{t(
									"drivingLicence.declaration.text",
									"I confirm that no known driving ban, withdrawal or other impediment prevents the intended driving, and that I meet the applicable driving restrictions.",
								)}
							</blockquote>
							<p className="text-sm">
								{t(
									"drivingLicence.evidence.confirmation",
									"Verifier confirmation recorded with policy version {version}; deadlines use {timezone}.",
									{
										version: check.policyVersion,
										timezone: check.deadlineTimezone,
									},
								)}
							</p>
							<ul className="text-sm">
								{check.classes.map((inspected) => (
									<li key={inspected.code}>
										{inspected.code}:{" "}
										{inspected.result === "successful"
											? t("drivingLicence.result.successful", "Successful")
											: inspected.result === "unsuccessful"
												? t("drivingLicence.result.unsuccessful", "Unsuccessful")
												: t("drivingLicence.result.inconclusive", "Inconclusive")}
										{inspected.expiryDate ? ` · ${inspected.expiryDate}` : ""}
										{inspected.restrictions ? ` · ${inspected.restrictions}` : ""}
									</li>
								))}
							</ul>
						</li>
					))}
				</ol>
			</CardContent>
		</Card>
	);
}
