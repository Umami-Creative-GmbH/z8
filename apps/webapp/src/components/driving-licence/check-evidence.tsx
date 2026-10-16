"use client";
import { useTranslate } from "@tolgee/react";
import type { AuthorizationStatus } from "@/lib/organization/driving-licence/check-types";
import type { DrivingLicenceEmployeeRecord } from "@/lib/organization/driving-licence/checks";
export function DrivingStatusLabel({
	status,
}: {
	status: AuthorizationStatus;
}) {
	const { t } = useTranslate();
	switch (status) {
		case "active":
			return (
				<>{t("drivingLicence.status.active", "Driving authorization active")}</>
			);
		case "partially_active":
			return (
				<>
					{t(
						"drivingLicence.status.partial",
						"Some driving classes are suspended",
					)}
				</>
			);
		case "suspended":
			return (
				<>
					{t(
						"drivingLicence.status.suspended",
						"Driving authorization suspended",
					)}
				</>
			);
		case "ended":
			return (
				<>{t("drivingLicence.status.ended", "Driving authorization ended")}</>
			);
		case "not_enrolled":
			return (
				<>
					{t(
						"drivingLicence.notEnrolled",
						"Not enrolled — no driving authorization",
					)}
				</>
			);
		case "not_yet_checked":
			return (
				<>
					{t(
						"drivingLicence.notChecked",
						"Not yet checked — no driving authorization",
					)}
				</>
			);
	}
}
export function DrivingLicenceEvidence({
	record,
}: {
	record: DrivingLicenceEmployeeRecord;
}) {
	const { t } = useTranslate();
	return (
		<div className="space-y-5">
			{record.uncertainEmailCount > 0 ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"drivingLicence.delivery.uncertain",
						"Optional reminder emails to you have an uncertain delivery outcome ({count}). They will not be sent again automatically. Your in-app reminders remain available; email delivery does not confirm reading.",
						{ count: record.uncertainEmailCount },
					)}
				</p>
			) : null}
			<section
				className="rounded-lg border bg-card p-5"
				aria-labelledby="driving-status-title"
			>
				<h2 id="driving-status-title" className="text-lg font-semibold">
					<DrivingStatusLabel status={record.status} />
				</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					{t(
						"drivingLicence.status.explanation",
						"Organization driving authorization covers the listed classes and restrictions. It does not establish suitability for every vehicle. You can continue recording working time and actual vehicle use.",
					)}
				</p>
				<ul className="mt-4 divide-y">
					{record.classes.map((authorization) => (
						<li key={authorization.code} className="space-y-1 py-3">
							<div className="flex flex-wrap justify-between gap-2">
								<strong>{authorization.code}</strong>
								<span>
									{authorization.status === "active"
										? t("drivingLicence.class.active", "Authorized")
										: authorization.status === "ended"
											? t("drivingLicence.class.ended", "Ended")
											: t("drivingLicence.class.suspended", "Suspended")}
								</span>
							</div>
							<p className="text-sm">
								{t(
									"drivingLicence.class.validThrough",
									"Valid through {date} ({timezone})",
									{
										date: authorization.validThrough,
										timezone: authorization.deadlineTimezone,
									},
								)}
							</p>
							{authorization.reason && (
								<p className="text-sm text-muted-foreground">
									{authorization.reason === "check_overdue"
										? t(
												"drivingLicence.class.overdue",
												"Routine check overdue. This is an organizational suspension, not a statement that legal driving entitlement was withdrawn.",
											)
										: t(
												"drivingLicence.class.recheck",
												"A new original check and explicit reinstatement are required.",
											)}
								</p>
							)}
							{authorization.restrictions && (
								<p className="text-sm">
									{t(
										"drivingLicence.class.restrictions",
										"Driving restrictions: {restrictions}",
										{ restrictions: authorization.restrictions },
									)}
								</p>
							)}
						</li>
					))}
				</ul>
			</section>
			<section aria-labelledby="driving-check-evidence">
				<h2 id="driving-check-evidence" className="mb-3 text-lg font-semibold">
					{t("drivingLicence.evidence.title", "Original check evidence")}
				</h2>
				{!record.checks.length && (
					<p className="text-sm text-muted-foreground">
						{t(
							"drivingLicence.evidence.empty",
							"No original check has been completed.",
						)}
					</p>
				)}
				<ol className="space-y-4">
					{record.checks.map((check) => (
						<li key={check.id} className="space-y-2 rounded-lg border p-4">
							<p className="font-medium">
								{check.employeeName} · {check.controlledAt}
							</p>
							<p className="text-sm">
								{t(
									"drivingLicence.evidence.verifier",
									"Original check recorded by {name}",
									{ name: check.verifierName },
								)}
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
												? t(
														"drivingLicence.result.unsuccessful",
														"Unsuccessful",
													)
												: t(
														"drivingLicence.result.inconclusive",
														"Inconclusive",
													)}
										{inspected.expiryDate ? ` · ${inspected.expiryDate}` : ""}
										{inspected.restrictions
											? ` · ${inspected.restrictions}`
											: ""}
									</li>
								))}
							</ul>
						</li>
					))}
				</ol>
			</section>
		</div>
	);
}
