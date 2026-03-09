import type { MileageAmountInput, PerDiemAmountInput } from "./types";

function roundToCents(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateMileageAmount(input: MileageAmountInput): number {
	return roundToCents(input.kilometers * input.ratePerKm);
}

export function calculatePerDiemAmount(input: PerDiemAmountInput): number {
	return roundToCents(input.dayCount * input.dailyRate);
}
