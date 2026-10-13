/**
 * PostgreSQL contract for the employment terms wage command (#1177): one
 * transaction, the employee row locked, neighbouring confirmed terms adjusted,
 * everything scoped to one organization.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { changeHourlyWage, confirmEmploymentTerms, writeEmploymentTerms } from "./write-terms";

type TermsRow = {
	id: string;
	valid_from: Date;
	valid_until: Date | null;
	contract_type: string;
	weekly_contract_minutes: number;
	work_model: string;
	work_policy_id: string | null;
	hourly_rate: string | null;
	currency: string;
	change_reason: string | null;
	review_state: string;
	organization_id: string;
};

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const hourlyTerms = {
	status: "active" as const,
	contractType: "hourly" as const,
	weeklyContractMinutes: 2400,
	workModel: "onsite" as const,
	workPolicyId: null,
	currency: "EUR",
	changeReason: null,
	probationStartsOn: null,
	probationEndsOn: null,
};

describe("employment terms wage command", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let otherOrganizationId: string;

	async function termsOf(employeeId: string): Promise<TermsRow[]> {
		const { rows } = await fixture.pool.query<TermsRow>(
			`select id, valid_from, valid_until, contract_type, weekly_contract_minutes, work_model,
			        work_policy_id, hourly_rate::text, currency, change_reason, review_state, organization_id
			 from employee_employment_history where employee_id = $1
			 order by valid_from, created_at`,
			[employeeId],
		);
		return rows;
	}

	async function seedTerms(input: {
		employeeId?: string;
		organizationId?: string;
		validFrom: string;
		validUntil?: string | null;
		hourlyRate?: string | null;
		contractType?: "fixed" | "hourly";
		reviewState?: "draft" | "confirmed";
		workModel?: string;
		weeklyMinutes?: number;
		currency?: string;
		workPolicyId?: string | null;
	}): Promise<string> {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into employee_employment_history
			 (employee_id, organization_id, employment_period_id, valid_from, valid_until,
			  contract_type, weekly_contract_minutes, work_model, work_policy_id, hourly_rate, currency,
			  review_state, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
			 returning id`,
			[
				input.employeeId ?? fixture.employeeId,
				input.organizationId ?? fixture.organizationId,
				input.employeeId ? null : fixture.employmentPeriodId,
				`${input.validFrom} 00:00:00`,
				input.validUntil ? `${input.validUntil} 00:00:00` : null,
				input.contractType ?? "hourly",
				input.weeklyMinutes ?? 2400,
				input.workModel ?? "onsite",
				input.workPolicyId ?? null,
				input.contractType === "fixed" ? null : (input.hourlyRate ?? "20.00"),
				input.currency ?? "EUR",
				input.reviewState ?? "confirmed",
				fixture.ownerUserId,
			],
		);
		return rows[0]!.id;
	}

	async function createWorkPolicy(organizationId: string, name: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[organizationId, name, fixture.ownerUserId],
		);
		return rows[0]!.id;
	}

	const own = () => ({
		organizationId: fixture.organizationId,
		employeeId: fixture.employeeId,
		actorUserId: fixture.ownerUserId,
	});

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		otherOrganizationId = await fixture.createOrganization();
	});

	beforeEach(async () => {
		await fixture.pool.query("delete from employee_employment_history where employee_id = $1", [
			fixture.employeeId,
		]);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("closes the previous confirmed terms and ends the new terms where the next ones start", async () => {
		const previous = await seedTerms({ validFrom: "2026-01-01", hourlyRate: "20.00" });
		const following = await seedTerms({ validFrom: "2026-09-01", hourlyRate: "30.00" });
		await fixture.pool.query(
			"update employee_employment_history set valid_until = $2 where id = $1",
			[previous, "2026-09-01 00:00:00"],
		);

		const written = await fixture.db.transaction((tx) =>
			writeEmploymentTerms(tx, {
				...own(),
				terms: {
					...hourlyTerms,
					validFrom: day("2026-05-01"),
					hourlyRate: 25,
					reviewState: "confirmed",
				},
			}),
		);

		expect(written.hourlyRate).toBe(25);
		const rows = await termsOf(fixture.employeeId);
		expect(
			rows.map((row) => [
				row.id === previous ? "previous" : row.id === following ? "following" : "new",
				row.valid_from.toISOString().slice(0, 10),
				row.valid_until?.toISOString().slice(0, 10) ?? null,
				row.hourly_rate,
			]),
		).toEqual([
			["previous", "2026-01-01", "2026-05-01", "20.00"],
			["new", "2026-05-01", "2026-09-01", "25.00"],
			["following", "2026-09-01", null, "30.00"],
		]);
	});

	it("leaves the confirmed timeline alone for draft terms", async () => {
		await seedTerms({ validFrom: "2026-01-01" });

		await fixture.db.transaction((tx) =>
			writeEmploymentTerms(tx, {
				...own(),
				terms: { ...hourlyTerms, validFrom: day("2026-05-01"), hourlyRate: 25, reviewState: "draft" },
			}),
		);

		const rows = await termsOf(fixture.employeeId);
		expect(rows.map((row) => [row.review_state, row.valid_until])).toEqual([
			["confirmed", null],
			["draft", null],
		]);
	});

	it("writes nothing when the caller's transaction rolls back", async () => {
		await seedTerms({ validFrom: "2026-01-01" });

		await expect(
			fixture.db.transaction(async (tx) => {
				await writeEmploymentTerms(tx, {
					...own(),
					terms: {
						...hourlyTerms,
						validFrom: day("2026-05-01"),
						hourlyRate: 25,
						reviewState: "confirmed",
					},
				});
				throw new Error("caller failed after the command");
			}),
		).rejects.toThrow("caller failed after the command");

		const rows = await termsOf(fixture.employeeId);
		expect(rows.map((row) => [row.hourly_rate, row.valid_until])).toEqual([["20.00", null]]);
	});

	it("waits for the employee row lock before it reads the timeline", async () => {
		await seedTerms({ validFrom: "2026-01-01" });
		const holder = await fixture.pool.connect();
		try {
			await holder.query("begin");
			await holder.query("select id from employee where id = $1 for update", [fixture.employeeId]);

			let settled = false;
			const pending = fixture.db
				.transaction((tx) =>
					writeEmploymentTerms(tx, {
						...own(),
						terms: {
							...hourlyTerms,
							validFrom: day("2026-05-01"),
							hourlyRate: 25,
							reviewState: "confirmed",
						},
					}),
				)
				.finally(() => {
					settled = true;
				});

			// While the row is held, a concurrent confirmed terms row lands first.
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(settled).toBe(false);
			await holder.query(
				`insert into employee_employment_history
				 (employee_id, organization_id, employment_period_id, valid_from, contract_type,
				  weekly_contract_minutes, hourly_rate, currency, review_state, created_by, updated_at)
				 values ($1, $2, $3, '2026-03-01 00:00:00', 'hourly', 2400, 22, 'EUR', 'confirmed', $4, now())`,
				[fixture.employeeId, fixture.organizationId, fixture.employmentPeriodId, fixture.ownerUserId],
			);
			await holder.query("commit");
			await pending;
		} finally {
			holder.release();
		}

		// The command saw the committed row: it closed the March terms, not January's.
		const rows = await termsOf(fixture.employeeId);
		expect(
			rows.map((row) => [
				row.valid_from.toISOString().slice(0, 10),
				row.valid_until?.toISOString().slice(0, 10) ?? null,
			]),
		).toEqual([
			["2026-01-01", null],
			["2026-03-01", "2026-05-01"],
			["2026-05-01", null],
		]);
	});

	it("refuses an employee of another organization and touches none of its terms", async () => {
		const foreign = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		await seedTerms({
			employeeId: foreign.employeeId,
			organizationId: otherOrganizationId,
			validFrom: "2026-01-01",
		});

		await expect(
			fixture.db.transaction((tx) =>
				writeEmploymentTerms(tx, {
					organizationId: fixture.organizationId,
					employeeId: foreign.employeeId,
					actorUserId: fixture.ownerUserId,
					terms: {
						...hourlyTerms,
						validFrom: day("2026-05-01"),
						hourlyRate: 25,
						reviewState: "confirmed",
					},
				}),
			),
		).rejects.toBeInstanceOf(NotFoundError);

		const rows = await termsOf(foreign.employeeId);
		expect(rows.map((row) => [row.organization_id, row.valid_until])).toEqual([
			[otherOrganizationId, null],
		]);
	});

	it("refuses a work policy of another organization", async () => {
		const foreignPolicy = await createWorkPolicy(otherOrganizationId, "Foreign policy");

		await expect(
			fixture.db.transaction((tx) =>
				writeEmploymentTerms(tx, {
					...own(),
					terms: {
						...hourlyTerms,
						workPolicyId: foreignPolicy,
						validFrom: day("2026-05-01"),
						hourlyRate: 25,
						reviewState: "confirmed",
					},
				}),
			),
		).rejects.toBeInstanceOf(NotFoundError);
		expect(await termsOf(fixture.employeeId)).toEqual([]);
	});

	it("never stores a wage on fixed terms", async () => {
		const written = await fixture.db.transaction((tx) =>
			writeEmploymentTerms(tx, {
				...own(),
				terms: {
					...hourlyTerms,
					contractType: "fixed",
					validFrom: day("2026-05-01"),
					hourlyRate: 25,
					reviewState: "confirmed",
				},
			}),
		);

		expect(written.hourlyRate).toBeNull();
	});

	it("refuses hourly terms without a wage", async () => {
		await expect(
			fixture.db.transaction((tx) =>
				writeEmploymentTerms(tx, {
					...own(),
					terms: {
						...hourlyTerms,
						validFrom: day("2026-05-01"),
						hourlyRate: null,
						reviewState: "confirmed",
					},
				}),
			),
		).rejects.toBeInstanceOf(ValidationError);
	});

	it("confirms draft terms and adjusts the neighbouring confirmed terms", async () => {
		await seedTerms({ validFrom: "2026-01-01", hourlyRate: "20.00" });
		const draft = await seedTerms({
			validFrom: "2026-05-01",
			hourlyRate: "25.00",
			reviewState: "draft",
		});

		const confirmed = await fixture.db.transaction((tx) =>
			confirmEmploymentTerms(tx, { ...own(), termsId: draft }),
		);

		expect(confirmed.reviewState).toBe("confirmed");
		const rows = await termsOf(fixture.employeeId);
		expect(
			rows.map((row) => [
				row.review_state,
				row.valid_from.toISOString().slice(0, 10),
				row.valid_until?.toISOString().slice(0, 10) ?? null,
			]),
		).toEqual([
			["confirmed", "2026-01-01", "2026-05-01"],
			["confirmed", "2026-05-01", null],
		]);
	});

	it("refuses to confirm terms of another organization", async () => {
		const foreign = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		const foreignDraft = await seedTerms({
			employeeId: foreign.employeeId,
			organizationId: otherOrganizationId,
			validFrom: "2026-05-01",
			reviewState: "draft",
		});

		await expect(
			fixture.db.transaction((tx) =>
				confirmEmploymentTerms(tx, { ...own(), termsId: foreignDraft }),
			),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	describe("change wage", () => {
		it("copies every other field from the terms in force on the date", async () => {
			const policy = await createWorkPolicy(fixture.organizationId, `Policy ${Date.now()}`);
			await seedTerms({
				validFrom: "2026-01-01",
				hourlyRate: "20.00",
				weeklyMinutes: 1800,
				workModel: "remote",
				currency: "CHF",
				workPolicyId: policy,
			});

			const written = await fixture.db.transaction((tx) =>
				changeHourlyWage(tx, {
					...own(),
					effectiveOn: parsePlainDate("2026-06-15"),
					hourlyRate: 24.5,
					changeReason: "Annual review",
					reviewState: "confirmed",
				}),
			);

			expect(written).toMatchObject({
				validFrom: day("2026-06-15"),
				validUntil: null,
				contractType: "hourly",
				weeklyContractMinutes: 1800,
				workModel: "remote",
				workPolicyId: policy,
				currency: "CHF",
				hourlyRate: 24.5,
				changeReason: "Annual review",
				reviewState: "confirmed",
			});
			const rows = await termsOf(fixture.employeeId);
			expect(rows.map((row) => [row.hourly_rate, row.valid_until?.toISOString() ?? null])).toEqual([
				["20.00", day("2026-06-15").toISOString()],
				["24.50", null],
			]);
		});

		it("saves the change as a draft when asked", async () => {
			await seedTerms({ validFrom: "2026-01-01" });

			const written = await fixture.db.transaction((tx) =>
				changeHourlyWage(tx, {
					...own(),
					effectiveOn: parsePlainDate("2026-06-15"),
					hourlyRate: 24.5,
					changeReason: "Proposal",
					reviewState: "draft",
				}),
			);

			expect(written.reviewState).toBe("draft");
			const rows = await termsOf(fixture.employeeId);
			expect(rows.map((row) => row.valid_until)).toEqual([null, null]);
		});

		it("refuses when the terms in force on the date are not hourly", async () => {
			await seedTerms({ validFrom: "2026-01-01", contractType: "fixed" });

			await expect(
				fixture.db.transaction((tx) =>
					changeHourlyWage(tx, {
						...own(),
						effectiveOn: parsePlainDate("2026-06-15"),
						hourlyRate: 24.5,
						changeReason: "Raise",
						reviewState: "confirmed",
					}),
				),
			).rejects.toBeInstanceOf(ValidationError);
		});

		it("refuses when no confirmed terms are in force on the date", async () => {
			await seedTerms({ validFrom: "2026-08-01" });

			await expect(
				fixture.db.transaction((tx) =>
					changeHourlyWage(tx, {
						...own(),
						effectiveOn: parsePlainDate("2026-06-15"),
						hourlyRate: 24.5,
						changeReason: "Raise",
						reviewState: "confirmed",
					}),
				),
			).rejects.toBeInstanceOf(ValidationError);
		});
	});
});
