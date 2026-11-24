"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import type { CompensationBasis, DayUnitRuleKind } from "@/lib/contractor-compensation/terms";
import { DAY_UNIT_RULE_OPTIONS } from "./contractor-compensation-form-values";

/**
 * The contractor compensation fields (#1998) shared by the compensation card's
 * terms form and the External Contractor invitation. Each takes the TanStack
 * field its form renders it for.
 */

interface SelectFieldLike<TValue> {
	state: { value: TValue };
	handleChange: (value: TValue) => void;
}

interface InputFieldLike<TValue> {
	state: { value: TValue; meta: { errors: unknown[] } };
	handleChange: (value: TValue) => void;
	handleBlur: () => void;
}

/** Whether the rate is per day or per hour. */
export function CompensationBasisField({ field }: { field: SelectFieldLike<CompensationBasis> }) {
	const { t } = useTranslate();
	return (
		<TFormItem>
			<TFormLabel>{t("settings.contracts.contractors.basis", "Paid by")}</TFormLabel>
			<Select
				value={field.state.value}
				onValueChange={(value) => value && field.handleChange(value as CompensationBasis)}
			>
				<TFormControl>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
				</TFormControl>
				<SelectContent>
					<SelectItem value="daily">
						{t("settings.contracts.contractors.basisDaily", "Day")}
					</SelectItem>
					<SelectItem value="hourly">
						{t("settings.contracts.contractors.basisHourly", "Hour")}
					</SelectItem>
				</SelectContent>
			</Select>
		</TFormItem>
	);
}

/** The rate's three-letter currency, entered in upper case. */
export function CompensationCurrencyField({ field }: { field: InputFieldLike<string> }) {
	const { t } = useTranslate();
	return (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)}>
				{t("settings.contracts.contractors.currency", "Currency")}
			</TFormLabel>
			<TFormControl hasError={fieldHasError(field)}>
				<Input
					autoComplete="off"
					maxLength={3}
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
					onBlur={field.handleBlur}
					className="uppercase"
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}

/** The daily or hourly rate, labelled by the chosen `basis`. */
export function CompensationRateField({
	field,
	basis,
}: {
	field: InputFieldLike<string>;
	basis: CompensationBasis;
}) {
	const { t } = useTranslate();
	return (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)}>
				{basis === "daily"
					? t("settings.contracts.contractors.dailyRate", "Daily rate")
					: t("settings.contracts.contractors.hourlyRate", "Hourly rate")}
			</TFormLabel>
			<TFormControl hasError={fieldHasError(field)}>
				<Input
					inputMode="decimal"
					autoComplete="off"
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					onBlur={field.handleBlur}
					className="tabular-nums"
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}

/** How worked days are counted, with the hint of the chosen `rule`. */
export function DayUnitRuleField({
	field,
	rule,
}: {
	field: SelectFieldLike<DayUnitRuleKind>;
	rule: DayUnitRuleKind;
}) {
	const { t } = useTranslate();
	return (
		<TFormItem>
			<TFormLabel>{t("settings.contracts.contractors.dayUnitRule", "How days are counted")}</TFormLabel>
			<Select
				value={field.state.value}
				onValueChange={(value) => value && field.handleChange(value as DayUnitRuleKind)}
			>
				<TFormControl>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
				</TFormControl>
				<SelectContent>
					{DAY_UNIT_RULE_OPTIONS.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{t(option.labelKey, option.label)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<TFormDescription>
				{DAY_UNIT_RULE_OPTIONS.filter((option) => option.value === rule).map((option) =>
					t(option.hintKey, option.hint),
				)}
			</TFormDescription>
		</TFormItem>
	);
}

export function MinutesField({
	field,
	label,
}: {
	field: InputFieldLike<string>;
	label: ReactNode;
}) {
	return (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)}>{label}</TFormLabel>
			<TFormControl hasError={fieldHasError(field)}>
				{/* No native min/max: the browser would block the submit before the form words the range. */}
				<Input
					inputMode="numeric"
					autoComplete="off"
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					onBlur={field.handleBlur}
					className="tabular-nums"
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}

/** Whether a prorated day counts as at most one day. */
export function CapAtOneDayField({ field }: { field: SelectFieldLike<boolean> }) {
	const { t } = useTranslate();
	return (
		<TFormItem className="flex flex-row items-center gap-3 sm:pt-7">
			<TFormControl>
				<Switch
					checked={field.state.value}
					onCheckedChange={(checked) => field.handleChange(checked)}
				/>
			</TFormControl>
			<TFormLabel>
				{t("settings.contracts.contractors.capAtOneDay", "At most one day per day")}
			</TFormLabel>
		</TFormItem>
	);
}
