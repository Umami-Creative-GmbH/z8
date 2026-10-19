"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { mapCsvWorkAction } from "@/app/[locale]/(app)/settings/import/csv-actions";
import { Button } from "@/components/ui/button";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import type { CsvWorkReviewData } from "./csv-work-review";

interface MappingValues {
	kind: "employee" | "vehicle";
	sourceValue: string;
	targetId: string;
}
const defaults: MappingValues = {
	kind: "employee",
	sourceValue: "",
	targetId: "",
};
const selectClass =
	"h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function CsvWorkMapping({
	organizationId,
	batchId,
	view,
	disabled,
	onSuccess,
	onError,
}: {
	organizationId: string;
	batchId: string;
	view: CsvWorkReviewData;
	disabled: boolean;
	onSuccess: () => void;
	onError: (message: string) => void;
}) {
	const { t } = useTranslate();
	const labelId = useId();
	const form = useForm({
		defaultValues: defaults,
		onSubmit: async ({ value }) => {
			const result = await mapCsvWorkAction({
				organizationId,
				batchId,
				...value,
			});
			if (result.success) {
				form.reset();
				onSuccess();
			} else onError(result.error);
		},
	});
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
			className="space-y-3 rounded-md border p-4"
		>
			<h2 className="text-sm font-semibold">
				{t(
					"settings.import.csv.mappingTitle",
					"Map source values to existing records",
				)}
			</h2>
			<form.Subscribe
				selector={(state) => ({
					values: state.values,
					submitting: state.isSubmitting,
				})}
			>
				{({ values, submitting }) => {
					const sources = [
						...new Set(
							view.rows
								.filter(
									(row) =>
										row.rowStatus !== "committed" &&
										row.rowStatus !== "rejected",
								)
								.flatMap((row) => {
									const source = row.sourcePayload.values;
									if (!source || typeof source !== "object") return [];
									const value = (source as Record<string, unknown>)[
										values.kind === "employee"
											? "personnel_number"
											: "licence_plate"
									];
									return typeof value === "string" && value.trim()
										? [value]
										: [];
								}),
						),
					];
					const targets =
						values.kind === "employee"
							? view.people.map((person) => ({
									id: person.id,
									label: `${person.name}${person.number ? ` · ${person.number}` : ""}`,
								}))
							: view.vehicles.map((vehicle) => ({
									id: vehicle.id,
									label: `${vehicle.name} · ${vehicle.licencePlate}`,
								}));
					return (
						<div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
							<TFormItem>
								<TFormLabel id={`${labelId}-kind`}>
									{t("settings.import.csv.mappingType", "Mapping type")}
								</TFormLabel>
								<TFormControl>
									<select
										aria-labelledby={`${labelId}-kind`}
										className={selectClass}
										disabled={disabled || submitting}
										value={values.kind}
										onChange={(event) => {
											form.setFieldValue(
												"kind",
												event.target.value === "vehicle"
													? "vehicle"
													: "employee",
											);
											form.setFieldValue("sourceValue", "");
											form.setFieldValue("targetId", "");
										}}
									>
										<option value="employee">
											{t("settings.import.csv.person", "Employee")}
										</option>
										<option value="vehicle">
											{t(
												"settings.import.csv.organizationVehicle",
												"Organization vehicle",
											)}
										</option>
									</select>
								</TFormControl>
							</TFormItem>
							<TFormItem>
								<TFormLabel id={`${labelId}-source`}>
									{t("settings.import.csv.sourceValue", "Source value")}
								</TFormLabel>
								<TFormControl>
									<select
										aria-labelledby={`${labelId}-source`}
										className={selectClass}
										disabled={disabled || submitting}
										value={values.sourceValue}
										onChange={(event) =>
											form.setFieldValue("sourceValue", event.target.value)
										}
									>
										<option value="">
											{t(
												"settings.import.csv.chooseSource",
												"Choose a source value",
											)}
										</option>
										{sources.map((value) => (
											<option key={value} value={value}>
												{value}
											</option>
										))}
									</select>
								</TFormControl>
							</TFormItem>
							<TFormItem>
								<TFormLabel id={`${labelId}-target`}>
									{values.kind === "employee"
										? t(
												"settings.import.csv.existingEmployee",
												"Existing employee",
											)
										: t(
												"settings.import.csv.existingVehicle",
												"Existing vehicle",
											)}
								</TFormLabel>
								<TFormControl>
									<select
										aria-labelledby={`${labelId}-target`}
										className={selectClass}
										disabled={disabled || submitting}
										value={values.targetId}
										onChange={(event) =>
											form.setFieldValue("targetId", event.target.value)
										}
									>
										<option value="">
											{t(
												"settings.import.csv.chooseTarget",
												"Choose an existing record",
											)}
										</option>
										{targets.map((target) => (
											<option key={target.id} value={target.id}>
												{target.label}
											</option>
										))}
									</select>
								</TFormControl>
							</TFormItem>
							<Button
								type="submit"
								disabled={
									disabled ||
									submitting ||
									!values.sourceValue ||
									!values.targetId
								}
							>
								{t("settings.import.csv.applyMapping", "Apply mapping")}
							</Button>
						</div>
					);
				}}
			</form.Subscribe>
			<p className="text-xs text-muted-foreground">
				{t(
					"settings.import.csv.mappingHelp",
					"Mappings apply only to this batch and retain the original source values. Changing a mapping or rechecking resets acceptance on uncommitted rows.",
				)}
			</p>
		</form>
	);
}
