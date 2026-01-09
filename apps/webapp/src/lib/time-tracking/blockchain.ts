import crypto from "node:crypto";
import { dateFromDB } from "@/lib/datetime/drizzle-adapter";
import type { timeEntry } from "@/db/schema";

type TimeEntry = typeof timeEntry.$inferSelect;

export interface HashInput {
	employeeId: string;
	type: string;
	timestamp: string;
	previousHash: string | null;
}

export interface ChainValidationResult {
	isValid: boolean;
	totalEntries: number;
	validEntries: number;
	issues: ChainValidationIssue[];
	chainHash: string | null;
}

export interface ChainValidationIssue {
	entryId: string;
	entryIndex: number;
	type: "hash_mismatch" | "chain_break" | "invalid_genesis" | "invalid_timestamp";
	message: string;
	expectedValue?: string;
	actualValue?: string;
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

/**
 * Verify a single time entry's hash integrity
 * Returns true if the entry's hash matches the calculated hash
 */
export function verifyHash(entry: TimeEntry): {
	isValid: boolean;
	calculatedHash: string;
	storedHash: string;
} {
	const timestampDT = dateFromDB(entry.timestamp);
	if (!timestampDT) {
		return {
			isValid: false,
			calculatedHash: "",
			storedHash: entry.hash,
		};
	}

	const calculatedHash = calculateHash({
		employeeId: entry.employeeId,
		type: entry.type,
		timestamp: timestampDT.toISO()!,
		previousHash: entry.previousHash,
	});

	return {
		isValid: calculatedHash === entry.hash,
		calculatedHash,
		storedHash: entry.hash,
	};
}

/**
 * Calculate a single hash representing the entire chain's integrity
 * This is useful for quick comparison to detect any changes in the chain
 */
export function getChainHash(entries: TimeEntry[]): string | null {
	if (entries.length === 0) {
		return null;
	}

	// Sort by creation order
	const sorted = [...entries].sort((a, b) => {
		const aDT = dateFromDB(a.createdAt);
		const bDT = dateFromDB(b.createdAt);
		if (!aDT || !bDT) return 0;
		return aDT < bDT ? -1 : aDT > bDT ? 1 : 0;
	});

	// Concatenate all hashes and compute a final hash
	const allHashes = sorted.map((e) => e.hash).join("|");
	return crypto.createHash("sha256").update(allHashes).digest("hex");
}

/**
 * Validate the entire blockchain chain with detailed issue reporting
 * Returns comprehensive validation results including all issues found
 */
export function validateChainDetailed(entries: TimeEntry[]): ChainValidationResult {
	if (entries.length === 0) {
		return {
			isValid: true,
			totalEntries: 0,
			validEntries: 0,
			issues: [],
			chainHash: null,
		};
	}

	const issues: ChainValidationIssue[] = [];
	let validEntries = 0;

	// Sort by creation order
	const sorted = [...entries].sort((a, b) => {
		const aDT = dateFromDB(a.createdAt);
		const bDT = dateFromDB(b.createdAt);
		if (!aDT || !bDT) return 0;
		return aDT < bDT ? -1 : aDT > bDT ? 1 : 0;
	});

	for (let i = 0; i < sorted.length; i++) {
		const entry = sorted[i];
		let entryValid = true;

		const timestampDT = dateFromDB(entry.timestamp);
		if (!timestampDT) {
			issues.push({
				entryId: entry.id,
				entryIndex: i,
				type: "invalid_timestamp",
				message: `Entry has invalid or null timestamp`,
			});
			entryValid = false;
			continue;
		}

		// Verify hash
		const calculatedHash = calculateHash({
			employeeId: entry.employeeId,
			type: entry.type,
			timestamp: timestampDT.toISO()!,
			previousHash: entry.previousHash,
		});

		if (calculatedHash !== entry.hash) {
			issues.push({
				entryId: entry.id,
				entryIndex: i,
				type: "hash_mismatch",
				message: `Hash mismatch: entry data may have been tampered with`,
				expectedValue: calculatedHash,
				actualValue: entry.hash,
			});
			entryValid = false;
		}

		// Verify chain link (except for first entry)
		if (i > 0 && entry.previousHash !== sorted[i - 1].hash) {
			issues.push({
				entryId: entry.id,
				entryIndex: i,
				type: "chain_break",
				message: `Chain link broken: previousHash does not match previous entry's hash`,
				expectedValue: sorted[i - 1].hash,
				actualValue: entry.previousHash ?? "null",
			});
			entryValid = false;
		}

		// Verify first entry has null previousHash
		if (i === 0 && entry.previousHash !== null) {
			issues.push({
				entryId: entry.id,
				entryIndex: i,
				type: "invalid_genesis",
				message: `First entry (genesis) should have null previousHash`,
				expectedValue: "null",
				actualValue: entry.previousHash,
			});
			entryValid = false;
		}

		if (entryValid) {
			validEntries++;
		}
	}

	return {
		isValid: issues.length === 0,
		totalEntries: entries.length,
		validEntries,
		issues,
		chainHash: issues.length === 0 ? getChainHash(entries) : null,
	};
}
