import crypto from "node:crypto";
import { DateTime } from "luxon";
import { dateFromDB } from "@/lib/datetime/drizzle-adapter";
import type { timeEntry } from "@/db/schema";

type TimeEntry = typeof timeEntry.$inferSelect;

interface HashInput {
	employeeId: string;
	type: string;
	timestamp: string;
	previousHash: string | null;
}

/**
 * Calculate SHA-256 hash for a time entry to ensure blockchain integrity
 *
 * CRITICAL: The timestamp format must remain identical to maintain hash integrity.
 * We use Luxon's toISO() which produces the same ISO 8601 format as Date.toISOString()
 */
export function calculateHash(input: HashInput): string {
	const data = `${input.employeeId}|${input.type}|${input.timestamp}|${input.previousHash || "genesis"}`;
	return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Validate the entire blockchain chain for an employee
 * Ensures no entries have been tampered with and all links are valid
 *
 * CRITICAL: Hash calculation must use identical timestamp format to maintain integrity.
 * Luxon's toISO() produces the same format as Date.toISOString() (ISO 8601 with milliseconds)
 */
export async function validateChain(entries: TimeEntry[]): Promise<boolean> {
	// Sort by creation order using Luxon for safer date comparison
	const sorted = [...entries].sort((a, b) => {
		const aDT = dateFromDB(a.createdAt);
		const bDT = dateFromDB(b.createdAt);
		if (!aDT || !bDT) return 0;
		return aDT < bDT ? -1 : aDT > bDT ? 1 : 0;
	});

	for (let i = 0; i < sorted.length; i++) {
		const entry = sorted[i];

		// Convert timestamp to DateTime and then to ISO string
		// CRITICAL: toISO() must produce identical output to toISOString()
		const timestampDT = dateFromDB(entry.timestamp);
		if (!timestampDT) {
			console.error(`Invalid timestamp at entry ${entry.id}`);
			return false;
		}

		// Recalculate hash with ISO string format
		// Luxon's toISO() produces the same format as Date.toISOString()
		const calculatedHash = calculateHash({
			employeeId: entry.employeeId,
			type: entry.type,
			timestamp: timestampDT.toISO()!,
			previousHash: entry.previousHash,
		});

		// Verify hash matches
		if (calculatedHash !== entry.hash) {
			console.error(`Hash mismatch at entry ${entry.id}`);
			return false;
		}

		// Verify chain link (except for first entry)
		if (i > 0 && entry.previousHash !== sorted[i - 1].hash) {
			console.error(`Chain link broken at entry ${entry.id}`);
			return false;
		}

		// Verify first entry has null previousHash
		if (i === 0 && entry.previousHash !== null) {
			console.error(`First entry should have null previousHash`);
			return false;
		}
	}

	return true;
}
