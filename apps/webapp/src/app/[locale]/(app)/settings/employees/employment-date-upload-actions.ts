"use server";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	commitEmploymentDateUpload,
	previewEmploymentDateUpload,
} from "@/lib/employee-lifecycle/employment-date-upload";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import { TrackingDateRefusal } from "@/lib/time-tracking/tracking-date-review-types";

const csv = z.string({ error: "Choose a readable CSV file." });

export const previewEmploymentDateUploadAction = organizationAction(
	{
		name: "employmentDateUpload.preview",
		requires: "orgAdmin",
		schema: z.strictObject({ csv }),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"employmentDateUpload.preview",
			(database) =>
				previewEmploymentDateUpload(database, {
					organizationId,
					actorUserId: actor.userId,
					now: systemClock.nowInstant(),
					csv: input.csv,
				}),
			{ refusal: TrackingDateRefusal },
		),
);

export const commitEmploymentDateUploadAction = organizationAction(
	{
		name: "employmentDateUpload.commit",
		requires: "orgAdmin",
		schema: z.strictObject({ csv, fingerprint: z.string() }),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"employmentDateUpload.commit",
			(database) =>
				commitEmploymentDateUpload(database, {
					organizationId,
					actorUserId: actor.userId,
					now: systemClock.nowInstant(),
					csv: input.csv,
					fingerprint: input.fingerprint,
				}),
			{ refusal: TrackingDateRefusal },
		),
);
