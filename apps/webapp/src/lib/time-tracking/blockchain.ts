import crypto from "node:crypto";
import type { timeEntry } from "@/db/schema";
import { instantFromDB } from "@/lib/datetime/drizzle-adapter";
import { serializeInstant } from "@/lib/datetime/temporal-wire";

type TimeEntry = typeof timeEntry.$inferSelect;

export interface HashInput {
	employeeId: string;
	type: string;
	timestamp: string;
	previousHash: string | null;
}

function instantFromStoredDate(date: Date | null | undefined) {
	try {
		return instantFromDB(date);
	} catch {
		return null;
	}
}

function serializeInstantForDateContract(
	instant: NonNullable<ReturnType<typeof instantFromDB>>,
	date: Date,
) {
	const dateTimestamp = date.toISOString();

	try {
		const serialized = serializeInstant(instant);
		return serialized === dateTimestamp ? serialized : dateTimestamp;
	} catch {
		// The strict external instant wire format excludes extended years. Persisted Date hash bytes do not.
		return dateTimestamp;
	}
}

function serializeStoredTimestamp(timestamp: Date | null | undefined): string | null {
	if (!timestamp) return null;

	const instant = instantFromStoredDate(timestamp);
	if (!instant) return null;

	try {
		return serializeInstantForDateContract(instant, timestamp);
	} catch {
		return null;
	}
}

/**
 * Calculate SHA-256 hash for a time entry to ensure blockchain integrity
 *
 * CRITICAL: The timestamp format must remain identical to maintain hash integrity.
 * We use fixed-millisecond UTC serialization, matching Date.toISOString().
 */
export function calculateHash(input: HashInput): string {
	const data = `${input.employeeId}|${input.type}|${input.timestamp}|${input.previousHash || "genesis"}`;
	return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Verify a single time entry's hash integrity
 * Returns true if the entry's hash matches the calculated hash
 */
export function verifyHash(
	entry: Pick<TimeEntry, "employeeId" | "timestamp" | "hash" | "previousHash"> & {
		type: string;
	},
): {
	isValid: boolean;
	calculatedHash: string;
	storedHash: string;
} {
	const timestamp = serializeStoredTimestamp(entry.timestamp);
	if (!timestamp) {
		return {
			isValid: false,
			calculatedHash: "",
			storedHash: entry.hash,
		};
	}

	const calculatedHash = calculateHash({
		employeeId: entry.employeeId,
		type: entry.type,
		timestamp,
		previousHash: entry.previousHash,
	});

	return {
		isValid: calculatedHash === entry.hash,
		calculatedHash,
		storedHash: entry.hash,
	};
}

/**
 * Digest of an employee's stored entry hashes, for detecting any change between
 * two reads. It is not chain validation: entries are taken in ID order, which is
 * stable but carries no lineage meaning. Lineage and continuity are assessed by
 * `append-assurance.ts`.
 */
export function getChainHash(entries: Pick<TimeEntry, "id" | "hash">[]): string | null {
	if (entries.length === 0) {
		return null;
	}

	const sorted = entries.toSorted((left, right) =>
		left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
	);
	const allHashes = sorted.map((e) => e.hash).join("|");
	return crypto.createHash("sha256").update(allHashes).digest("hex");
}
