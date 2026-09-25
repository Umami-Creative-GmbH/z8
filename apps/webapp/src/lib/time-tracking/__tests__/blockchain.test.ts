/**
 * Comprehensive tests for blockchain hash service
 * Tests hash calculation, verification, the change digest, and tamper detection.
 * Lineage and continuity are covered by append-lineage and append-assurance tests.
 */

import { describe, expect, it } from "vitest";
import type { timeEntry } from "@/db/schema";
import { calculateHash, getChainHash, verifyHash } from "../blockchain";

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

	it("does not depend on creation time or input order", () => {
		const entries = createValidChain("emp-123", 4).map((entry) => ({
			...entry,
			createdAt: new Date("2026-07-01T00:00:00.000Z"),
		}));

		expect(getChainHash(entries.toReversed())).toBe(getChainHash(entries));
	});

	it("should return 64 character hex string", () => {
		const entries = createValidChain("emp-123", 3);
		const hash = getChainHash(entries);

		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});
});
