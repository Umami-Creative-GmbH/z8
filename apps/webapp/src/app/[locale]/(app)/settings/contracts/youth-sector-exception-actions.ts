"use server";

import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	acknowledgeYouthSectorException,
	jarbschgSectorExceptionKinds,
	listOpenYouthSectorExceptions,
	type OpenYouthSectorException,
} from "@/lib/statutory/youth/sector-exception-review";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

// JArbSchG statutory sector exceptions in Settings → Contracts → Reviews & Conflicts (#1993).
// Org admins only: the list carries the input fingerprints the acknowledgement must match.

const acknowledgeSchema = z.strictObject({
	employeeId: z.uuid("Invalid selection."),
	findingKind: z.enum(jarbschgSectorExceptionKinds),
	subjectKey: z.string().min(1).max(200),
	periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
	expectedFingerprint: z.string().min(1).max(200),
	reason: z.string().max(1000),
	legalNote: z.string().max(500).nullable().optional(),
});

export type AcknowledgeYouthSectorExceptionInput = z.input<typeof acknowledgeSchema>;

export const listYouthSectorExceptionsAction = organizationAction(
	{ name: "statutory.youthSectorExceptions.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		storeStep(
			"statutory.youthSectorExceptions.list",
			async (db): Promise<OpenYouthSectorException[]> =>
				listOpenYouthSectorExceptions(db, {
					organizationId,
					timezone: await loadOrganizationTimezone(db, organizationId),
					now: systemClock.nowInstant(),
				}),
		),
);

export const acknowledgeYouthSectorExceptionAction = organizationAction(
	{
		name: "statutory.youthSectorExceptions.acknowledge",
		requires: "orgAdmin",
		schema: acknowledgeSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep("statutory.youthSectorExceptions.acknowledge", async (db) => {
			const record = await acknowledgeYouthSectorException(db, {
				...input,
				organizationId,
				actorUserId: actor.userId,
				timezone: await loadOrganizationTimezone(db, organizationId),
				now: systemClock.nowInstant(),
			});
			return { id: record.id, acknowledgedAt: record.acknowledgedAt };
		}),
);
