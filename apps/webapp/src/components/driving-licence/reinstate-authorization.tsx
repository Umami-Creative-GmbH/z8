"use client";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";
import type { LicenceClass } from "@/lib/organization/driving-licence/check-types";
import type { DrivingLicenceEmployeeRecord } from "@/lib/organization/driving-licence/checks";
import {
	getDrivingImpedimentStateAction,
	reinstateDrivingAuthorizationAction,
} from "@/lib/organization/driving-licence/impediment-actions";

/**
 * The explicit reinstatement step (#1429: on the check page). The classes to reinstate and
 * the resolution confirmation are checkboxes, like the check's own confirmations.
 */
export function ReinstateDrivingAuthorization({
	employeeId,
	record,
	onCompleted,
}: {
	employeeId: string;
	record: DrivingLicenceEmployeeRecord;
	onCompleted: () => Promise<void>;
}) {
	const { t } = useTranslate();
	const { data: session } = useSession();
	const fieldId = useId();
	const [error, setError] = useState(false);
	const [saved, setSaved] = useState(false);
	const state = useQuery({
		queryKey: [
			"driving-licence-impediments",
			session?.session.activeOrganizationId,
			session?.user.id,
			employeeId,
			record.checks[0]?.id,
		],
		enabled:
			record.status === "suspended" || record.status === "partially_active",
		queryFn: () => getDrivingImpedimentStateAction({ employeeId }),
	});
	const check = record.checks[0];
	const candidates =
		check?.originalInspected &&
		check.identityConfirmed &&
		check.employeeDeclaration &&
		check.verifierConfirmed
			? check.classes.filter(
					(c) =>
						c.result === "successful" &&
						record.classes.some(
							(current) =>
								current.code === c.code &&
								current.status === "suspended" &&
								current.supportingCheckId === check.id,
						),
				)
			: [];
	const form = useForm({
		defaultValues: {
			classCodes: [] as LicenceClass[],
			impedimentResolved: false,
		},
		onSubmit: async ({ value }) => {
			if (!check || !state.data?.success) return;
			setError(false);
			setSaved(false);
			try {
				const response = await reinstateDrivingAuthorizationAction({
					employeeId,
					checkId: check.id,
					...value,
					expectedReportIds: state.data.data.reports.map((r) => r.id),
					expectedSuspension: state.data.data.suspension,
				});
				if (!response.success) {
					setError(true);
					return;
				}
				form.reset();
				setSaved(true);
				await Promise.all([state.refetch(), onCompleted()]);
			} catch {
				setError(true);
			}
		},
	});
	if (record.status !== "suspended" && record.status !== "partially_active")
		return null;
	return (
		<Card role="region" aria-labelledby={`${fieldId}-title`}>
			<CardHeader>
				<CardTitle>
					<h2 id={`${fieldId}-title`} className="text-lg font-semibold">
						{t(
							"drivingLicence.impediment.reinstateTitle",
							"Explicitly reinstate driving authorization",
						)}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.impediment.reinstateHelp",
						"First record a new personal original check after the suspension. Establish that every impediment has been resolved; inspect any necessary supporting evidence outside Z8. Seeing the licence card alone may be insufficient. Only the selected successfully checked classes will be reinstated.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
			{state.data?.success && state.data.data.reports.length > 0 && (
				<p className="text-sm font-medium">
					{t(
						"drivingLicence.impediment.unresolvedReport",
						"An employee-reported person-wide impediment still requires resolution.",
					)}
				</p>
			)}
			{!candidates.length ? (
				<p className="text-sm">
					{t(
						"drivingLicence.impediment.newCheckRequired",
						"Record a new successful original check for the suspended classes before reinstatement.",
					)}
				</p>
			) : (
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field name="classCodes">
						{(field) => (
							<fieldset className="space-y-2">
								<legend className="text-sm font-medium">
									{t(
										"drivingLicence.impediment.selectClasses",
										"Classes to reinstate from the latest original check",
									)}
								</legend>
								{candidates.map((c) => (
									<div key={c.code} className="flex items-center gap-2">
										<Checkbox
											id={`${fieldId}-class-${c.code}`}
											name="classCodes"
											value={c.code}
											checked={field.state.value.includes(c.code)}
											onCheckedChange={(checked) =>
												field.handleChange(
													checked === true
														? [...field.state.value, c.code]
														: field.state.value.filter(
																(code) => code !== c.code,
															),
												)
											}
										/>
										<Label htmlFor={`${fieldId}-class-${c.code}`} translate="no">
											{c.code}
										</Label>
									</div>
								))}
							</fieldset>
						)}
					</form.Field>
					<form.Field name="impedimentResolved">
						{(field) => (
							<div className="flex items-start gap-3">
								<Checkbox
									id={`${fieldId}-resolved`}
									name="impedimentResolved"
									className="mt-0.5"
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked === true)}
								/>
								<Label
									htmlFor={`${fieldId}-resolved`}
									className="text-sm font-normal leading-snug"
								>
									{t(
										"drivingLicence.impediment.resolutionConfirmation",
										"I have established that all person-wide, document-wide and reported impediments are resolved, examined necessary supporting evidence outside Z8, and explicitly authorize the selected classes again.",
									)}
								</Label>
							</div>
						)}
					</form.Field>
					<form.Subscribe
						selector={(s) =>
							[
								s.isSubmitting,
								s.values.classCodes.length,
								s.values.impedimentResolved,
							] as const
						}
					>
						{([pending, count, confirmed]) => (
							<Button
								type="submit"
								disabled={
									pending || !count || !confirmed || !state.data?.success
								}
							>
								{pending
									? t(
											"drivingLicence.impediment.reinstating",
											"Saving reinstatement…",
										)
									: t(
											"drivingLicence.impediment.reinstate",
											"Reinstate selected classes",
										)}
							</Button>
						)}
					</form.Subscribe>
				</form>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{t(
						"drivingLicence.impediment.reinstateFailed",
						"Reinstatement was refused. Refresh and review the current record, your responsibility and a new original check.",
					)}
				</p>
			)}
			{saved && (
				<p role="status" className="text-sm">
					{t(
						"drivingLicence.impediment.reinstated",
						"The selected classes were explicitly reinstated.",
					)}
				</p>
			)}
			</CardContent>
		</Card>
	);
}
