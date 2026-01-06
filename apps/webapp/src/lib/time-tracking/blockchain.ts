import crypto from "node:crypto";
import type { TimeEntry } from "@/db/schema";

interface HashInput {
	employeeId: string;
	type: string;
	timestamp: string;
	previousHash: string | null;
}

/**
 * Calculate SHA-256 hash for a time entry to ensure blockchain integrity
 */
export function calculateHash(input: HashInput): string {
	const data = `${input.employeeId}|${input.type}|${input.timestamp}|${input.previousHash || "genesis"}`;
	return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Validate the entire blockchain chain for an employee
 * Ensures no entries have been tampered with and all links are valid
 */
export async function validateChain(entries: TimeEntry[]): Promise<boolean> {
	// Sort by creation order
	const sorted = [...entries].sort(
		(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
	);

	for (let i = 0; i < sorted.length; i++) {
		const entry = sorted[i];

		// Recalculate hash
		const calculatedHash = calculateHash({
			employeeId: entry.employeeId,
			type: entry.type,
			timestamp: entry.timestamp.toISOString(),
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
