"use server";

import { Effect } from "effect";
import { z } from "zod";
import { CSV_WORK_MAX_BYTES } from "@/lib/import-review/csv-work-format";
import {
	createCsvWorkImport,
	decideCsvWorkRows,
	mapCsvWorkValue,
	prepareCsvWorkCommit,
	refreshCsvWorkImport,
} from "@/lib/import-review/csv-work-import";
import { enqueueImportCommitJob, enqueueImportScanJob } from "@/lib/import-review/queue";
import { updateImportBatchStatus } from "@/lib/import-review/repository";
import { organizationAction } from "@/lib/organization-action/organization-action";

/**
 * CSV work import steps on Promise helpers. A failure reaches the client with
 * its own message when it is a plain error, else with `fallback`.
 */
function csvWork<T>(fallback: string, run: () => Promise<T>) {
	return Effect.tryPromise({
		try: run,
		catch: (error) =>
			new Error(error instanceof Error && !error.cause ? error.message.slice(0, 500) : fallback),
	}).pipe(Effect.orDie);
}

const uploadSchema = z.strictObject({
	csv: z.string().min(1).max(CSV_WORK_MAX_BYTES),
	timezone: z.string().max(100).optional(),
	fileName: z.string().min(1).max(200),
});

export const uploadCsvWorkAction = organizationAction(
	{ name: "csvWorkImport.upload", requires: "orgAdmin", schema: uploadSchema },
	({ actor, organizationId, input }) =>
		csvWork("Unable to upload this CSV work import", async () => {
			const created = await createCsvWorkImport({
				...input,
				organizationId,
				actorUserId: actor.userId,
			});
			try {
				await enqueueImportScanJob(created.scanJob);
			} catch {
				await updateImportBatchStatus({
					organizationId,
					batchId: created.batchId,
					status: "scan_failed",
					errorMessage: "The scan could not be queued; upload the file again",
				});
				throw new Error("The scan could not be queued; upload the file again");
			}
			return { batchId: created.batchId };
		}),
);

const batchSchema = z.strictObject({ batchId: z.uuid() });

export const commitCsvWorkAction = organizationAction(
	{ name: "csvWorkImport.commit", requires: "orgAdmin", schema: batchSchema },
	({ actor, organizationId, input }) =>
		csvWork("Unable to start this CSV work commit", async () => {
			const batch = { ...input, organizationId };
			const job = await prepareCsvWorkCommit({ ...batch, actorUserId: actor.userId });
			try {
				await enqueueImportCommitJob(job);
			} catch {
				await updateImportBatchStatus({
					...batch,
					status: "commit_failed",
					errorMessage: "The commit could not be queued; recheck the unresolved rows and try again",
				});
				throw new Error(
					"The commit could not be queued; recheck the unresolved rows and try again",
				);
			}
			return {};
		}),
);

const UPDATE_FAILED = "Unable to update this CSV work import";

export const decideCsvWorkAction = organizationAction(
	{
		name: "csvWorkImport.decideRows",
		requires: "orgAdmin",
		schema: batchSchema.extend({
			rowIds: z.array(z.uuid()).min(1).max(1000),
			decision: z.enum(["accepted", "rejected"]),
		}),
	},
	({ actor, organizationId, input }) =>
		csvWork(UPDATE_FAILED, () =>
			decideCsvWorkRows({ ...input, organizationId, actorUserId: actor.userId }),
		),
);

export const mapCsvWorkAction = organizationAction(
	{
		name: "csvWorkImport.mapValue",
		requires: "orgAdmin",
		schema: batchSchema.extend({
			kind: z.enum(["employee", "vehicle"]),
			sourceValue: z.string().min(1).max(128),
			targetId: z.uuid(),
		}),
	},
	({ actor, organizationId, input }) =>
		csvWork(UPDATE_FAILED, () =>
			mapCsvWorkValue({ ...input, organizationId, actorUserId: actor.userId }),
		),
);

export const refreshCsvWorkAction = organizationAction(
	{ name: "csvWorkImport.refresh", requires: "orgAdmin", schema: batchSchema },
	({ actor, organizationId, input }) =>
		csvWork(UPDATE_FAILED, () =>
			refreshCsvWorkImport({ ...input, organizationId, actorUserId: actor.userId }),
		),
);
