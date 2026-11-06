import { z } from "zod";
import { compareInstants, parseInstant } from "@/lib/datetime/temporal-core";

export const correctionOverlapSchema = z.object({
	kind: z.enum(["work_period", "time_record"]),
	id: z.string().min(1),
	startAt: z.iso.datetime(),
	endAt: z.iso.datetime().nullable(),
});
export const correctionOverlapsSchema = z
	.array(correctionOverlapSchema)
	.max(200);
export type CorrectionOverlap = z.infer<typeof correctionOverlapSchema>;
export interface CorrectionRange {
	startAt: string;
	endAt: string;
}

/** Subtract occupied half-open intervals; retain the longest available stretch.
 * Never joins across a break or moves outside the employee's requested range. */
export function fitCorrectionRange(
	requested: CorrectionRange,
	overlaps: readonly CorrectionOverlap[],
): CorrectionRange | null {
	const start = parseInstant(requested.startAt);
	const end = parseInstant(requested.endAt);
	if (compareInstants(start, end) >= 0) return null;
	let free = [{ start, end }];
	for (const overlap of overlaps) {
		const occupiedStart = parseInstant(overlap.startAt);
		const occupiedEnd = overlap.endAt ? parseInstant(overlap.endAt) : end;
		if (compareInstants(occupiedStart, occupiedEnd) >= 0) continue;
		free = free.flatMap((range) => {
			if (
				compareInstants(occupiedStart, range.end) >= 0 ||
				compareInstants(occupiedEnd, range.start) <= 0
			)
				return [range];
			return [
				...(compareInstants(range.start, occupiedStart) < 0
					? [{ start: range.start, end: occupiedStart }]
					: []),
				...(compareInstants(occupiedEnd, range.end) < 0
					? [{ start: occupiedEnd, end: range.end }]
					: []),
			];
		});
	}
	const longest = free.reduce<(typeof free)[number] | null>(
		(best, range) =>
			!best ||
			range.end.epochNanoseconds - range.start.epochNanoseconds >
				best.end.epochNanoseconds - best.start.epochNanoseconds
				? range
				: best,
		null,
	);
	return longest
		? { startAt: longest.start.toString(), endAt: longest.end.toString() }
		: null;
}
