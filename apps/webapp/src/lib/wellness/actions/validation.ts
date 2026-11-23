import { Effect } from "effect";
import type { z } from "zod";
import { ValidationError } from "@/lib/effect/errors";
import {
	type LogWaterIntakeFormValues,
	logWaterIntakeSchema,
	type WaterReminderSettingsFormValues,
	waterReminderSettingsSchema,
} from "@/lib/validations/wellness";

function validateSchema<TSchema extends z.ZodTypeAny>(params: {
	schema: TSchema;
	data: unknown;
	defaultMessage: string;
	field: string;
}) {
	const result = params.schema.safeParse(params.data);
	if (result.success) {
		return Effect.succeed(result.data);
	}

	return Effect.fail(
		new ValidationError({
			message: result.error.issues[0]?.message ?? params.defaultMessage,
			field: params.field,
		}),
	);
}

export function validateLogWaterIntake(data: LogWaterIntakeFormValues) {
	return validateSchema({
		schema: logWaterIntakeSchema,
		data,
		defaultMessage: "Invalid input",
		field: "amount",
	});
}

export function validateWaterReminderSettings(data: WaterReminderSettingsFormValues) {
	return validateSchema({
		schema: waterReminderSettingsSchema,
		data,
		defaultMessage: "Invalid settings",
		field: "settings",
	});
}
