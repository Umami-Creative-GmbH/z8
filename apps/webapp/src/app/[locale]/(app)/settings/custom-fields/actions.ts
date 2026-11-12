"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { CustomFieldChange } from "@/lib/organization/custom-fields/definition-rules";
import {
	changeCustomFields as changeCustomFieldsInStore,
	listCustomFieldDefinitions,
} from "@/lib/organization/custom-fields/definitions";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { payrollIdentifierArchiveGuard } from "@/lib/payroll-export/personnel-identifier-usage";

/** Every custom field of the active organization, active and archived. Org admins only. */
export const getCustomFieldDefinitions = organizationAction(
	{ name: "customFields.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("customFields.list", () =>
				listCustomFieldDefinitions(dbService.db, organizationId),
			);
		}),
);

/**
 * A custom field change as the client sends it. `parseCustomFieldChange` reads
 * it inside the store, so a malformed change keeps coming back as the
 * `{ ok: false, reason }` refusal the settings form maps.
 */
const customFieldChangeSchema = z.custom<CustomFieldChange>(
	(value) => typeof value === "object" && value !== null,
	{ error: "Choose a valid custom field change" },
);

/**
 * Applies one change to the custom fields of the active organization. Org
 * admins only. A refused change comes back as `{ ok: false, reason }`; an
 * accepted one returns every definition of the organization.
 */
export const changeCustomFields = organizationAction(
	{ name: "customFields.change", requires: "orgAdmin", schema: customFieldChangeSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const outcome = yield* dbService.query("customFields.change", () =>
				changeCustomFieldsInStore(dbService.db, {
					organizationId,
					actorUserId: actor.userId,
					change: input,
					archiveGuards: [payrollIdentifierArchiveGuard],
				}),
			);
			if (outcome.ok) revalidatePath("/settings/custom-fields");
			return outcome;
		}),
);
