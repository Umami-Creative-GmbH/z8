import "server-only";

import { DatabaseError, ValidationError } from "@/lib/effect/errors";
import type { CustomFieldEntity } from "./definition-rules";
import type { CustomFieldValuesInput } from "./value-rules";
import {
	CustomFieldValuesRefused,
	type CustomFieldWriter,
	loadCustomFieldViewerLevel,
	writeCustomFieldValues,
} from "./values";

/**
 * Saves the custom field values a record's form sends (#818): the employee
 * detail save, the project dialog (incl. from a template) and the customer
 * dialog. Call it inside the save's transaction, after the record is written
 * and the actor's reach is checked. `values` undefined = the save didn't come
 * from a form with a custom fields section (archiving a project, ...): nothing
 * is written or required. Otherwise every required field the actor may edit
 * must have a value afterwards (spec #769 decision D3).
 */
export async function saveFormCustomFieldValues(
	tx: CustomFieldWriter,
	input: {
		organizationId: string;
		actorUserId: string;
		entity: CustomFieldEntity;
		recordId: string;
		values: CustomFieldValuesInput | undefined;
	},
): Promise<void> {
	if (input.values === undefined) return;
	const level = await loadCustomFieldViewerLevel(tx, {
		organizationId: input.organizationId,
		userId: input.actorUserId,
	});
	await writeCustomFieldValues(tx, {
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		level,
		entity: input.entity,
		recordId: input.recordId,
		values: input.values,
		requireComplete: true,
	});
}

/**
 * A custom field refusal raised inside a `DatabaseService.query` comes back as
 * a `ValidationError` with its user-safe message; other errors pass through.
 */
export function keepCustomFieldRefusal<E>(error: E): E | ValidationError {
	const cause = error instanceof DatabaseError ? error.cause : error;
	return cause instanceof CustomFieldValuesRefused
		? new ValidationError({
				message: cause.message,
				field: cause.fieldId ? `customFields.${cause.fieldId}` : "customFields",
			})
		: error;
}
