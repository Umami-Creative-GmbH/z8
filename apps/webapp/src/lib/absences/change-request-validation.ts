import { z } from "zod";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import { AbsenceChangeError } from "./change-request-types";

const dayPeriod = z.enum(["full_day", "am", "pm"]);
const range = z
	.strictObject({
		startDate: z.string(),
		endDate: z.string(),
		startPeriod: dayPeriod,
		endPeriod: dayPeriod,
	})
	.superRefine((value, context) => {
		try {
			if (comparePlainDates(parsePlainDate(value.startDate), parsePlainDate(value.endDate)) > 0)
				context.addIssue({
					code: "custom",
					message: "End date must be on or after start date",
				});
			if (
				value.startDate === value.endDate &&
				value.startPeriod === "pm" &&
				value.endPeriod === "am"
			)
				context.addIssue({
					code: "custom",
					message: "An afternoon absence cannot end in the morning",
				});
		} catch {
			context.addIssue({
				code: "custom",
				message: "Enter valid dates in YYYY-MM-DD format",
			});
		}
	});
const common = {
	absenceId: z.uuid(),
	reason: z.string().trim().min(1, "A reason is required").max(2000),
};
export const absenceChangeInputSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		...common,
		kind: z.literal("change"),
		proposed: range,
		coverage: z.enum(["keep", "choose"]).default("keep"),
	}),
	z.strictObject({
		...common,
		kind: z.literal("cancel"),
		proposed: z.never().optional(),
	}),
]);

export function parseAbsenceChangeInput(input: unknown) {
	const parsed = absenceChangeInputSchema.safeParse(input);
	if (!parsed.success)
		throw new AbsenceChangeError(
			"invalid_input",
			parsed.error.issues[0]?.message ?? "Invalid absence change request",
		);
	return parsed.data;
}
