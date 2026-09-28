import "server-only";

// The raw hash-chained entry writers (#524): no authorization and no request
// scope, so web actions, the Clocking module and workers share them. Callers pass
// the request evidence; a web caller reads it with `getRequestMetadata()`.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { timeEntry } from "@/db/schema";
import { calculateHash } from "./blockchain";
import type { TimeEntryTimezoneSource } from "./timezone-capture";

type TimeEntryDbClient = Pick<typeof db, "insert" | "select">;
type TimeEntryUpdateDbClient = Pick<typeof db, "update">;

/** Stored on the entry as `ip_address` and `device_info`. */
export type TimeEntryRequestMetadata = {
	ipAddress: string | null;
	userAgent: string | null;
};

export async function createTimeEntry(
	params: {
		/** An operation identity the entry takes; generated when omitted. */
		id?: string;
		employeeId: string;
		organizationId: string;
		type: "clock_in" | "clock_out" | "correction";
		timestamp: Date;
		createdBy: string;
		utcOffsetMinutes: number;
		timezone: string;
		timezoneSource: TimeEntryTimezoneSource;
		request: TimeEntryRequestMetadata;
		replacesEntryId?: string;
		notes?: string;
		location?: string;
		isSuperseded?: boolean;
		chainAfter?: Pick<
			typeof timeEntry.$inferSelect,
			"id" | "hash" | "employeeId" | "organizationId"
		>;
	},
	client: TimeEntryDbClient = db,
): Promise<typeof timeEntry.$inferSelect> {
	const {
		id,
		employeeId,
		organizationId,
		type,
		timestamp,
		createdBy,
		utcOffsetMinutes,
		timezone,
		timezoneSource,
		request,
		replacesEntryId,
		notes,
		location,
		isSuperseded,
		chainAfter,
	} = params;

	if (
		chainAfter &&
		(chainAfter.employeeId !== employeeId || chainAfter.organizationId !== organizationId)
	) {
		throw new Error(
			"Time entry chain predecessor must belong to the same employee and organization",
		);
	}

	const previousEntry =
		chainAfter ??
		(await client
			.select()
			.from(timeEntry)
			.where(
				and(eq(timeEntry.employeeId, employeeId), eq(timeEntry.organizationId, organizationId)),
			)
			.orderBy(desc(timeEntry.createdAt))
			.limit(1)
			.then(([entry]) => entry));
	const previousHash = previousEntry?.hash || null;
	const hash = calculateHash({
		employeeId,
		type,
		timestamp: timestamp.toISOString(),
		previousHash,
	});

	const [entry] = await client
		.insert(timeEntry)
		.values({
			...(id === undefined ? {} : { id }),
			employeeId,
			organizationId,
			type,
			timestamp,
			hash,
			previousHash,
			previousEntryId: previousEntry?.id ?? null,
			ipAddress: request.ipAddress,
			deviceInfo: request.userAgent,
			createdBy,
			utcOffsetMinutes,
			timezone,
			timezoneSource,
			replacesEntryId,
			notes,
			location,
			...(isSuperseded === undefined ? {} : { isSuperseded }),
		})
		.returning();

	return entry;
}

export async function markTimeEntrySuperseded(
	entryId: string,
	supersededById: string,
	client: TimeEntryUpdateDbClient = db,
): Promise<void> {
	await client
		.update(timeEntry)
		.set({
			isSuperseded: true,
			supersededById,
		})
		.where(eq(timeEntry.id, entryId));
}
