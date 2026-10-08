import { Temporal } from "temporal-polyfill";
export interface DayBasis {
	timezone: string;
	completedMinutesByDate: Record<string, number>;
	liveWork: { startedAt: string }[];
}
interface PendingInterval {
	kind: "clock_in" | "clock_out" | "break";
	occurredAt: string;
	command: string;
}
/** Uses employee calendar boundaries and UTC durations. Pending intervals are
 * estimates only; they never become confirmed work without a server receipt. */
export function todayTotal(
	basis: DayBasis,
	pending: readonly PendingInterval[],
	nowText: string,
): number | null {
	try {
		const now = Temporal.Instant.from(nowText);
		const day = now.toZonedDateTimeISO(basis.timezone);
		const midnight = day.startOfDay().toInstant();
		const nextMidnight = day.add({ days: 1 }).startOfDay().toInstant();
		let minutes =
			basis.completedMinutesByDate[day.toPlainDate().toString()] ?? 0;
		const overlap = (
			start: string,
			end: Temporal.Instant,
			completed: boolean,
		) => {
			let from = Temporal.Instant.from(start);
			if (Temporal.Instant.compare(from, midnight) < 0) from = midnight;
			const until =
				Temporal.Instant.compare(end, nextMidnight) > 0 ? nextMidnight : end;
			const duration = Math.max(
				0,
				from.until(until).total({ unit: "minutes" }),
			);
			return completed && Temporal.Instant.compare(end, nextMidnight) <= 0
				? Math.round(duration)
				: Math.floor(duration);
		};
		if (!pending.length) {
			for (const work of basis.liveWork)
				minutes += overlap(work.startedAt, now, false);
			return minutes;
		}
		if (basis.liveWork.length > 1) return null;
		let started: string | null = basis.liveWork[0]?.startedAt ?? null;
		for (const command of pending) {
			const at = Temporal.Instant.from(command.occurredAt);
			if (Temporal.Instant.compare(at, now) > 0) return null;
			if (command.kind === "clock_in") {
				if (started) return null;
				started = command.occurredAt;
			} else {
				if (!started) return null;
				const end =
					command.kind === "break"
						? Temporal.Instant.from(JSON.parse(command.command).breakStart.at)
						: at;
				if (Temporal.Instant.compare(end, Temporal.Instant.from(started)) < 0)
					return null;
				minutes += overlap(started, end, true);
				started = command.kind === "break" ? command.occurredAt : null;
			}
		}
		if (started) minutes += overlap(started, now, false);
		return minutes;
	} catch {
		return null;
	}
}
