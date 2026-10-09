import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee, positionStamp } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { WorkTransactionClient, WorkTransactionDatabase } from "../work-transaction";
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
 * rows, but only when everyone who receives the file may view everyone's
 * stamps (`./viewer`), decided now, while the export is processed: the user who
 * requested it (a scheduled export's schedule owner) and every address its
 * download link is mailed to, each of which must be a user of this
 * organization. Otherwise the rows are returned unchanged and carry no
 * position key at all.
 *
 * When stamps are included, one access-log entry per viewer who receives the
 * file names the export and every employee whose stamps it holds, in the same
 * transaction as the read; an export holding no stamp writes none. Every query
 * is filtered by `organizationId`.
 */
export async function attachExportPositionStamps<Row extends ExportTimeEntryRow>(
	database: WorkTransactionDatabase,
	input: {
		organizationId: string;
		exportId: string;
		/** `data_export.requested_by_id`: the requesting user's employee profile in the organization. */
		requestedByEmployeeId: string;
		/** The addresses the export's download link is mailed to, if any (scheduled exports). */
		recipientEmails?: readonly string[];
		now: Instant;
		rows: readonly Row[];
	},
): Promise<ExportPositionStamps<Row>> {
	const { organizationId } = input;
	return database.transaction(async (tx) => {
		const unchanged: ExportPositionStamps<Row> = { included: false, rows: [...input.rows] };

		const viewerUserIds = await permittedViewers(tx, {
			organizationId,
			requestedByEmployeeId: input.requestedByEmployeeId,
			recipientEmails: input.recipientEmails ?? [],
		});
		if (!viewerUserIds) return unchanged;

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
			for (const viewerUserId of viewerUserIds) {
				await recordPositionStampAccess(tx, {
					organizationId,
					viewerUserId,
					kind: "data_export",
					exportId: input.exportId,
					subjectEmployeeIds: [...subjects],
					accessedAt: input.now,
				});
			}
		}
		return { included: true, rows };
	});
}

/**
 * The users who receive the export file, when every one of them may view
 * everyone's stamps; null when any may not, or when a recipient address is
 * not a user of this organization.
 */
async function permittedViewers(
	tx: Pick<WorkTransactionClient, "select">,
	input: { organizationId: string; requestedByEmployeeId: string; recipientEmails: readonly string[] },
): Promise<string[] | null> {
	const { organizationId } = input;
	const [requester] = await tx
		.select({ userId: employee.userId })
		.from(employee)
		.where(
			and(eq(employee.id, input.requestedByEmployeeId), eq(employee.organizationId, organizationId)),
		)
		.limit(1);
	if (!requester) return null;

	const emails = [...new Set(input.recipientEmails.map((email) => email.trim().toLowerCase()))];
	const recipients =
		emails.length > 0
			? await tx
					.select({ id: user.id })
					.from(user)
					.where(inArray(sql`lower(${user.email})`, emails))
			: [];
	if (recipients.length < emails.length) return null;

	const userIds = [...new Set([requester.userId, ...recipients.map((recipient) => recipient.id)])];
	for (const userId of userIds) {
		// A user who is not an approved member of this organization is never a viewer.
		const viewer = await loadPositionStampViewer(tx, { organizationId, userId });
		if (!mayViewEveryonesPositionStamps(viewer)) return null;
	}
	return userIds;
}
