/**
 * PostgreSQL contract (#1073): the correlated row predicates read the row in
 * scope of the query, whether they are selected from a single table or from a
 * join. Drizzle renders bare column names in a single-table select, so an
 * unqualified outer column inside `exists (...)` would bind to the subquery's
 * own table: pending reviews and invoiced work would never show, and a
 * project's customer of another organization would count as its customer.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { project, timeEntry, workPeriod } from "@/db/schema";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { unresolvedWorkPeriodReviewSql } from "@/lib/time-tracking/unresolved-work-period-review";
import { invoicedWorkPeriodSql } from "./hand-off/invoiced-work";
import { projectHasActiveCustomerSql } from "./project-customer";

describe("correlated row predicates on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function customer(organizationId: string, createdBy: string) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, $4, now())`,
			[id, organizationId, `Customer ${id.slice(0, 8)}`, createdBy],
		);
		return id;
	}

	async function projectOf(organizationId: string, customerId: string | null, createdBy: string) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into project (id, organization_id, name, status, is_active, customer_id, created_by, updated_at)
			 values ($1, $2, $3, 'active', true, $4, $5, now())`,
			[id, organizationId, `Project ${id.slice(0, 8)}`, customerId, createdBy],
		);
		return id;
	}

	async function invoice(organizationId: string, workPeriodId: string, customerId: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`with connection as (
			   insert into accounting_connection
			     (organization_id, provider_kind, status, account_ref, default_tax_treatment, default_tax_rate)
			   values ($1, 'lexware_office', 'active', 't1073-account', 'domestic_standard', 19)
			   returning id
			 )
			 insert into invoice_draft
			   (organization_id, connection_id, provider_kind, customer_id, status, idempotency_key, contact_id,
			    contact_name, currency, tax_treatment, tax_rate, period_from, period_to, title, net_total,
			    external_id, confirmed_at)
			 select $1, connection.id, 'lexware_office', $2, 'created', gen_random_uuid()::text, 'c-1',
			        'Acme', 'EUR', 'domestic_standard', 19, '2026-03-01', '2026-03-31', 'Invoice', 100.00,
			        'draft-1', now()
			   from connection
			 returning id`,
			[organizationId, customerId],
		);
		await fixture.pool.query(
			`insert into invoiced_work
			   (organization_id, invoice_draft_id, work_period_id, employee_id, project_id, started_at, ended_at,
			    start_offset_minutes, duration_minutes)
			 select organization_id, $3, id, employee_id, project_id, start_time, end_time, 0, duration_minutes
			   from work_period where organization_id = $1 and id = $2`,
			[organizationId, workPeriodId, rows[0]?.id],
		);
	}

	it("finds each work period's own pending review and invoice, with or without a join", async () => {
		const org = await fixture.organization("UTC");
		const person = await fixture.employee({ organizationId: org.organizationId });
		const acme = await customer(org.organizationId, org.ownerUserId);
		const website = await projectOf(org.organizationId, acme, org.ownerUserId);
		const marchWork = async (day: string) => {
			const work = await fixture.work({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				userId: person.userId,
				start: `2026-03-${day}T08:00:00Z`,
				end: `2026-03-${day}T12:00:00Z`,
			});
			await fixture.pool.query("update work_period set project_id = $2 where id = $1", [
				work.workPeriodId,
				website,
			]);
			return work.workPeriodId;
		};
		const plain = await marchWork("02");
		const withRequest = await marchWork("03");
		const withWorkflow = await marchWork("04");
		const invoiced = await marchWork("05");
		await fixture.pool.query(
			`insert into approval_request
			 (id, organization_id, entity_type, entity_id, requested_by, approver_id, status, reason, updated_at)
			 values ($1, $2, 'time_entry', $3, $4, $4, 'pending', 'Correction', now())`,
			[randomUUID(), org.organizationId, withRequest, person.employeeId],
		);
		await fixture.pool.query(
			`insert into approval_workflow
			 (id, organization_id, workflow_type, source_type, source_id, requester_employee_id,
			  status, version, policy_snapshot, context_snapshot, display_snapshot, updated_at)
			 values ($1, $2, 'time_correction', 'time_entry', $3, $4, 'pending', 1, '{}', '{}', '{}', now())`,
			[randomUUID(), org.organizationId, withWorkflow, person.employeeId],
		);
		await invoice(org.organizationId, invoiced, acme);

		const fields = {
			id: workPeriod.id,
			pendingReview: unresolvedWorkPeriodReviewSql(),
			invoiced: invoicedWorkPeriodSql(),
		};
		const singleTable = await fixture.db
			.select(fields)
			.from(workPeriod)
			.where(eq(workPeriod.organizationId, org.organizationId));
		const joined = await fixture.db
			.select(fields)
			.from(workPeriod)
			.innerJoin(timeEntry, eq(timeEntry.id, workPeriod.clockInId))
			.where(eq(workPeriod.organizationId, org.organizationId));

		const expected = new Map([
			[plain, { pendingReview: false, invoiced: false }],
			[withRequest, { pendingReview: true, invoiced: false }],
			[withWorkflow, { pendingReview: true, invoiced: false }],
			[invoiced, { pendingReview: false, invoiced: true }],
		]);
		for (const rows of [singleTable, joined]) {
			expect(new Map(rows.map(({ id, ...flags }) => [id, flags]))).toEqual(expected);
		}
	});

	it("counts only an active customer of the project's own organization, with or without a join", async () => {
		const org = await fixture.organization("UTC");
		const other = await fixture.organization("UTC");
		const own = await customer(org.organizationId, org.ownerUserId);
		const retired = await customer(org.organizationId, org.ownerUserId);
		await fixture.pool.query("update customer set is_active = false where id = $1", [retired]);
		const foreign = await customer(other.organizationId, other.ownerUserId);
		const withOwn = await projectOf(org.organizationId, own, org.ownerUserId);
		const withRetired = await projectOf(org.organizationId, retired, org.ownerUserId);
		// The single-column FK lets a project point at another organization's customer.
		const withForeign = await projectOf(org.organizationId, foreign, org.ownerUserId);
		const without = await projectOf(org.organizationId, null, org.ownerUserId);

		const fields = { id: project.id, hasCustomer: projectHasActiveCustomerSql() };
		const singleTable = await fixture.db
			.select(fields)
			.from(project)
			.where(eq(project.organizationId, org.organizationId));
		const joined = await fixture.db
			.select(fields)
			.from(project)
			.leftJoin(workPeriod, eq(workPeriod.projectId, project.id))
			.where(eq(project.organizationId, org.organizationId));

		const expected = new Map([
			[withOwn, true],
			[withRetired, false],
			[withForeign, false],
			[without, false],
		]);
		for (const rows of [singleTable, joined]) {
			expect(new Map(rows.map((row) => [row.id, row.hasCustomer]))).toEqual(expected);
		}
	});
});
