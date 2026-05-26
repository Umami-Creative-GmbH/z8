import { DateTime } from "luxon";
import type {
	TravelExpensePolicyData,
	UpsertTravelExpensePolicyInput,
} from "@/app/[locale]/(app)/settings/travel-expenses/actions";

export interface TravelExpensePolicyFormValues {
	effectiveFrom: string;
	effectiveTo: string;
	currency: string;
	mileageRatePerKm: string;
	perDiemRatePerDay: string;
	isActive: boolean;
}

function toDateInputValue(value: Date | string | null): string {
	if (!value) {
		return "";
	}

	if (value instanceof Date) {
		const dt = DateTime.fromJSDate(value);
		return dt.isValid ? dt.toFormat("yyyy-LL-dd") : "";
	}

	const dt = DateTime.fromISO(value);
	return dt.isValid ? dt.toFormat("yyyy-LL-dd") : "";
}

function toNumberInputValue(value: string | null): string {
	if (value === null) {
		return "";
	}

	const amount = Number(value);
	return Number.isFinite(amount) ? String(amount) : "";
}

export function getTravelExpensePolicyFormValues(
	policy: TravelExpensePolicyData | null,
): TravelExpensePolicyFormValues {
	if (!policy) {
		return {
			effectiveFrom: "",
			effectiveTo: "",
			currency: "EUR",
			mileageRatePerKm: "",
			perDiemRatePerDay: "",
			isActive: true,
		};
	}

	return {
		effectiveFrom: toDateInputValue(policy.effectiveFrom),
		effectiveTo: toDateInputValue(policy.effectiveTo),
		currency: policy.currency,
		mileageRatePerKm: toNumberInputValue(policy.mileageRatePerKm),
		perDiemRatePerDay: toNumberInputValue(policy.perDiemRatePerDay),
		isActive: policy.isActive,
	};
}

export function normalizePolicyFormValues(
	values: TravelExpensePolicyFormValues,
): Omit<UpsertTravelExpensePolicyInput, "id"> {
	const effectiveFrom = DateTime.fromISO(values.effectiveFrom).startOf("day").toJSDate();
	const effectiveToValue = values.effectiveTo.trim();
	const mileageValue = values.mileageRatePerKm.trim();
	const perDiemValue = values.perDiemRatePerDay.trim();

	return {
		effectiveFrom,
		effectiveTo: effectiveToValue
			? DateTime.fromISO(effectiveToValue).startOf("day").toJSDate()
			: null,
		currency: values.currency.trim().toUpperCase(),
		mileageRatePerKm: mileageValue === "" ? undefined : Number(mileageValue),
		perDiemRatePerDay: perDiemValue === "" ? undefined : Number(perDiemValue),
		isActive: values.isActive,
	};
}
