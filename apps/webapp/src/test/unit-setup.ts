import { afterAll, afterEach, vi } from "vitest";
import { assertNoUnitProjectDatabaseRefusals } from "@/db/unit-project-guard";
import { createTestTemporalNow } from "./temporal-test-clock";

const realDate = vi.hoisted(() => Date);

vi.mock("temporal-polyfill", async (importOriginal) => {
	const actual = await importOriginal<typeof import("temporal-polyfill")>();
	const temporal = Object.create(Object.getPrototypeOf(actual.Temporal), {
		...Object.getOwnPropertyDescriptors(actual.Temporal),
		Now: {
			...Object.getOwnPropertyDescriptor(actual.Temporal, "Now"),
			value: createTestTemporalNow(
				actual.Temporal,
				() => vi.isFakeTimers() || Date !== realDate,
			),
		},
	});
	return Object.create(Object.getPrototypeOf(actual), {
		...Object.getOwnPropertyDescriptors(actual),
		Temporal: {
			...Object.getOwnPropertyDescriptor(actual, "Temporal"),
			value: temporal,
		},
	});
});

// Resolve the original before a test's hoisted fake clock can replace global
// Temporal. Only the imported Now view is replaced; constructors stay shared.
await import("temporal-polyfill");

// The unit project's setupFiles. A refused PostgreSQL connection fails the test
// that caused it, even when the code under test caught and swallowed the error.
afterEach(assertNoUnitProjectDatabaseRefusals);
afterAll(assertNoUnitProjectDatabaseRefusals);
