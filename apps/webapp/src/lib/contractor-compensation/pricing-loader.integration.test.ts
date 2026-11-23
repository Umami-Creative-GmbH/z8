/**
 * Contractor pricing on PostgreSQL (#1998): real work periods with captured
 * offsets, real terms through the writer, priced by `priceContractorDays`.
 * Covers the three daily rules with their exact boundaries, hourly pricing
 * across a mid-period rate change, local midnight and time zones, ended
 * engagements and tenant isolation.
 */
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { unitsToDecimal } from "./pricing";
import { priceContractorDays } from "./pricing-loader";
import { changeContractorTerms } from "./store";
import type { ContractorCompensationInput } from "./terms";

const day = (value: string) => Temporal.PlainDate.from(value);

describe("contractor pricing on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function contractor(organizationId = fixture.organizationId) {
		const seeded = await fixture.seedEmployee({ organizationId, engagementKind: "contractor" });
		return seeded.employeeId;
	}

	async function setTerms(
		employeeId: string,
		effectiveFrom: string,
		compensation: ContractorCompensationInput,
		organizationId = fixture.organizationId,
	) {
		const outcome = await changeContractorTerms(db, {
			organizationId,
			actorUserId: fixture.ownerUserId,
			employeeId,
			change: { kind: "set", effectiveFrom, compensation },
		});
		if (!outcome.ok) throw new Error(outcome.reason);
	}

	async function completedWork(input: {
		employeeId: string;
		start: string;
		end: string;
		minutes?: number;
		offset?: number;
		timezone?: string;
		organizationId?: string;
		active?: boolean;
	}) {
		const organizationId = input.organizationId ?? fixture.organizationId;
		const clockIn = randomUUID();
		const clockOut = randomUUID();
		const minutes =
			input.minutes ??
			Temporal.Instant.from(input.end).since(Temporal.Instant.from(input.start)).total("minutes");
		await withCanonicalRecords(fixture.pool, async (client) => {
			for (const [id, type, timestamp] of [
				[clockIn, "clock_in", input.start],
				[clockOut, "clock_out", input.end],
			]) {
				await client.query(
					`insert into time_entry (id, employee_id, organization_id, type, timestamp,
					 utc_offset_minutes, timezone, timezone_source, hash, created_by)
					 values ($1::uuid, $2, $3, $4, $5, $6, $7, 'user_setting', $1::uuid::text, $8)`,
					[
						id,
						input.employeeId,
						organizationId,
						type,
						timestamp,
						input.offset ?? 0,
						input.timezone ?? "UTC",
						fixture.ownerUserId,
					],
				);
			}
			await client.query(
				`insert into work_period (employee_id, organization_id, clock_in_id, clock_out_id,
				 start_time, end_time, duration_minutes, is_active, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
				[
					input.employeeId,
					organizationId,
					clockIn,
					clockOut,
					input.start,
					input.end,
					minutes,
					input.active ?? false,
				],
			);
		});
	}

	async function price(
		employeeId: string,
		fromDay: string,
		toDay: string,
		organizationId?: string,
	) {
		const result = await priceContractorDays(db, organizationId ?? fixture.organizationId, {
			employeeIds: [employeeId],
			fromDay: day(fromDay),
			toDay: day(toDay),
		});
		return {
			days: result.days.map((entry) => ({
				date: entry.date.toString(),
				minutes: entry.workedMs / 60_000,
				units: entry.pricing.kind === "priced" ? unitsToDecimal(entry.pricing.units, 4) : null,
				amount: entry.pricing.kind === "priced" ? Number(entry.pricing.amountMinor) : null,
			})),
			totals: result.totals.map((total) => ({
				currency: total.currency,
				amount: Number(total.amountMinor),
				days: unitsToDecimal(total.dayUnits, 2),
				hours: unitsToDecimal(total.hourUnits, 2),
			})),
		};
	}

	it("bills any day with work as a full day", async () => {
		const employeeId = await contractor();
		await setTerms(employeeId, "2026-03-01", {
			basis: "daily",
			rateAmount: "650",
			currency: "EUR",
			dayUnitRule: "any_work_full_day",
		});
		await completedWork({ employeeId, start: "2026-03-02T09:00:00Z", end: "2026-03-02T09:01:00Z" });
		await completedWork({ employeeId, start: "2026-03-03T08:00:00Z", end: "2026-03-03T18:00:00Z" });

		expect(await price(employeeId, "2026-03-01", "2026-03-31")).toEqual({
			days: [
				{ date: "2026-03-02", minutes: 1, units: "1.0000", amount: 65_000 },
				{ date: "2026-03-03", minutes: 600, units: "1.0000", amount: 65_000 },
			],
			totals: [{ currency: "EUR", amount: 130_000, days: "2.00", hours: "0.00" }],
		});
	});

	it("bills half days up to and including the threshold and full days above it", async () => {
		const employeeId = await contractor();
		await setTerms(employeeId, "2026-03-01", {
			basis: "daily",
			rateAmount: "600",
			currency: "EUR",
			dayUnitRule: "half_and_full_day",
			halfDayThresholdMinutes: 240,
		});
		await completedWork({ employeeId, start: "2026-03-02T09:00:00Z", end: "2026-03-02T13:00:00Z" });
		await completedWork({ employeeId, start: "2026-03-03T09:00:00Z", end: "2026-03-03T13:01:00Z" });

		expect((await price(employeeId, "2026-03-01", "2026-03-31")).days).toEqual([
			{ date: "2026-03-02", minutes: 240, units: "0.5000", amount: 30_000 },
			{ date: "2026-03-03", minutes: 241, units: "1.0000", amount: 60_000 },
		]);
	});

	it("prorates by the standard day, capped or not", async () => {
		const capped = await contractor();
		const uncapped = await contractor();
		for (const [employeeId, capAtOneDay] of [
			[capped, true],
			[uncapped, false],
		] as const) {
			await setTerms(employeeId, "2026-03-01", {
				basis: "daily",
				rateAmount: "800",
				currency: "EUR",
				dayUnitRule: "prorated_by_standard_day",
				standardDayMinutes: 480,
				capAtOneDay,
			});
			await completedWork({
				employeeId,
				start: "2026-03-02T09:00:00Z",
				end: "2026-03-02T15:00:00Z",
			});
			await completedWork({
				employeeId,
				start: "2026-03-03T08:00:00Z",
				end: "2026-03-03T16:00:00Z",
			});
			await completedWork({
				employeeId,
				start: "2026-03-04T07:00:00Z",
				end: "2026-03-04T17:00:00Z",
			});
		}

		expect(
			(await price(capped, "2026-03-01", "2026-03-31")).days.map((entry) => entry.units),
		).toEqual(["0.7500", "1.0000", "1.0000"]);
		expect(await price(uncapped, "2026-03-01", "2026-03-31")).toMatchObject({
			days: [{ units: "0.7500" }, { units: "1.0000" }, { units: "1.2500", amount: 100_000 }],
			totals: [{ amount: 240_000, days: "3.00" }],
		});
	});

	it("prices hourly work before and after a mid-period rate change", async () => {
		const employeeId = await contractor();
		await setTerms(employeeId, "2026-03-01", {
			basis: "hourly",
			rateAmount: "90",
			currency: "EUR",
		});
		await setTerms(employeeId, "2026-03-16", {
			basis: "hourly",
			rateAmount: "100",
			currency: "EUR",
		});
		await completedWork({
			employeeId,
			start: "2026-03-13T09:00:00Z",
			end: "2026-03-13T17:30:00Z",
			minutes: 480,
		});
		await completedWork({ employeeId, start: "2026-03-16T09:00:00Z", end: "2026-03-16T17:00:00Z" });

		expect(await price(employeeId, "2026-03-01", "2026-03-31")).toEqual({
			days: [
				{ date: "2026-03-13", minutes: 480, units: "8.0000", amount: 72_000 },
				{ date: "2026-03-16", minutes: 480, units: "8.0000", amount: 80_000 },
			],
			totals: [{ currency: "EUR", amount: 152_000, days: "0.00", hours: "16.00" }],
		});
	});

	it("splits work at local midnight and groups it by the captured offset", async () => {
		const employeeId = await contractor();
		await setTerms(employeeId, "2026-06-01", {
			basis: "daily",
			rateAmount: "600",
			currency: "EUR",
			dayUnitRule: "half_and_full_day",
		});
		// 20:00–04:00 in Berlin (+02:00): 4 h on 1 June and 4 h on 2 June.
		await completedWork({
			employeeId,
			start: "2026-06-01T18:00:00Z",
			end: "2026-06-02T02:00:00Z",
			offset: 120,
			timezone: "Europe/Berlin",
		});
		// 22:30 UTC on 5 June is already 6 June in Berlin.
		await completedWork({
			employeeId,
			start: "2026-06-05T22:30:00Z",
			end: "2026-06-05T23:30:00Z",
			offset: 120,
			timezone: "Europe/Berlin",
		});
		// 01:00 UTC on 8 June is still 7 June in New York (-04:00).
		await completedWork({
			employeeId,
			start: "2026-06-08T01:00:00Z",
			end: "2026-06-08T03:00:00Z",
			offset: -240,
			timezone: "America/New_York",
		});

		expect((await price(employeeId, "2026-06-01", "2026-06-30")).days).toEqual([
			{ date: "2026-06-01", minutes: 240, units: "0.5000", amount: 30_000 },
			{ date: "2026-06-02", minutes: 240, units: "0.5000", amount: 30_000 },
			{ date: "2026-06-06", minutes: 60, units: "0.5000", amount: 30_000 },
			{ date: "2026-06-07", minutes: 120, units: "0.5000", amount: 30_000 },
		]);
		// The range edge cuts work at local midnight, not at the UTC day.
		expect(
			(await price(employeeId, "2026-06-02", "2026-06-06")).days.map((entry) => entry.date),
		).toEqual(["2026-06-02", "2026-06-06"]);
	});

	it("leaves work without terms unpriced and ignores live work", async () => {
		const employeeId = await contractor();
		await setTerms(employeeId, "2026-03-10", {
			basis: "hourly",
			rateAmount: "90",
			currency: "EUR",
		});
		await completedWork({ employeeId, start: "2026-03-09T09:00:00Z", end: "2026-03-09T10:00:00Z" });
		await completedWork({
			employeeId,
			start: "2026-03-10T09:00:00Z",
			end: "2026-03-10T10:00:00Z",
			active: true,
		});

		expect((await price(employeeId, "2026-03-01", "2026-03-31")).days).toEqual([
			{ date: "2026-03-09", minutes: 60, units: null, amount: null },
		]);
	});

	it("stops pricing at the end of the engagement even when its terms were left open", async () => {
		const employeeId = await contractor();
		await setTerms(employeeId, "2026-03-01", {
			basis: "hourly",
			rateAmount: "90",
			currency: "EUR",
		});
		await fixture.pool.query(
			`update employee_employment_period set status = 'closed', ended_at = '2026-03-15T23:00:00Z'
			 where employee_id = $1`,
			[employeeId],
		);
		await completedWork({ employeeId, start: "2026-03-15T09:00:00Z", end: "2026-03-15T10:00:00Z" });
		await completedWork({ employeeId, start: "2026-03-17T09:00:00Z", end: "2026-03-17T10:00:00Z" });

		expect(
			(await price(employeeId, "2026-03-01", "2026-03-31")).days.map((entry) => [
				entry.date,
				entry.amount,
			]),
		).toEqual([
			["2026-03-15", 9_000],
			["2026-03-17", null],
		]);
	});

	it("never prices another organization's contractor", async () => {
		const otherOrganization = await fixture.createOrganization();
		const foreign = await contractor(otherOrganization);
		await setTerms(
			foreign,
			"2026-03-01",
			{ basis: "hourly", rateAmount: "90", currency: "EUR" },
			otherOrganization,
		);
		await completedWork({
			employeeId: foreign,
			organizationId: otherOrganization,
			start: "2026-03-02T09:00:00Z",
			end: "2026-03-02T10:00:00Z",
		});

		expect(await price(foreign, "2026-03-01", "2026-03-31")).toEqual({ days: [], totals: [] });
		expect((await price(foreign, "2026-03-01", "2026-03-31", otherOrganization)).totals).toEqual([
			{ currency: "EUR", amount: 9_000, days: "0.00", hours: "1.00" },
		]);
	});
});
