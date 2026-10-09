"use client";

import { useTranslate } from "@tolgee/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	isRatedTaxTreatment,
	isTaxTreatmentKind,
	parseTaxTreatment,
	TAX_TREATMENT_KINDS,
	type TaxTreatmentKind,
} from "@/lib/billable-time/accounting/tax-treatment";
import type { TaxTreatmentView } from "@/lib/billable-time/accounting/views";

/** The label of a tax treatment kind. */
export function useTaxTreatmentLabel() {
	const { t } = useTranslate();
	return (kind: TaxTreatmentKind): string => {
		switch (kind) {
			case "domestic_standard":
				return t(
					"settings.billableTime.accounting.tax.domesticStandard",
					"Domestic, standard rate",
				);
			case "domestic_reduced":
				return t("settings.billableTime.accounting.tax.domesticReduced", "Domestic, reduced rate");
			case "eu_reverse_charge":
				return t("settings.billableTime.accounting.tax.euReverseCharge", "EU reverse charge");
			case "third_country_service":
				return t(
					"settings.billableTime.accounting.tax.thirdCountryService",
					"Service to a third country",
				);
			case "vat_free":
				return t("settings.billableTime.accounting.tax.vatFree", "VAT-free");
		}
	};
}

/** "Domestic, standard rate (19 %)" or "EU reverse charge". */
export function useTaxTreatmentSummary() {
	const { t } = useTranslate();
	const labelFor = useTaxTreatmentLabel();
	return (treatment: TaxTreatmentView): string =>
		isRatedTaxTreatment(treatment.kind)
			? t("settings.billableTime.accounting.tax.withRate", "{label} ({rate} %)", {
					label: labelFor(treatment.kind),
					rate: treatment.rate.includes(".")
						? treatment.rate.replace(/0+$/, "").replace(/\.$/, "")
						: treatment.rate,
				})
			: labelFor(treatment.kind);
}

const DEFAULT_RATES: Partial<Record<TaxTreatmentKind, string>> = {
	domestic_standard: "19",
	domestic_reduced: "7",
};

export const DEFAULT_TAX_TREATMENT: TaxTreatmentView = { kind: "domestic_standard", rate: "19" };

/** The validation message for a tax treatment, or undefined when it is valid. */
export function useTaxTreatmentError() {
	const { t } = useTranslate();
	return (value: TaxTreatmentView): string | undefined =>
		parseTaxTreatment(value).ok
			? undefined
			: t(
					"settings.billableTime.accounting.tax.invalid",
					"Enter a rate above 0 and at most 100 %, with at most two decimals",
				);
}

/**
 * A tax treatment kind and, for domestic treatments, its rate. Reverse charge,
 * third-country service and VAT-free drafts are always taxed at 0 %.
 */
export function TaxTreatmentFields({
	id,
	value,
	onChange,
	onBlur,
	disabled,
	hasError,
}: {
	id: string;
	value: TaxTreatmentView;
	onChange: (value: TaxTreatmentView) => void;
	onBlur?: () => void;
	disabled?: boolean;
	hasError?: boolean;
}) {
	const { t } = useTranslate();
	const labelFor = useTaxTreatmentLabel();
	const rated = isRatedTaxTreatment(value.kind);

	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
			<div className="flex-1 space-y-2">
				<Label htmlFor={`${id}-kind`}>
					{t("settings.billableTime.accounting.tax.kind", "Tax treatment")}
				</Label>
				<Select
					value={value.kind}
					disabled={disabled}
					onValueChange={(kind) => {
						if (!isTaxTreatmentKind(kind)) return;
						onChange({
							kind,
							rate: isRatedTaxTreatment(kind) ? (DEFAULT_RATES[kind] ?? value.rate) : "",
						});
					}}
				>
					<SelectTrigger id={`${id}-kind`} className="w-full" aria-invalid={hasError || undefined}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{TAX_TREATMENT_KINDS.map((kind) => (
							<SelectItem key={kind} value={kind}>
								{labelFor(kind)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{rated && (
				<div className="space-y-2 sm:w-32">
					<Label htmlFor={`${id}-rate`}>
						{t("settings.billableTime.accounting.tax.rate", "VAT rate")}
					</Label>
					<div className="relative">
						<Input
							id={`${id}-rate`}
							inputMode="decimal"
							autoComplete="off"
							value={value.rate}
							disabled={disabled}
							aria-invalid={hasError || undefined}
							onChange={(event) => onChange({ ...value, rate: event.target.value })}
							onBlur={onBlur}
							className="pr-8"
						/>
						<span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
							%
						</span>
					</div>
				</div>
			)}
		</div>
	);
}
