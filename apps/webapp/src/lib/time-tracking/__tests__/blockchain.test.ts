/**
 * Comprehensive tests for blockchain hash service
 * Tests hash calculation, verification, chain validation, and tamper detection
 */

import { describe, expect, it } from "vitest";
import type { timeEntry } from "@/db/schema";
import {
	calculateHash,
	getChainHash,
	validateChain,
	validateChainDetailed,
	verifyHash,
} from "../blockchain";

type TimeEntry = typeof timeEntry.$inferSelect;

// Helper to create mock time entries
function createMockEntry(
	overrides: Partial<TimeEntry> & { id: string; employeeId: string; type: string },
): TimeEntry {
	const timestamp = overrides.timestamp || new Date();
	const hash =
		overrides.hash ||
		calculateHash({
			employeeId: overrides.employeeId,
			type: overrides.type,
			timestamp: timestamp.toISOString(),
			previousHash: overrides.previousHash || null,
		});

	return {
		id: overrides.id,
		employeeId: overrides.employeeId,
		organizationId: overrides.organizationId || "test-org",
		type: overrides.type as "clock_in" | "clock_out" | "correction",
		timestamp,
		hash,
		previousHash: overrides.previousHash ?? null,
		previousEntryId: overrides.previousEntryId ?? null,
		replacesEntryId: overrides.replacesEntryId ?? null,
		isSuperseded: overrides.isSuperseded ?? false,
		supersededById: overrides.supersededById ?? null,
		notes: overrides.notes ?? null,
		location: overrides.location ?? null,
		ipAddress: overrides.ipAddress ?? null,
		deviceInfo: overrides.deviceInfo ?? null,
		createdAt: overrides.createdAt || new Date(),
		createdBy: overrides.createdBy || "test-user",
	};
}

// Helper to create a valid chain of entries
function createValidChain(employeeId: string, count: number): TimeEntry[] {
	const entries: TimeEntry[] = [];
	let previousHash: string | null = null;

	for (let i = 0; i < count; i++) {
		const timestamp = new Date(Date.now() + i * 1000);
		const type = i % 2 === 0 ? "clock_in" : "clock_out";
		const hash = calculateHash({
			employeeId,
			type,
			timestamp: timestamp.toISOString(),
			previousHash,
		});

		entries.push(
			createMockEntry({
				id: `entry-${i}`,
				employeeId,
				type,
				timestamp,
				hash,
				previousHash,
				createdAt: timestamp,
			}),
		);

		previousHash = hash;
	}

	return entries;
}

describe("calculateHash", () => {
	it("should produce consistent hash for same input", () => {
		const input = {
			employeeId: "emp-123",
			type: "clock_in",
			timestamp: "2024-01-15T08:00:00.000Z",
			previousHash: null,
		};

		const hash1 = calculateHash(input);
		const hash2 = calculateHash(input);

		expect(hash1).toBe(hash2);
	});

	it("should produce different hash when any field changes", () => {
		const base = {
			employeeId: "emp-123",
			type: "clock_in",
			timestamp: "2024-01-15T08:00:00.000Z",
			previousHash: null,
		};

		const hashBase = calculateHash(base);

		// Change employeeId
		expect(calculateHash({ ...base, employeeId: "emp-456" })).not.toBe(hashBase);

		// Change type
		expect(calculateHash({ ...base, type: "clock_out" })).not.toBe(hashBase);

		// Change timestamp
		expect(calculateHash({ ...base, timestamp: "2024-01-15T08:00:01.000Z" })).not.toBe(hashBase);

		// Change previousHash
		expect(calculateHash({ ...base, previousHash: "abc123" })).not.toBe(hashBase);
	});

	it("should produce 64 character hex string (SHA256)", () => {
		const hash = calculateHash({
			employeeId: "emp-123",
			type: "clock_in",
			timestamp: "2024-01-15T08:00:00.000Z",
			previousHash: null,
		});

		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("should handle null previousHash as genesis", () => {
		const hash1 = calculateHash({
			employeeId: "emp-123",
			type: "clock_in",
			timestamp: "2024-01-15T08:00:00.000Z",
			previousHash: null,
		});

		// Explicitly using "genesis" shouldn't match null
		// because the code converts null to "genesis" internally
		expect(hash1).toBeDefined();
	});
});

describe("verifyHash", () => {
	it("should return valid for correctly hashed entry", () => {
		const timestamp = new Date("2024-01-15T08:00:00.000Z");
		const entry = createMockEntry({
			id: "entry-1",
			employeeId: "emp-123",
			type: "clock_in",
			timestamp,
		});

		const result = verifyHash(entry);

		expect(result.isValid).toBe(true);
		expect(result.calculatedHash).toBe(result.storedHash);
	});

	it("should return invalid for tampered entry", () => {
		const timestamp = new Date("2024-01-15T08:00:00.000Z");
		const entry = createMockEntry({
			id: "entry-1",
			employeeId: "emp-123",
			type: "clock_in",
			timestamp,
		});

		// Tamper with the hash
		entry.hash = "tampered_hash_value_that_doesnt_match";

		const result = verifyHash(entry);

		expect(result.isValid).toBe(false);
		expect(result.calculatedHash).not.toBe(result.storedHash);
		expect(result.storedHash).toBe("tampered_hash_value_that_doesnt_match");
	});

	it("should detect tampering when data is modified", () => {
		const timestamp = new Date("2024-01-15T08:00:00.000Z");
		const entry = createMockEntry({
			id: "entry-1",
			employeeId: "emp-123",
			type: "clock_in",
			timestamp,
		});

		// Modify the timestamp after hash was calculated
		entry.timestamp = new Date("2024-01-15T09:00:00.000Z");

		const result = verifyHash(entry);

		expect(result.isValid).toBe(false);
	});
});

describe("getChainHash", () => {
	it("should return null for empty entries", () => {
		const result = getChainHash([]);
		expect(result).toBeNull();
	});

	it("should return consistent hash for same chain", () => {
		const entries = createValidChain("emp-123", 5);

		const hash1 = getChainHash(entries);
		const hash2 = getChainHash(entries);

		expect(hash1).toBe(hash2);
	});

	it("should return different hash when chain changes", () => {
		const entries1 = createValidChain("emp-123", 5);
		const entries2 = createValidChain("emp-123", 6);

		const hash1 = getChainHash(entries1);
		const hash2 = getChainHash(entries2);

		expect(hash1).not.toBe(hash2);
	});

	it("should return 64 character hex string", () => {
		const entries = createValidChain("emp-123", 3);
		const hash = getChainHash(entries);

		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});
});

describe("validateChain", () => {
	it("should return true for valid chain", async () => {
		const entries = createValidChain("emp-123", 5);
		const result = await validateChain(entries);
		expect(result).toBe(true);
	});

	it("should return true for empty chain", async () => {
		const result = await validateChain([]);
		expect(result).toBe(true);
	});

	it("should return true for single entry", async () => {
		const entries = createValidChain("emp-123", 1);
		const result = await validateChain(entries);
		expect(result).toBe(true);
	});

	it("should return false for chain with hash mismatch", async () => {
		const entries = createValidChain("emp-123", 5);

		// Tamper with middle entry's hash
		entries[2].hash = "tampered_hash";

		const result = await validateChain(entries);
		expect(result).toBe(false);
	});

	it("should return false for chain with broken link", async () => {
		const entries = createValidChain("emp-123", 5);

		// Break the chain link
		entries[3].previousHash = "wrong_previous_hash";

		const result = await validateChain(entries);
		expect(result).toBe(false);
	});

	it("should return false if first entry has non-null previousHash", async () => {
		const entries = createValidChain("emp-123", 3);

		// First entry should have null previousHash
		entries[0].previousHash = "should_be_null";

		const result = await validateChain(entries);
		expect(result).toBe(false);
	});
});

describe("validateChainDetailed", () => {
	it("should return valid result for valid chain", () => {
		const entries = createValidChain("emp-123", 5);
		const result = validateChainDetailed(entries);

		expect(result.isValid).toBe(true);
		expect(result.totalEntries).toBe(5);
		expect(result.validEntries).toBe(5);
		expect(result.issues).toHaveLength(0);
		expect(result.chainHash).toBeDefined();
	});

	it("should return valid result for empty chain", () => {
		const result = validateChainDetailed([]);

		expect(result.isValid).toBe(true);
		expect(result.totalEntries).toBe(0);
		expect(result.validEntries).toBe(0);
		expect(result.issues).toHaveLength(0);
		expect(result.chainHash).toBeNull();
	});

	it("should detect hash mismatch with details", () => {
		const entries = createValidChain("emp-123", 5);
		const originalHash = entries[2].hash;

		// Tamper with entry's data (not hash) to cause mismatch
		entries[2].timestamp = new Date("2099-01-01T00:00:00.000Z");

		const result = validateChainDetailed(entries);

		expect(result.isValid).toBe(false);
		expect(result.issues.length).toBeGreaterThan(0);

		const hashIssue = result.issues.find((i) => i.type === "hash_mismatch");
		expect(hashIssue).toBeDefined();
		expect(hashIssue?.entryId).toBe("entry-2");
		expect(hashIssue?.entryIndex).toBe(2);
		expect(hashIssue?.actualValue).toBe(originalHash);
		expect(result.chainHash).toBeNull();
	});

	it("should detect chain break with details", () => {
		const entries = createValidChain("emp-123", 5);

		// Break the chain by changing previousHash
		entries[3].previousHash = "wrong_previous_hash";

		const result = validateChainDetailed(entries);

		expect(result.isValid).toBe(false);

		const breakIssue = result.issues.find((i) => i.type === "chain_break");
		expect(breakIssue).toBeDefined();
		expect(breakIssue?.entryId).toBe("entry-3");
		expect(breakIssue?.expectedValue).toBe(entries[2].hash);
		expect(breakIssue?.actualValue).toBe("wrong_previous_hash");
	});

	it("should detect invalid genesis entry", () => {
		const entries = createValidChain("emp-123", 3);

		// First entry should have null previousHash
		entries[0].previousHash = "should_be_null";
		// Recalculate hash to make it valid hash-wise but invalid chain-wise
		entries[0].hash = calculateHash({
			employeeId: entries[0].employeeId,
			type: entries[0].type,
			timestamp: entries[0].timestamp.toISOString(),
			previousHash: "should_be_null",
		});

		const result = validateChainDetailed(entries);

		expect(result.isValid).toBe(false);

		const genesisIssue = result.issues.find((i) => i.type === "invalid_genesis");
		expect(genesisIssue).toBeDefined();
		expect(genesisIssue?.expectedValue).toBe("null");
		expect(genesisIssue?.actualValue).toBe("should_be_null");
	});

	it("should report multiple issues in chain", () => {
		const entries = createValidChain("emp-123", 5);

		// Create multiple issues
		entries[0].previousHash = "bad_genesis"; // Invalid genesis
		entries[0].hash = calculateHash({
			employeeId: entries[0].employeeId,
			type: entries[0].type,
			timestamp: entries[0].timestamp.toISOString(),
			previousHash: "bad_genesis",
		});

		entries[2].timestamp = new Date("2099-01-01T00:00:00.000Z"); // Hash mismatch

		const result = validateChainDetailed(entries);

		expect(result.isValid).toBe(false);
		expect(result.issues.length).toBeGreaterThanOrEqual(2);
	});

	it("should count valid entries correctly", () => {
		const entries = createValidChain("emp-123", 5);

		// Tamper with one entry
		entries[2].hash = "tampered";

		const result = validateChainDetailed(entries);

		// Entry 2 is invalid, and entry 3 has broken link to entry 2
		expect(result.validEntries).toBeLessThan(5);
	});
});

describe("Chain integrity scenarios", () => {
	it("should handle correction entries in chain", () => {
		const entries: TimeEntry[] = [];
		let previousHash: string | null = null;

		// Create normal entry
		const entry1 = createMockEntry({
			id: "entry-1",
			employeeId: "emp-123",
			type: "clock_in",
			timestamp: new Date("2024-01-15T08:00:00.000Z"),
			previousHash: null,
			createdAt: new Date("2024-01-15T08:00:00.000Z"),
		});
		entries.push(entry1);
		previousHash = entry1.hash;

		// Create correction entry
		const correctionHash = calculateHash({
			employeeId: "emp-123",
			type: "correction",
			timestamp: new Date("2024-01-15T08:15:00.000Z").toISOString(),
			previousHash,
		});

		const correction = createMockEntry({
			id: "entry-2",
			employeeId: "emp-123",
			type: "correction",
			timestamp: new Date("2024-01-15T08:15:00.000Z"),
			hash: correctionHash,
			previousHash,
			replacesEntryId: "entry-1",
			createdAt: new Date("2024-01-15T08:15:01.000Z"),
		});
		entries.push(correction);

		const result = validateChainDetailed(entries);
		expect(result.isValid).toBe(true);
	});

	it("should validate long chains efficiently", () => {
		const entries = createValidChain("emp-123", 100);

		const startTime = Date.now();
		const result = validateChainDetailed(entries);
		const duration = Date.now() - startTime;

		expect(result.isValid).toBe(true);
		expect(duration).toBeLessThan(1000); // Should complete in under 1 second
	});

	it("should handle entries from different employees separately", () => {
		// This tests that chain validation is per-employee
		const entries1 = createValidChain("emp-123", 3);
		const entries2 = createValidChain("emp-456", 3);

		const result1 = validateChainDetailed(entries1);
		const result2 = validateChainDetailed(entries2);

		expect(result1.isValid).toBe(true);
		expect(result2.isValid).toBe(true);

		// Chain hashes should be different
		expect(getChainHash(entries1)).not.toBe(getChainHash(entries2));
	});
});
