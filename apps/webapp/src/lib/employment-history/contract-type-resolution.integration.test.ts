import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { integrationDbModule } from "@/test/integration-database";
import { loadContractTypesOn, loadCurrentContractTypes } from "./load-terms-in-force";

describe("effective contract types", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(() => fixture?.close());
	beforeEach(async () => {
		await fixture.pool.query("delete from employee_employment_history where organization_id = $1", [
			fixture.organizationId,
		]);
		await fixture.pool.query("update organization set timezone = 'Europe/Berlin' where id = $1", [
			fixture.organizationId,
		]);
	});

	async function terms(input: {
		from: string;
		until?: string;
		type: "fixed" | "hourly";
		state?: "draft" | "pending" | "confirmed";
		organizationId?: string;
		employeeId?: string;
		createdAt?: string;
	}) {
		await fixture.pool.query(
			`insert into employee_employment_history
			 (employee_id, organization_id, valid_from, valid_until, contract_type,
			  weekly_contract_minutes, review_state, created_by, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, 2400, $6, $7, $8, now())`,
			[
				input.employeeId ?? fixture.employeeId,
				input.organizationId ?? fixture.organizationId,
				input.from,
				input.until ?? null,
				input.type,
				input.state ?? "confirmed",
				fixture.ownerUserId,
				input.createdAt ?? "2026-01-01T00:00:00Z",
			],
		);
	}

	async function on(day: string, fallback: "fixed" | "hourly" = "fixed") {
		const types = await loadContractTypesOn(fixture.db, {
			organizationId: fixture.organizationId,
			employees: [{ id: fixture.employeeId, contractType: fallback }],
			date: parsePlainDate(day),
		});
		return types.get(fixture.employeeId);
	}

	it.each([
		["Europe/Berlin", "2026-03-09T22:59:59Z", "2026-03-09T23:00:00Z"],
		["America/New_York", "2026-03-10T03:59:59Z", "2026-03-10T04:00:00Z"],
	])("activates future terms at local midnight in %s", async (timezone, before, after) => {
		await fixture.pool.query("update organization set timezone = $2 where id = $1", [
			fixture.organizationId,
			timezone,
		]);
		await terms({ from: "2026-03-10T00:00:00Z", type: "hourly" });
		const input = {
			organizationId: fixture.organizationId,
			employees: [{ id: fixture.employeeId, contractType: "fixed" as const }],
		};
		expect(
			(
				await loadCurrentContractTypes(fixture.db, {
					...input,
					now: parseInstant(before),
				})
			).get(fixture.employeeId),
		).toBe("fixed");
		expect(
			(
				await loadCurrentContractTypes(fixture.db, {
					...input,
					now: parseInstant(after),
				})
			).get(fixture.employeeId),
		).toBe("hourly");
	});

	it("switches to fixed terms at the exclusive boundary and retains the fallback in a gap", async () => {
		await terms({ from: "2026-03-01", until: "2026-03-10", type: "hourly" });
		await terms({ from: "2026-03-10", until: "2026-03-12", type: "fixed" });
		expect(await on("2026-03-09", "hourly")).toBe("hourly");
		expect(await on("2026-03-10", "hourly")).toBe("fixed");
		expect(await on("2026-03-12", "hourly")).toBe("hourly");
	});

	it("keeps fixed and hourly fallback types without confirmed terms", async () => {
		await terms({ from: "2026-01-01", type: "fixed", state: "draft" });
		await terms({ from: "2026-01-01", type: "fixed", state: "pending" });
		expect(await on("2026-03-10", "hourly")).toBe("hourly");
		expect(await on("2026-03-10", "fixed")).toBe("fixed");
	});

	it("ignores proposals and uses the shared overlap and same-day precedence", async () => {
		await terms({ from: "2026-01-01", type: "fixed" });
		await terms({ from: "2026-03-01", type: "fixed" });
		await terms({
			from: "2026-03-01",
			type: "hourly",
			createdAt: "2026-02-01T00:00:00Z",
		});
		await terms({ from: "2026-03-09", type: "fixed", state: "draft" });
		await terms({ from: "2026-03-10", type: "fixed", state: "pending" });
		expect(await on("2026-03-10")).toBe("hourly");
	});

	it("interprets rehire instants and departure cutoffs as organization-local dates", async () => {
		await terms({
			from: "2026-03-09T23:30:00Z",
			until: "2026-03-11T23:00:00Z",
			type: "hourly",
		});
		expect(await on("2026-03-09")).toBe("fixed");
		expect(await on("2026-03-10")).toBe("hourly");
		expect(await on("2026-03-12")).toBe("fixed");
	});

	it("ignores another organization's terms even for the same employee identity", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		await terms({ from: "2026-01-01", type: "hourly" });
		await terms({
			from: "2026-03-01",
			type: "fixed",
			organizationId: otherOrganizationId,
		});
		expect(await on("2026-03-10")).toBe("hourly");
	});

	it("keeps the query count bounded as the authorized employee list grows", async () => {
		const employees = [{ id: fixture.employeeId, contractType: "fixed" as const }];
		for (let index = 0; index < 12; index++) {
			const person = await fixture.seedEmployee();
			employees.push({ id: person.employeeId, contractType: "fixed" });
		}
		for (const person of employees)
			await terms({
				from: "2026-01-01",
				type: "hourly",
				employeeId: person.id,
			});
		const queries: string[] = [];
		const { db } = await integrationDbModule({
			logQuery: (query) => queries.push(query),
		});
		const types = await loadCurrentContractTypes(db, {
			organizationId: fixture.organizationId,
			employees,
			now: parseInstant("2026-03-10T12:00:00Z"),
		});
		expect([...types.values()]).toEqual(Array(13).fill("hourly"));
		expect(queries).toHaveLength(2);
		queries.length = 0;
		expect(
			await loadCurrentContractTypes(db, {
				organizationId: fixture.organizationId,
				employees: [],
			}),
		).toEqual(new Map());
		expect(queries).toHaveLength(0);
	});
});
