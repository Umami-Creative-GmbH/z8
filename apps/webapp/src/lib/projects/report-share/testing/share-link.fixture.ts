/**
 * The organization the report share link suites (#806) seed on PostgreSQL:
 * an owner, a project manager of Website and Support (customer Acme), an
 * employee-role manager without billable access, a worker without report
 * access, Portal (customer Globex), and a second organization with its own
 * owner. Each suite passes its own tag so suites can run side by side.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export function shareLinkFixture(tag: string, uuidPrefix: string) {
	const uuid = (suffix: string) => `${uuidPrefix}0000-0000-4000-8000-${suffix.padStart(12, "0")}`;
	const ids = {
		organization: `${tag}-org`,
		otherOrganization: `${tag}-other-org`,
		ownerUser: `${tag}-owner-user`,
		pmUser: `${tag}-pm-user`,
		teamManagerUser: `${tag}-team-manager-user`,
		workerUser: `${tag}-worker-user`,
		otherUser: `${tag}-other-user`,
		owner: uuid("1"),
		pm: uuid("2"),
		teamManager: uuid("3"),
		worker: uuid("4"),
		otherEmployee: uuid("5"),
		acme: uuid("c1"),
		globex: uuid("c2"),
		foreignCustomer: uuid("c3"),
		website: uuid("a1"),
		support: uuid("a2"),
		portal: uuid("a3"),
		foreignProject: uuid("a4"),
	} as const;
	const users = [ids.ownerUser, ids.pmUser, ids.teamManagerUser, ids.workerUser, ids.otherUser];

	async function cleanup(admin: Pool) {
		for (const organizationId of [ids.organization, ids.otherOrganization]) {
			await admin.query("delete from audit_log where organization_id = $1", [organizationId]);
			await admin.query("delete from report_share_link where organization_id = $1", [
				organizationId,
			]);
			await admin.query("delete from work_period where organization_id = $1", [organizationId]);
			await admin.query("delete from time_entry where organization_id = $1", [organizationId]);
		}
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	/** One completed, approved, billable work period. */
	async function work(
		admin: Pool,
		options: { employeeId: string; projectId: string; start: string; end: string; minutes: number },
	) {
		const clockInId = randomUUID();
		const clockOutId = randomUUID();
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", options.start],
			[clockOutId, "clock_out", options.end],
		]) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, 0, 'Etc/UTC', 'user_setting', $7, $6)`,
				[entryId, options.employeeId, ids.organization, type, timestamp, ids.ownerUser, `hash-${entryId}`],
			);
		}
		const id = randomUUID();
		await admin.query(
			`insert into work_period
			 (id, employee_id, organization_id, clock_in_id, clock_out_id, project_id, is_billable, start_time,
			  end_time, duration_minutes, is_active, approval_status, updated_at)
			 values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, false, 'approved', now())`,
			[
				id,
				options.employeeId,
				ids.organization,
				clockInId,
				clockOutId,
				options.projectId,
				options.start,
				options.end,
				options.minutes,
			],
		);
		return id;
	}

	async function seed(admin: Pool) {
		await cleanup(admin);
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, billable_time_enabled, created_at)
			 values ($1, 'T806 GmbH', $1, 'UTC', true, true, now()), ($2, 'T806 other', $2, 'UTC', true, true, now())`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR'), ($2, 'EUR')`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ($8 || '-m-owner', $1, $2, 'owner', 'approved', now()),
			 ($8 || '-m-pm', $1, $3, 'member', 'approved', now()),
			 ($8 || '-m-tm', $1, $4, 'member', 'approved', now()),
			 ($8 || '-m-worker', $1, $5, 'member', 'approved', now()),
			 ($8 || '-m-other', $6, $7, 'owner', 'approved', now())`,
			[
				ids.organization,
				ids.ownerUser,
				ids.pmUser,
				ids.teamManagerUser,
				ids.workerUser,
				ids.otherOrganization,
				ids.otherUser,
				tag,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'admin', now()),
			 ($3, $4, $11, 'employee', now()),
			 ($5, $6, $11, 'manager', now()),
			 ($7, $8, $11, 'employee', now()),
			 ($9, $10, $12, 'admin', now())`,
			[
				ids.owner,
				ids.ownerUser,
				ids.pm,
				ids.pmUser,
				ids.teamManager,
				ids.teamManagerUser,
				ids.worker,
				ids.workerUser,
				ids.otherEmployee,
				ids.otherUser,
				ids.organization,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at) values
			 ($1, $2, 'Acme', $3, now()), ($4, $2, 'Globex', $3, now()), ($5, $6, 'Foreign customer', $7, now())`,
			[
				ids.acme,
				ids.organization,
				ids.ownerUser,
				ids.globex,
				ids.foreignCustomer,
				ids.otherOrganization,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, customer_id, billable_default, created_by, updated_at) values
			 ($1, $5, 'Website', 'active', $6, true, $7, now()),
			 ($2, $5, 'Support', 'active', $6, true, $7, now()),
			 ($3, $5, 'Portal', 'active', $8, true, $7, now()),
			 ($4, $9, 'Foreign project', 'active', $10, true, $11, now())`,
			[
				ids.website,
				ids.support,
				ids.portal,
				ids.foreignProject,
				ids.organization,
				ids.acme,
				ids.ownerUser,
				ids.globex,
				ids.otherOrganization,
				ids.foreignCustomer,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $3, $4), ($2, $3, $4)`,
			[ids.website, ids.support, ids.pm, ids.ownerUser],
		);
		await work(admin, {
			employeeId: ids.worker,
			projectId: ids.website,
			start: "2026-03-02T08:00:00Z",
			end: "2026-03-02T16:00:00Z",
			minutes: 480,
		});
		await work(admin, {
			employeeId: ids.worker,
			projectId: ids.support,
			start: "2026-03-03T08:00:00Z",
			end: "2026-03-03T10:00:00Z",
			minutes: 120,
		});
		await work(admin, {
			employeeId: ids.worker,
			projectId: ids.portal,
			start: "2026-03-04T08:00:00Z",
			end: "2026-03-04T12:00:00Z",
			minutes: 240,
		});
	}

	return { ids, users, seed, cleanup, work };
}
