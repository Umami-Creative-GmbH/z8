/**
 * #1668 (spec #1664): a provider-bound SSO sign-in used to create an approved
 * member and an employee that was never switched on. Migration 0313 turns each
 * such membership into a pending one and removes the employee, so the person
 * goes through the pending-member approval like a new SSO sign-in. Anyone who
 * was ever on the roster, or whose employee row other records still point to,
 * stays as they are. Runs the migration file against the integration database.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const migration = readFileSync(
	join(process.cwd(), "drizzle/0313_sso_unapproved_employee_to_pending_membership.sql"),
	"utf8",
);

describe("0313 SSO employees never switched on become pending memberships", () => {
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let providerId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = await fixture.createOrganization();
		providerId = `t1668-idp-${randomUUID()}`;
		await fixture.pool.query(
			`insert into sso_provider (id, issuer, user_id, provider_id, organization_id, domain, domain_verified)
			 values ($1, 'https://idp.t1668.example.test', $2, $3, $4, 't1668-migration.example.test', true)`,
			[randomUUID(), fixture.ownerUserId, providerId, organizationId],
		);
	}, 120_000);
	afterAll(async () => fixture?.close());

	async function migrate() {
		for (const statement of migration.split("--> statement-breakpoint")) {
			await fixture.pool.query(statement);
		}
	}

	async function signedInThroughProvider(userId: string, provider = providerId) {
		await fixture.pool.query(
			`insert into account (id, account_id, provider_id, user_id, created_at, updated_at)
			 values ($1, $2, $3, $4, now(), now())`,
			[randomUUID(), `idp-subject-${userId}`, provider, userId],
		);
	}

	/** What an SSO sign-in with approval required used to leave: approved member, inactive employee, no period. */
	async function neverSwitchedOn() {
		const person = await fixture.seedEmployee({
			organizationId,
			isActive: false,
			withPeriod: false,
		});
		await signedInThroughProvider(person.userId);
		return person;
	}

	async function state(person: { memberId: string; employeeId: string }) {
		const { rows: members } = await fixture.pool.query<{ status: string }>(
			"select status from member where id = $1",
			[person.memberId],
		);
		const { rows: employees } = await fixture.pool.query<{ is_active: boolean }>(
			"select is_active from employee where id = $1",
			[person.employeeId],
		);
		return { member: members[0]?.status ?? null, employee: employees[0]?.is_active ?? null };
	}

	it("turns the membership pending and removes the employee that was never switched on", async () => {
		const person = await neverSwitchedOn();

		await migrate();

		expect(await state(person)).toEqual({ member: "pending", employee: null });
	});

	it("does the same when the deactivation backfill already recorded them", async () => {
		const person = await neverSwitchedOn();
		await fixture.pool.query(
			`insert into employee_deactivation
			 (organization_id, employee_id, deactivated_at, created_by, reason, request_id, request_fingerprint)
			 values ($1, $2, now(), $3, 'employee_deactivation_backfill', $4, 'backfill')`,
			[organizationId, person.employeeId, fixture.ownerUserId, randomUUID()],
		);

		await migrate();

		expect(await state(person)).toEqual({ member: "pending", employee: null });
	});

	it("leaves everyone who was ever on the roster, or did not come through the provider, as they are", async () => {
		// A former employee: they had an employment period.
		const former = await fixture.seedEmployee({ organizationId, isActive: false });
		await signedInThroughProvider(former.userId);
		// Deactivated by an admin, not by the backfill.
		const deactivated = await neverSwitchedOn();
		await fixture.pool.query(
			`insert into employee_deactivation
			 (organization_id, employee_id, deactivated_at, created_by, reason, request_id, request_fingerprint)
			 values ($1, $2, now(), $3, 'employee_deactivated', $4, 'admin')`,
			[organizationId, deactivated.employeeId, fixture.ownerUserId, randomUUID()],
		);
		// Inactive, but never signed in through this organization's provider.
		const otherProvider = await fixture.seedEmployee({
			organizationId,
			isActive: false,
			withPeriod: false,
		});
		await signedInThroughProvider(otherProvider.userId, `t1668-other-${randomUUID()}`);
		// Came in through the verified domain and is active today.
		const active = await fixture.seedEmployee({ organizationId, withPeriod: false });
		await signedInThroughProvider(active.userId);
		// An owner keeps their membership whatever happened.
		const owner = await fixture.seedEmployee({
			organizationId,
			role: "owner",
			isActive: false,
			withPeriod: false,
		});
		await signedInThroughProvider(owner.userId);

		await migrate();

		expect(await state(former)).toEqual({ member: "approved", employee: false });
		expect(await state(deactivated)).toEqual({ member: "approved", employee: false });
		expect(await state(otherProvider)).toEqual({ member: "approved", employee: false });
		expect(await state(active)).toEqual({ member: "approved", employee: true });
		expect(await state(owner)).toEqual({ member: "approved", employee: false });
	});

	it("skips an employee that other records still point to, and is idempotent", async () => {
		const referenced = await neverSwitchedOn();
		await fixture.pool.query(
			`insert into audit_log (organization_id, entity_type, entity_id, action, performed_by, employee_id)
			 values ($1, 'employee', $2, 'update', $3, $4)`,
			[organizationId, referenced.employeeId, fixture.ownerUserId, referenced.employeeId],
		);
		const convertible = await neverSwitchedOn();

		await migrate();
		await migrate();

		expect(await state(referenced)).toEqual({ member: "approved", employee: false });
		expect(await state(convertible)).toEqual({ member: "pending", employee: null });
	});
});
