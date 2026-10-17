"use client";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import type { LicenceClass } from "@/lib/organization/driving-licence/check-types";
import type { DrivingLicenceEmployeeRecord } from "@/lib/organization/driving-licence/checks";
import {
	getDrivingImpedimentStateAction,
	reinstateDrivingAuthorizationAction,
} from "@/lib/organization/driving-licence/impediment-actions";

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
		<section
			className="space-y-3 rounded-lg border p-4"
			aria-labelledby={`${fieldId}-title`}
		>
			<h3 id={`${fieldId}-title`} className="font-semibold">
				{t(
					"drivingLicence.impediment.reinstateTitle",
					"Explicitly reinstate driving authorization",
				)}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.impediment.reinstateHelp",
					"First record a new personal original check after the suspension. Establish that every impediment has been resolved; inspect any necessary supporting evidence outside Z8. Seeing the licence card alone may be insufficient. Only the selected successfully checked classes will be reinstated.",
				)}
			</p>
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
									<label
										key={c.code}
										className="flex items-center gap-2 text-sm"
									>
										<input
											type="checkbox"
											name="classCodes"
											value={c.code}
											checked={field.state.value.includes(c.code)}
											onChange={(event) =>
												field.handleChange(
													event.target.checked
														? [...field.state.value, c.code]
														: field.state.value.filter(
																(code) => code !== c.code,
															),
												)
											}
										/>
										{c.code}
									</label>
								))}
							</fieldset>
						)}
					</form.Field>
					<form.Field name="impedimentResolved">
						{(field) => (
							<label className="flex items-start gap-2 text-sm">
								<input
									type="checkbox"
									name="impedimentResolved"
									checked={field.state.value}
									onChange={(event) => field.handleChange(event.target.checked)}
								/>
								{t(
									"drivingLicence.impediment.resolutionConfirmation",
									"I have established that all person-wide, document-wide and reported impediments are resolved, examined necessary supporting evidence outside Z8, and explicitly authorize the selected classes again.",
								)}
							</label>
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
		</section>
	);
}
