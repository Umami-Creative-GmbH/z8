import "server-only";

import { Effect } from "effect";
import { DatabaseError, ValidationError } from "@/lib/effect/errors";
import { namedValueRefusalMessage } from "./refusal-messages";
import type { CustomFieldValuesInput } from "./value-rules";
import {
	CustomFieldValuesRefused,
	type CustomFieldWriter,
	type CustomFieldWriteScope,
	loadCustomFieldViewerLevel,
	writeCustomFieldValues,
} from "./values";

/**
 * Saves the custom field values a record's form sends (#818): the employee
 * detail save, the project dialog (incl. from a template) and the customer
 * dialog. Call it inside the save's transaction, after the record is written
 * and the actor's reach is checked. Every required field the actor may edit
 * must have a value afterwards (spec #769 decision D3), whatever the client
 * sent: `values` undefined (a form whose custom fields section didn't load)
 * writes nothing and checks the stored values. Saves that aren't a record's
 * form (archiving a project, provisioning) don't call this.
 */
export async function saveFormCustomFieldValues(
	tx: CustomFieldWriter,
	input: CustomFieldWriteScope & { values: CustomFieldValuesInput | undefined },
): Promise<void> {
	const level = await loadCustomFieldViewerLevel(tx, {
		organizationId: input.organizationId,
		userId: input.actorUserId,
	});
	await writeCustomFieldValues(tx, {
		...input,
		level,
		values: input.values ?? {},
		requireComplete: true,
	});
}

/**
 * Turns a custom field refusal raised inside a save (a `DatabaseService.query`)
 * into a `ValidationError` with the message in the user's language; other
 * errors pass through. Use as `effect.pipe(keepCustomFieldRefusal)`.
 */
export function keepCustomFieldRefusal<A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ValidationError, R> {
	return effect.pipe(
		Effect.catch((error: E): Effect.Effect<never, E | ValidationError> => {
			const cause = error instanceof DatabaseError ? error.cause : error;
			if (!(cause instanceof CustomFieldValuesRefused)) return Effect.fail(error);
			return Effect.promise(async () => {
				const { getTranslate } = await import("@/tolgee/server");
				return getTranslate();
			}).pipe(
				Effect.flatMap((t) =>
					Effect.fail(
						new ValidationError({
							message: namedValueRefusalMessage(t, cause.reason, cause.fieldName),
							field: cause.fieldId ? `customFields.${cause.fieldId}` : "customFields",
						}),
					),
				),
			);
		}),
	);
}
