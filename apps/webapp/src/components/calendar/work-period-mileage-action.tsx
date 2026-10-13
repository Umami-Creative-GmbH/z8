"use client";

import { IconLoader2, IconReceipt } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import type { TFnType } from "@tolgee/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	addWorkPeriodMileageAction,
	getWorkPeriodMileageAction,
} from "@/app/[locale]/(app)/travel-expenses/work-period-mileage-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";
import { queryKeys } from "@/lib/query/keys";
import type { WorkMileageTripChoice } from "@/lib/travel-expenses/work-period-mileage";
import { Link, useRouter } from "@/navigation";

/** The form value for "a new standalone mileage report". */
const NEW_REPORT = "new";

function reportPath(reportId: string) {
	return `/travel-expenses/reports/${reportId}`;
}

function tripLabel(trip: WorkMileageTripChoice, locale: string, t: TFnType): string {
	const purpose =
		trip.purpose?.trim() ||
		t("timeTracking.vehicleUse.expenseReport.untitledTrip", "Untitled trip");
	if (!trip.startDate || !trip.endDate) return purpose;
	const dates = formatPlainDateRange(
		Temporal.PlainDate.from(trip.startDate),
		Temporal.PlainDate.from(trip.endDate),
		locale,
		"dateMedium",
	);
	return `${purpose} · ${dates}`;
}

function AddForm({
	workPeriodId,
	distanceKm,
	trips,
	locale,
	onCancel,
	t,
}: {
	workPeriodId: string;
	distanceKm: number;
	trips: WorkMileageTripChoice[];
	locale: string;
	onCancel: () => void;
	t: TFnType;
}) {
	const id = useId();
	const router = useRouter();
	const form = useForm({
		defaultValues: { target: NEW_REPORT },
		onSubmit: async ({ value }) => {
			const result = await addWorkPeriodMileageAction({
				workPeriodId,
				reportId: value.target === NEW_REPORT ? null : value.target,
			}).catch(() => null);
			if (result?.success && result.data.status === "added") {
				router.push(reportPath(result.data.reportId));
				return;
			}
			toast.error(
				result?.success
					? t(
							"timeTracking.vehicleUse.expenseReport.alreadyAdded",
							"This work's distance is already in an expense report.",
						)
					: t(
							"timeTracking.vehicleUse.expenseReport.failed",
							"The distance could not be added to the expense report. Please retry.",
						),
			);
		},
	});

	return (
		<form
			className="mt-2 space-y-2 rounded-md border p-3"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field name="target">
				{(field) => (
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">
							{t(
								"timeTracking.vehicleUse.expenseReport.chooseReport",
								"Add to which expense report?",
							)}
						</legend>
						<RadioGroup
							value={field.state.value}
							onValueChange={(next) => field.handleChange(next)}
							className="gap-2"
						>
							<div className="flex items-center gap-2">
								<RadioGroupItem id={`${id}-${NEW_REPORT}`} value={NEW_REPORT} />
								<Label htmlFor={`${id}-${NEW_REPORT}`} className="font-normal">
									{t("timeTracking.vehicleUse.expenseReport.newReport", "New mileage report")}
								</Label>
							</div>
							{trips.map((trip) => (
								<div key={trip.id} className="flex items-center gap-2">
									<RadioGroupItem id={`${id}-${trip.id}`} value={trip.id} />
									<Label htmlFor={`${id}-${trip.id}`} className="font-normal">
										{tripLabel(trip, locale, t)}
									</Label>
								</div>
							))}
						</RadioGroup>
						<p className="text-xs text-muted-foreground">
							{t(
								"timeTracking.vehicleUse.expenseReport.routeHint",
								"The date and distance are filled in from this work. You enter the route in the report.",
							)}
						</p>
					</fieldset>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<div className="flex gap-2">
						<Button type="submit" size="sm" disabled={isSubmitting} className="flex-1">
							{isSubmitting ? (
								<IconLoader2 className="mr-1 size-4 animate-spin" aria-hidden="true" />
							) : null}
							{t("timeTracking.vehicleUse.expenseReport.add", "Add {distance} km", {
								distance: distanceKm.toLocaleString(locale),
							})}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={onCancel}
							disabled={isSubmitting}
						>
							{t("common.cancel", "Cancel")}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}

/**
 * "Add to expense report" on the employee's own-vehicle work (#1131, spec
 * #807): a mileage item pre-filled with the work's date and driven distance,
 * in a draft trip or a new standalone mileage report. Once the distance is in
 * an expense report, the action gives way to a link to it.
 */
export function WorkPeriodMileageAction({
	workPeriodId,
	locale,
	t,
}: {
	workPeriodId: string;
	locale: string;
	t: TFnType;
}) {
	const [adding, setAdding] = useState(false);
	const { data } = useQuery({
		queryKey: queryKeys.calendar.workPeriodMileage(workPeriodId),
		queryFn: async () => {
			const result = await getWorkPeriodMileageAction(workPeriodId);
			return result.success ? result.data : null;
		},
		staleTime: 0,
	});

	if (data?.status === "added") {
		return data.reportId ? (
			<Link
				href={reportPath(data.reportId)}
				className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
			>
				<IconReceipt className="size-3.5" aria-hidden="true" />
				{t("timeTracking.vehicleUse.expenseReport.added", "In an expense report")}
			</Link>
		) : null;
	}
	if (data?.status !== "available") return null;
	if (!adding) {
		return (
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="mt-2"
				onClick={() => setAdding(true)}
			>
				<IconReceipt className="mr-1 size-4" aria-hidden="true" />
				{t("timeTracking.vehicleUse.expenseReport.action", "Add to expense report")}
			</Button>
		);
	}
	return (
		<AddForm
			workPeriodId={workPeriodId}
			distanceKm={data.distanceKm}
			trips={data.trips}
			locale={locale}
			onCancel={() => setAdding(false)}
			t={t}
		/>
	);
}
