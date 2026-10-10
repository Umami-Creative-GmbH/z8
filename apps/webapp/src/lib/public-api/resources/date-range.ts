import { Temporal } from "temporal-polyfill";
import { z } from "zod";

/** The longest `from`/`to` range a Public API list accepts (#763). */
export const MAX_RANGE_DAYS = 366;

/** Required `from`/`to` instants, `from` before `to`, at most 366 days apart. */
export const instantRangeShape = {
	from: z.iso
		.datetime({ offset: true })
		.describe("Start of the range, inclusive. An ISO 8601 instant with offset or `Z`."),
	to: z.iso
		.datetime({ offset: true })
		.describe("End of the range, exclusive. At most 366 days after `from`."),
};

/** Required `from`/`to` local dates, both inclusive, at most 366 days apart. */
export const dateRangeShape = {
	from: z.iso.date().describe("First day of the range, inclusive (YYYY-MM-DD)."),
	to: z.iso
		.date()
		.describe("Last day of the range, inclusive (YYYY-MM-DD). At most 366 days after `from`."),
};

function refuse(ctx: z.RefinementCtx, message: string) {
	ctx.addIssue({ code: "custom", path: ["to"], message });
}

const TOO_LONG = `The range may span at most ${MAX_RANGE_DAYS} days`;

/** The parsed value; null when the field itself is invalid (its own issue says so). */
function parsed<T>(parse: () => T): T | null {
	try {
		return parse();
	} catch {
		return null;
	}
}

export function checkInstantRange(value: { from: string; to: string }, ctx: z.RefinementCtx) {
	const from = parsed(() => Temporal.Instant.from(value.from));
	const to = parsed(() => Temporal.Instant.from(value.to));
	if (!from || !to) return;
	if (Temporal.Instant.compare(to, from) <= 0) return refuse(ctx, "`to` must be after `from`");
	if (Temporal.Instant.compare(to, from.add({ hours: MAX_RANGE_DAYS * 24 })) > 0) {
		refuse(ctx, TOO_LONG);
	}
}

export function checkDateRange(value: { from: string; to: string }, ctx: z.RefinementCtx) {
	const from = parsed(() => Temporal.PlainDate.from(value.from, { overflow: "reject" }));
	const to = parsed(() => Temporal.PlainDate.from(value.to, { overflow: "reject" }));
	if (!from || !to) return;
	if (Temporal.PlainDate.compare(to, from) < 0) {
		return refuse(ctx, "`to` must not be before `from`");
	}
	if (from.until(to, { largestUnit: "days" }).days > MAX_RANGE_DAYS) refuse(ctx, TOO_LONG);
}

/** An instant parameter as the UTC ISO string the database compares with. */
export const utcIso = (value: string) => Temporal.Instant.from(value).toString();
