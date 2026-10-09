import "server-only";

import { and, eq } from "drizzle-orm";
import { employee, positionStamp } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { WorkTransactionDatabase } from "../work-transaction";
import { recordPositionStampAccess } from "./access-log";
import { loadPositionStampViewer, mayViewEveryonesPositionStamps } from "./viewer";

/**
 * The position stamp columns of a time entry row in the org data export
 * (#835). They replace the always-empty `location` column. `positionFixedAt`
 * is a native `Date` because the export file is an external boundary, like
 * the row's other instants.
 */
export type ExportPositionColumns = {
	positionLatitude: number | null;
	positionLongitude: number | null;
	positionAccuracyMeters: number | null;
	positionFixedAt: Date | null;
};

export type ExportTimeEntryRow = { id: string; employeeId: string };

export type ExportPositionStamps<Row extends ExportTimeEntryRow> =
	| { included: false; rows: Row[] }
	| { included: true; rows: Array<Row & ExportPositionColumns> };

/**
 * Adds each clock event's position stamp to the org data export's time entry
 * rows, but only when the user who requested the export may view everyone's
 * stamps (`./viewer`), decided now, while the export is processed. A scheduled
 * export's requester is the schedule owner. Otherwise the rows are returned
 * unchanged and carry no position key at all.
 *
 * When stamps are included, one access-log entry names the export and every
 * employee whose stamps the file holds, in the same transaction as the read;
 * an export holding no stamp writes none. Every query is filtered by
 * `organizationId`.
 */
export async function attachExportPositionStamps<Row extends ExportTimeEntryRow>(
	database: WorkTransactionDatabase,
	input: {
		organizationId: string;
		exportId: string;
		/** `data_export.requested_by_id`: the requesting user's employee profile in the organization. */
		requestedByEmployeeId: string;
		now: Instant;
		rows: readonly Row[];
	},
): Promise<ExportPositionStamps<Row>> {
	const { organizationId } = input;
	return database.transaction(async (tx) => {
		const unchanged: ExportPositionStamps<Row> = { included: false, rows: [...input.rows] };

		const [requester] = await tx
			.select({ userId: employee.userId })
			.from(employee)
			.where(
				and(
					eq(employee.id, input.requestedByEmployeeId),
					eq(employee.organizationId, organizationId),
				),
			)
			.limit(1);
		if (!requester) return unchanged;

		const viewer = await loadPositionStampViewer(tx, { organizationId, userId: requester.userId });
		if (!mayViewEveryonesPositionStamps(viewer)) return unchanged;

		const stamps = await tx
			.select({
				timeEntryId: positionStamp.timeEntryId,
				employeeId: positionStamp.employeeId,
				latitude: positionStamp.latitude,
				longitude: positionStamp.longitude,
				accuracyMeters: positionStamp.accuracyMeters,
				fixedAt: positionStamp.fixedAt,
			})
			.from(positionStamp)
			.where(eq(positionStamp.organizationId, organizationId));
		const stampByEntry = new Map(stamps.map((stamp) => [stamp.timeEntryId, stamp]));

		const subjects = new Set<string>();
		const rows = input.rows.map((row) => {
			const stamp = stampByEntry.get(row.id);
			if (!stamp || stamp.employeeId !== row.employeeId) {
				return {
					...row,
					positionLatitude: null,
					positionLongitude: null,
					positionAccuracyMeters: null,
					positionFixedAt: null,
				};
			}
			subjects.add(row.employeeId);
			return {
				...row,
				positionLatitude: stamp.latitude,
				positionLongitude: stamp.longitude,
				positionAccuracyMeters: stamp.accuracyMeters,
				positionFixedAt: stamp.fixedAt,
			};
		});

		if (subjects.size > 0) {
			await recordPositionStampAccess(tx, {
				organizationId,
				viewerUserId: requester.userId,
				kind: "data_export",
				exportId: input.exportId,
				subjectEmployeeIds: [...subjects],
				accessedAt: input.now,
			});
		}
		return { included: true, rows };
	});
}
