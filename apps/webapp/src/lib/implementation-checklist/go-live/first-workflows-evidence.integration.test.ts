import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { loadFirstWorkflowEvidence } from "./first-workflows-evidence";
import { resolveGoLiveGroup } from "./group";
import { goLiveAsOf } from "./run";
import type { GoLiveGroup } from "./types";

const AS_OF = goLiveAsOf(parseInstant("2026-06-15T10:00:00Z"), "Europe/Berlin");

describe("first-workflow evidence (PostgreSQL)", () => {
	let fixture: LifecycleDatabaseFixture;
	let db: DatabaseClient;

	async function seedNamed(organizationId: string, name: string, isActive = true) {
		const seeded = await fixture.seedEmployee({ organizationId, isActive });
		await fixture.pool.query(`update "user" set name = $1 where id = $2`, [name, seeded.userId]);
		return seeded;
	}

	async function organizationWith(...names: string[]) {
		const organizationId = await fixture.createOrganization();
		const people: SeededEmployee[] = [];
		for (const name of names) people.push(await seedNamed(organizationId, name));
		return { organizationId, people };
	}

	async function evidence(organizationId: string, group?: GoLiveGroup, database = db) {
		return loadFirstWorkflowEvidence({
			db: database,
			organizationId,
			group: group ?? (await resolveGoLiveGroup(db, organizationId, AS_OF)),
			asOf: AS_OF,
		});
	}

	async function recordWork(
		organizationId: string,
		person: SeededEmployee,
		startAt: string,
		origin: "clock" | "manual" | "import" = "clock",
	) {
		await fixture.pool.query(
			`insert into time_record (organization_id, employee_id, record_kind, start_at, end_at,
			   duration_minutes, approval_state, origin, created_by, updated_at)
			 values ($1, $2, 'work', $3::timestamptz, $3::timestamptz + interval '1 hour', 60,
			   'approved', $4, $5, now())`,
			[organizationId, person.employeeId, startAt, origin, person.userId],
		);
	}

	async function clockIn(organizationId: string, person: SeededEmployee, at: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into time_entry (employee_id, organization_id, type, timestamp, utc_offset_minutes,
			   timezone_source, hash, created_by)
			 values ($1, $2, 'clock_in', $3::timestamptz, 120, 'organization', $4, $5) returning id`,
			[person.employeeId, organizationId, at, randomUUID(), person.userId],
		);
		await fixture.pool.query(
			`insert into work_period (employee_id, organization_id, clock_in_id, start_time, is_active, updated_at)
			 values ($1, $2, $3, $4::timestamptz, true, now())`,
			[person.employeeId, organizationId, rows[0]?.id, at],
		);
	}

	async function legacyRequest(
		organizationId: string,
		requester: SeededEmployee,
		approver: SeededEmployee,
		input: {
			status: "pending" | "approved" | "rejected";
			approvedAt?: string | null;
			updatedAt: string;
		},
	) {
		await fixture.pool.query(
			`insert into approval_request (organization_id, entity_type, entity_id, requested_by,
			   approver_id, status, approved_at, created_at, updated_at)
			 values ($1, 'absence_entry', $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $7::timestamptz)`,
			[
				organizationId,
				randomUUID(),
				requester.employeeId,
				approver.employeeId,
				input.status,
				input.approvedAt ?? null,
				input.updatedAt,
			],
		);
	}

	async function workflow(
		organizationId: string,
		requester: SeededEmployee,
		input: { status: "pending" | "approved" | "rejected" | "cancelled"; completedAt?: string },
	) {
		await fixture.pool.query(
			`insert into approval_workflow (organization_id, workflow_type, source_type, source_id,
			   requester_employee_id, status, policy_snapshot, context_snapshot, display_snapshot,
			   completed_at, updated_at)
			 values ($1, 'absence', 'absence_entry', $2, $3, $4, '{}', '{}', '{}', $5::timestamptz, now())`,
			[organizationId, randomUUID(), requester.employeeId, input.status, input.completedAt ?? null],
		);
	}

	async function exportJob(
		organizationId: string,
		requester: SeededEmployee,
		input: { status: "completed" | "failed" | "processing"; completedAt?: string },
	) {
		await fixture.pool.query(
			`insert into payroll_export_format (id, name, version, updated_at)
			 values ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()) on conflict (id) do nothing`,
		);
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into payroll_export_config (organization_id, format_id, config, is_active, created_by, updated_at)
			 values ($1, 'datev_lohn', '{}'::jsonb, false, $2, now()) returning id`,
			[organizationId, requester.userId],
		);
		await fixture.pool.query(
			`insert into payroll_export_job (organization_id, config_id, requested_by_id, filters, status,
			   created_at, completed_at)
			 values ($1, $2, $3, '{}'::jsonb, $4, coalesce($5::timestamptz, now()), $5::timestamptz)`,
			[organizationId, rows[0]?.id, requester.employeeId, input.status, input.completedAt ?? null],
		);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		db = fixture.db as unknown as DatabaseClient;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("shows every line as not yet without any activity", async () => {
		const { organizationId } = await organizationWith("Quiet");

		expect(await evidence(organizationId)).toEqual({
			clockIn: { state: "not-yet" },
			decidedApproval: { state: "not-yet" },
			payrollExport: { state: "not-yet" },
		});
	});

	it("shows the first clock-in by a member, ignoring manual work, former employees, people outside the group and other organizations", async () => {
		const {
			organizationId,
			people: [ada, ben, outsider],
		} = await organizationWith("Ada", "Ben", "Outsider");
		const former = await seedNamed(organizationId, "Former", false);
		const elsewhere = await organizationWith("Elsewhere");
		await recordWork(organizationId, ada, "2026-06-02T07:30:00Z");
		await recordWork(organizationId, ada, "2026-06-03T07:30:00Z");
		await recordWork(organizationId, ben, "2026-05-01T07:00:00Z", "manual");
		await recordWork(organizationId, ben, "2026-05-02T07:00:00Z", "import");
		await recordWork(organizationId, former, "2026-05-03T07:00:00Z");
		await recordWork(organizationId, outsider, "2026-05-04T07:00:00Z");
		await recordWork(elsewhere.organizationId, elsewhere.people[0], "2026-05-05T07:00:00Z");
		const roster = await resolveGoLiveGroup(db, organizationId, AS_OF);
		const group: GoLiveGroup = {
			...roster,
			members: roster.members.filter(
				(member) => member.kind !== "employee" || member.employeeId !== outsider.employeeId,
			),
		};

		expect((await evidence(organizationId, group)).clockIn).toEqual({
			state: "seen",
			at: "2026-06-02T07:30:00Z",
			actor: { employeeId: ada.employeeId, displayName: "Ada", former: false },
		});
	});

	it("counts a member still clocked in from when they clocked in", async () => {
		const {
			organizationId,
			people: [ada, ben],
		} = await organizationWith("Ada", "Ben");
		await recordWork(organizationId, ada, "2026-06-02T07:30:00Z");
		await clockIn(organizationId, ben, "2026-06-01T06:45:00Z");

		expect((await evidence(organizationId)).clockIn).toEqual({
			state: "seen",
			at: "2026-06-01T06:45:00Z",
			actor: { employeeId: ben.employeeId, displayName: "Ben", former: false },
		});
	});

	it("shows the first decided request by a member, legacy or canonical, never a pending one", async () => {
		const {
			organizationId,
			people: [ada, ben, manager],
		} = await organizationWith("Ada", "Ben", "Manager");
		const former = await seedNamed(organizationId, "Former", false);
		const elsewhere = await organizationWith("Elsewhere", "Their manager");
		await legacyRequest(organizationId, ada, manager, {
			status: "pending",
			updatedAt: "2026-05-01T09:00:00Z",
		});
		await workflow(organizationId, ada, { status: "pending" });
		await workflow(organizationId, ada, {
			status: "cancelled",
			completedAt: "2026-05-02T09:00:00Z",
		});
		await legacyRequest(organizationId, former, manager, {
			status: "approved",
			approvedAt: "2026-05-03T09:00:00Z",
			updatedAt: "2026-05-03T09:00:00Z",
		});
		await legacyRequest(elsewhere.organizationId, elsewhere.people[0], elsewhere.people[1], {
			status: "approved",
			approvedAt: "2026-05-04T09:00:00Z",
			updatedAt: "2026-05-04T09:00:00Z",
		});
		await workflow(organizationId, ada, {
			status: "approved",
			completedAt: "2026-06-03T09:00:00Z",
		});
		// A rejection without approved_at is decided when it was last updated.
		await legacyRequest(organizationId, ben, manager, {
			status: "rejected",
			approvedAt: null,
			updatedAt: "2026-06-02T12:00:00Z",
		});

		expect((await evidence(organizationId)).decidedApproval).toEqual({
			state: "seen",
			at: "2026-06-02T12:00:00Z",
			actor: { employeeId: ben.employeeId, displayName: "Ben", former: false },
		});
	});

	it("takes a canonical decision when it came first", async () => {
		const {
			organizationId,
			people: [ada, manager],
		} = await organizationWith("Ada", "Manager");
		await workflow(organizationId, ada, {
			status: "rejected",
			completedAt: "2026-06-01T08:00:00Z",
		});
		await legacyRequest(organizationId, ada, manager, {
			status: "approved",
			approvedAt: "2026-06-04T08:00:00Z",
			updatedAt: "2026-06-04T08:00:00Z",
		});

		expect((await evidence(organizationId)).decidedApproval).toMatchObject({
			state: "seen",
			at: "2026-06-01T08:00:00Z",
			actor: { employeeId: ada.employeeId },
		});
	});

	it("shows the first successful payroll export and who ran it, marking a former employee", async () => {
		const {
			organizationId,
			people: [ada],
		} = await organizationWith("Ada");
		const former = await seedNamed(organizationId, "Former payroll", false);
		const elsewhere = await organizationWith("Elsewhere");
		await exportJob(organizationId, ada, { status: "failed", completedAt: "2026-05-01T09:00:00Z" });
		await exportJob(organizationId, ada, { status: "processing" });
		await exportJob(elsewhere.organizationId, elsewhere.people[0], {
			status: "completed",
			completedAt: "2026-05-02T09:00:00Z",
		});
		await exportJob(organizationId, former, {
			status: "completed",
			completedAt: "2026-06-05T16:00:00Z",
		});
		await exportJob(organizationId, ada, {
			status: "completed",
			completedAt: "2026-06-06T16:00:00Z",
		});

		expect((await evidence(organizationId)).payrollExport).toEqual({
			state: "seen",
			at: "2026-06-05T16:00:00Z",
			actor: { employeeId: former.employeeId, displayName: "Former payroll", former: true },
		});
	});

	it("is unavailable, never not yet, when a lookup fails", async () => {
		const {
			organizationId,
			people: [ada],
		} = await organizationWith("Ada");
		const group = await resolveGoLiveGroup(db, organizationId, AS_OF);
		await recordWork(organizationId, ada, "2026-06-02T07:30:00Z");
		const broken = new Proxy(db, {
			get(target, property, receiver) {
				if (property === "select") throw new Error("lookup failed");
				return Reflect.get(target, property, receiver);
			},
		});

		expect(await evidence(organizationId, group, broken)).toEqual({
			clockIn: { state: "unavailable" },
			decidedApproval: { state: "unavailable" },
			payrollExport: { state: "unavailable" },
		});
	});
});
