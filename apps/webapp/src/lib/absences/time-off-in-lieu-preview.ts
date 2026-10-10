import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";

type DayPeriod = "full_day" | "am" | "pm";

export interface TimeOffInLieuAbsence {
	/** Logical local dates, `YYYY-MM-DD`. */
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
}

/** What an absence that draws on the work balance would leave of it (#1000). */
export interface TimeOffInLieuPreview {
	currentBalanceMinutes: number;
	/** Required time the absence still takes from the balance. */
	drawnMinutes: number;
	projectedBalanceMinutes: number;
	/** A warning only: such a request is never refused for it. */
	wouldBeNegative: boolean;
}

/** The share of a day the absence takes: half on a first afternoon or a last morning. */
function absenceDayFraction(absence: TimeOffInLieuAbsence, date: string): number {
	if (absence.startDate === absence.endDate) {
		if (absence.startPeriod === "full_day" || absence.endPeriod === "full_day") return 1;
		return absence.startPeriod === absence.endPeriod ? 0.5 : 1;
	}
	if (date === absence.startDate) return absence.startPeriod === "pm" ? 0.5 : 1;
	if (date === absence.endDate) return absence.endPeriod === "am" ? 0.5 : 1;
	return 1;
}

/**
 * The work balance after an absence of time off in lieu. Its days keep their required
 * time: the employee works none of a full day and half of a half day, so the balance
 * falls by the required time of the share taken. Days up to the day the balance was
 * computed through already count in it and are not drawn again. Work and required time
 * of other days before the absence are not projected.
 */
export function previewTimeOffInLieu(input: {
	balance: { balanceMinutes: number; computedThroughDate: string } | null;
	absence: TimeOffInLieuAbsence;
	/** Required time of the absence's local days, keyed `YYYY-MM-DD`. */
	requiredMinutesByDate: Readonly<Record<string, number>>;
}): TimeOffInLieuPreview | null {
	if (!input.balance) return null;

	const countedThrough = parsePlainDate(input.balance.computedThroughDate);
	const last = parsePlainDate(input.absence.endDate);
	let drawnMinutes = 0;
	for (
		let day = parsePlainDate(input.absence.startDate);
		comparePlainDates(day, last) <= 0;
		day = day.add({ days: 1 })
	) {
		if (comparePlainDates(day, countedThrough) <= 0) continue;
		const date = day.toString();
		const required = input.requiredMinutesByDate[date] ?? 0;
		drawnMinutes += Math.round(required * absenceDayFraction(input.absence, date));
	}

	const projectedBalanceMinutes = input.balance.balanceMinutes - drawnMinutes;
	return {
		currentBalanceMinutes: input.balance.balanceMinutes,
		drawnMinutes,
		projectedBalanceMinutes,
		wouldBeNegative: projectedBalanceMinutes < 0,
	};
}
