"use client";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import {
	applyDrivingLicenceIntervalAction,
	previewDrivingLicenceIntervalAction,
} from "@/lib/organization/driving-licence/interval-actions";
import type { DrivingLicenceIntervalPreview } from "@/lib/organization/driving-licence/policy-intervals";
export function DrivingLicenceIntervalSettings({
	intervalMonths,
}: {
	intervalMonths: number;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [preview, setPreview] = useState<DrivingLicenceIntervalPreview | null>(
		null,
	);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const [applying, startApply] = useTransition();
	const form = useForm({
		defaultValues: { intervalMonths },
		onSubmit: async ({ value }) => {
			setError("");
			setMessage("");
			setPreview(null);
			const result = await previewDrivingLicenceIntervalAction(value);
			if (result.success) {
				if (form.state.values.intervalMonths === value.intervalMonths)
					setPreview(result.data);
			} else
				setError(
					t(
						"drivingLicence.intervalPreviewError",
						"The impact could not be loaded. Check your access and choose an interval from 1 to 120 months.",
					),
				);
		},
	});
	function apply() {
		if (!preview) return;
		startApply(async () => {
			setError("");
			const result = await applyDrivingLicenceIntervalAction({
				intervalMonths: preview.intervalMonths,
				previewToken: preview.previewToken,
			});
			setPreview(null);
			if (!result.success) {
				setError(
					t(
						"drivingLicence.intervalStale",
						"The policy or driving authorization changed, or your access is unavailable. Preview the current impact again before applying.",
					),
				);
				return;
			}
			setMessage(
				t(
					"drivingLicence.intervalApplied",
					"Interval applied. Existing suspensions remain in effect.",
				),
			);
			router.refresh();
		});
	}
	return (
		<section
			aria-labelledby="driving-interval-title"
			className="mt-8 space-y-4 border-t pt-6"
		>
			<h3 id="driving-interval-title" className="font-semibold">
				{t("drivingLicence.intervalChangeTitle", "Change the routine interval")}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.intervalChangeHelp",
					"Preview each class's recalculated dates before applying. Earlier document and class limits still apply. Extending the interval never reinstates a suspended authorization.",
				)}
			</p>
			<form
				className="flex flex-wrap items-end gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					void form.handleSubmit();
				}}
			>
				<form.Field name="intervalMonths">
					{(field) => (
						<TFormItem className="w-full sm:w-64">
							<TFormLabel>
								{t(
									"drivingLicence.newInterval",
									"New routine interval (months)",
								)}
							</TFormLabel>
							<TFormControl>
								<Input
									autoComplete="off"
									type="number"
									min={1}
									max={120}
									step={1}
									required
									name={field.name}
									value={field.state.value}
									disabled={applying}
									onBlur={field.handleBlur}
									onChange={(event) => {
										field.handleChange(Number(event.target.value));
										setPreview(null);
										setError("");
										setMessage("");
									}}
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"drivingLicence.intervalAnchorHelp",
									"Calculated from each class's last successful check.",
								)}
							</TFormDescription>
						</TFormItem>
					)}
				</form.Field>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(submitting) => (
						<Button
							type="submit"
							variant="outline"
							disabled={submitting || applying}
						>
							{submitting
								? t("drivingLicence.previewingInterval", "Loading impact…")
								: t(
										"drivingLicence.previewInterval",
										"Preview interval impact",
									)}
						</Button>
					)}
				</form.Subscribe>
			</form>
			{preview ? (
				<section
					className="space-y-4 rounded-md border p-4"
					aria-live="polite"
					aria-label={t("drivingLicence.intervalImpact", "Interval impact")}
				>
					<p className="text-sm font-medium">
						{t(
							"drivingLicence.intervalImpactHelp",
							"Review the new routine date and the earlier effective limit for every affected class. Dates use the stated calendar timezone.",
						)}
					</p>
					{preview.classes.length ? (
						<ul className="divide-y">
							{preview.classes.map((row) => (
								<li
									key={`${row.employeeId}:${row.classCode}`}
									className="min-w-0 break-words space-y-1 py-3 text-sm [content-visibility:auto] [contain-intrinsic-size:auto_100px]"
								>
									<p className="font-medium">
										{row.employeeName} · {row.classCode}
									</p>
									<p>
										{t("drivingLicence.newRoutineDate", "Next routine check")}:{" "}
										<time dateTime={row.routineValidThrough}>
											{row.routineValidThrough}
										</time>
									</p>
									{row.validThrough !== row.routineValidThrough ? (
										<p>
											{t(
												"drivingLicence.earlierLimit",
												"Earlier document/class limit",
											)}
											:{" "}
											<time dateTime={row.validThrough}>
												{row.validThrough}
											</time>
										</p>
									) : null}
									<p className="text-muted-foreground">
										{row.deadlineTimezone}
									</p>
									<p
										className={
											row.newlyOverdue
												? "font-medium text-destructive"
												: "text-muted-foreground"
										}
									>
										{row.newlyOverdue
											? t(
													"drivingLicence.newlyOverdue",
													"Newly overdue — will be suspended",
												)
											: row.remainsSuspended
												? t(
														"drivingLicence.staysSuspended",
														"Remains suspended",
													)
												: t("drivingLicence.staysCurrent", "Remains current")}
									</p>
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm">
							{t(
								"drivingLicence.noIntervalClasses",
								"No existing class authorizations need recalculation.",
							)}
						</p>
					)}
					<Button type="button" disabled={applying} onClick={apply}>
						{applying
							? t("drivingLicence.applyingInterval", "Applying…")
							: t("drivingLicence.applyInterval", "Apply interval change")}
					</Button>
				</section>
			) : null}
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			{message ? (
				<p role="status" className="text-sm">
					{message}
				</p>
			) : null}
		</section>
	);
}
