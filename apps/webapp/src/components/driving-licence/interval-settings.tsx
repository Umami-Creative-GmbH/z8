"use client";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
import { queryKeys } from "@/lib/query";

/** Changing the routine interval: preview every affected class, then apply that preview. */
export function DrivingLicenceIntervalSettings({ intervalMonths }: { intervalMonths: number }) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [preview, setPreview] = useState<DrivingLicenceIntervalPreview | null>(null);
	const [applying, startApply] = useTransition();
	const form = useForm({
		defaultValues: { intervalMonths },
		onSubmit: async ({ value }) => {
			setPreview(null);
			const result = await previewDrivingLicenceIntervalAction(value);
			if (result.success) {
				if (form.state.values.intervalMonths === value.intervalMonths) setPreview(result.data);
			} else
				toast.error(
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
			const result = await applyDrivingLicenceIntervalAction({
				intervalMonths: preview.intervalMonths,
				previewToken: preview.previewToken,
			});
			setPreview(null);
			if (!result.success) {
				toast.error(
					t(
						"drivingLicence.intervalStale",
						"The policy or driving authorization changed, or your access is unavailable. Preview the current impact again before applying.",
					),
				);
				return;
			}
			toast.success(
				t(
					"drivingLicence.intervalApplied",
					"Interval applied. Existing suspensions remain in effect.",
				),
			);
			void queryClient.invalidateQueries({
				queryKey: queryKeys.drivingLicence.status,
			});
			router.refresh();
		});
	}
	return (
		<section aria-labelledby="driving-interval-title" className="space-y-4">
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
								{t("drivingLicence.newInterval", "New routine interval (months)")}
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
						<Button type="submit" variant="outline" disabled={submitting || applying}>
							{submitting
								? t("drivingLicence.previewingInterval", "Loading impact…")
								: t("drivingLicence.previewInterval", "Preview interval impact")}
						</Button>
					)}
				</form.Subscribe>
			</form>
			{preview ? <IntervalImpact preview={preview} applying={applying} onApply={apply} /> : null}
		</section>
	);
}

function IntervalImpact({
	preview,
	applying,
	onApply,
}: {
	preview: DrivingLicenceIntervalPreview;
	applying: boolean;
	onApply: () => void;
}) {
	const { t } = useTranslate();
	return (
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
				<Table mobileLayout="stacked">
					<TableHeader>
						<TableRow>
							<TableHead>
								{t("drivingLicence.settingsTabs.impactClass", "Employee and class")}
							</TableHead>
							<TableHead>{t("drivingLicence.newRoutineDate", "Next routine check")}</TableHead>
							<TableHead>
								{t("drivingLicence.earlierLimit", "Earlier document/class limit")}
							</TableHead>
							<TableHead>{t("drivingLicence.settingsTabs.impactTimezone", "Timezone")}</TableHead>
							<TableHead>{t("drivingLicence.settingsTabs.impactResult", "Result")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{preview.classes.map((row) => (
							<TableRow key={`${row.employeeId}:${row.classCode}`}>
								<TableCell className="font-medium whitespace-normal break-words">
									{row.employeeName} · {row.classCode}
								</TableCell>
								<TableCell>
									<time dateTime={row.routineValidThrough}>{row.routineValidThrough}</time>
								</TableCell>
								<TableCell>
									{row.validThrough !== row.routineValidThrough ? (
										<time dateTime={row.validThrough}>{row.validThrough}</time>
									) : (
										"—"
									)}
								</TableCell>
								<TableCell className="text-muted-foreground">{row.deadlineTimezone}</TableCell>
								<TableCell
									className={
										row.newlyOverdue
											? "font-medium whitespace-normal text-destructive"
											: "whitespace-normal text-muted-foreground"
									}
								>
									{row.newlyOverdue
										? t("drivingLicence.newlyOverdue", "Newly overdue — will be suspended")
										: row.remainsSuspended
											? t("drivingLicence.staysSuspended", "Remains suspended")
											: t("drivingLicence.staysCurrent", "Remains current")}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			) : (
				<p className="text-sm">
					{t(
						"drivingLicence.noIntervalClasses",
						"No existing class authorizations need recalculation.",
					)}
				</p>
			)}
			<Button type="button" disabled={applying} onClick={onApply}>
				{applying
					? t("drivingLicence.applyingInterval", "Applying…")
					: t("drivingLicence.applyInterval", "Apply interval change")}
			</Button>
		</section>
	);
}
