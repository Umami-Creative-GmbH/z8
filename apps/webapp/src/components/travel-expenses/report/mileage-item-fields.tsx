"use client";

import { useTranslate } from "@tolgee/react";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { MAX_ROUTE_LENGTH, MILEAGE_VEHICLES } from "@/lib/travel-expenses/mileage";
import { MAX_ACCOUNTING_REFERENCE_LENGTH } from "@/lib/travel-expenses/receipt-report";
import type { MileageFieldName, MileageItemForm } from "./mileage-item-form";
import { vehicleLabel } from "./mileage-labels";

/** The entered facts of one drive: date, distance, route, vehicle and accounting reference. */
export function MileageItemFields({
	form,
	fieldError,
}: {
	form: MileageItemForm;
	/** The message of a malformed field, if any. */
	fieldError: (field: MileageFieldName) => string | undefined;
}) {
	const { t } = useTranslate();
	return (
		<>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name="expenseDate">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={!!fieldError("expenseDate")}>
								{t("travelExpenses.report.mileage.fields.date", "Date of the drive")}
							</TFormLabel>
							<TFormControl hasError={!!fieldError("expenseDate")}>
								<DatePicker
									name="expenseDate"
									value={field.state.value}
									onChange={field.handleChange}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage>{fieldError("expenseDate")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>

				<form.Field name="distanceKm">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={!!fieldError("distanceKm")}>
								{t("travelExpenses.report.mileage.fields.distance", "Kilometres driven")}
							</TFormLabel>
							<TFormControl hasError={!!fieldError("distanceKm")}>
								<Input
									name="distanceKm"
									inputMode="decimal"
									autoComplete="off"
									placeholder="0.0"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage>{fieldError("distanceKm")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
			</div>

			<form.Field name="route">
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={!!fieldError("route")}>
							{t("travelExpenses.report.mileage.fields.route", "Route")}
						</TFormLabel>
						<TFormControl hasError={!!fieldError("route")}>
							<Input
								name="route"
								autoComplete="off"
								maxLength={MAX_ROUTE_LENGTH}
								placeholder={t(
									"travelExpenses.report.mileage.fields.routePlaceholder",
									"e.g. Office Berlin – customer Potsdam – back",
								)}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage>{fieldError("route")}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>

			<form.Field name="vehicle">
				{(field) => (
					<TFormItem>
						<RadioGroup
							aria-label={t("travelExpenses.report.mileage.fields.vehicle", "Vehicle")}
							value={field.state.value}
							onValueChange={(value) => field.handleChange(value)}
							className="gap-2"
						>
							<p
								className="text-sm font-medium data-[error=true]:text-destructive"
								data-error={!!fieldError("vehicle")}
							>
								{t("travelExpenses.report.mileage.fields.vehicle", "Vehicle")}
							</p>
							<div className="flex flex-wrap gap-x-6 gap-y-2">
								{MILEAGE_VEHICLES.map((vehicle) => (
									<Label key={vehicle} className="flex items-center gap-2 font-normal">
										<RadioGroupItem value={vehicle} />
										{vehicleLabel(t, vehicle)}
									</Label>
								))}
							</div>
						</RadioGroup>
						<TFormDescription>
							{t(
								"travelExpenses.report.mileage.fields.vehicleDescription",
								"Your own vehicle. Company cars and public transport are not mileage; add their receipts instead.",
							)}
						</TFormDescription>
						<TFormMessage>{fieldError("vehicle")}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>

			<form.Field name="accountingReference">
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={!!fieldError("accountingReference")}>
							{t(
								"travelExpenses.report.fields.accountingReference",
								"Accounting reference (optional)",
							)}
						</TFormLabel>
						<TFormControl hasError={!!fieldError("accountingReference")}>
							<Input
								name="accountingReference"
								autoComplete="off"
								maxLength={MAX_ACCOUNTING_REFERENCE_LENGTH}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage>{fieldError("accountingReference")}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
		</>
	);
}
