/**
 * Seeding history the database no longer accepts (#1224): since migration 0234
 * every completed work period needs its canonical work record, checked `NOT
 * VALID`, so only rows written before the check may lack one. A suite that
 * needs such a half pair (the backfill, attach, diagnostics, reconciliation)
 * writes it through `asHistory`, which writes it as the time before the check
 * did: the check is dropped for the write and added back `NOT VALID`, exactly
 * as the migration added it, in one transaction.
 *
 * Integration suites run one file at a time, so the table lock this takes
 * blocks no other suite.
 */
import type { Pool, PoolClient } from "pg";

export const CANONICAL_RECORD_CHECK = "workPeriod_completed_has_canonical_record_chk";

export async function asHistory<T>(
	pool: Pool,
	write: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		const { rows } = await client.query<{ definition: string }>(
			`select pg_get_constraintdef(oid) as definition from pg_constraint
			 where conrelid = 'public.work_period'::regclass and conname = $1`,
			[CANONICAL_RECORD_CHECK],
		);
		const definition = rows[0]?.definition.replace(/\s+NOT VALID$/i, "");
		if (!definition) throw new Error(`${CANONICAL_RECORD_CHECK} is missing`);
		await client.query(`alter table work_period drop constraint "${CANONICAL_RECORD_CHECK}"`);
		const result = await write(client);
		await client.query(
			`alter table work_period add constraint "${CANONICAL_RECORD_CHECK}" ${definition} not valid`,
		);
		await client.query("commit");
		return result;
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Seeds completed work by hand with its canonical work record, as work records
 * would have written it: every completed, undeleted work period the write
 * inserts or changes without a canonical work record gets one of its own id,
 * copying its interval, minutes, approval state and full work attribution,
 * created by the user who recorded its clock-in. For suites whose raw-SQL
 * seeding predates the check; a suite about the canonical record writes it
 * itself.
 */
export function withCanonicalRecords<T>(
	pool: Pool,
	write: (client: PoolClient) => Promise<T>,
): Promise<T> {
	return asHistory(pool, async (client) => {
		const result = await write(client);
		await attachSeededWork(client);
		return result;
	});
}

/** The rows of this transaction: `xmin` is the transaction's own id. */
const SEEDED = `
	select * from work_period
	where xmin = pg_current_xact_id()::xid
		and not is_active and deleted_at is null and canonical_record_id is null
		and end_time is not null`;

async function attachSeededWork(client: PoolClient) {
	await client.query(`
		insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
			duration_minutes, approval_state, origin, created_by, updated_at)
		select s.id, s.organization_id, s.employee_id, 'work', s.start_time, s.end_time,
			s.duration_minutes, s.approval_status::text::time_record_approval_state, 'clock',
			e.created_by, s.updated_at
		from (${SEEDED}) s join time_entry e on e.id = s.clock_in_id`);
	await client.query(`
		insert into time_record_work (record_id, organization_id, record_kind, work_category_id,
			work_location_type, vehicle_kind, vehicle_id, odometer_start_km, odometer_end_km,
			driven_distance_km)
		select s.id, s.organization_id, 'work', s.work_category_id, s.work_location_type,
			s.vehicle_kind, s.vehicle_id, s.odometer_start_km, s.odometer_end_km, s.driven_distance_km
		from (${SEEDED}) s`);
	await client.query(`
		insert into time_record_allocation (organization_id, record_id, allocation_kind, project_id,
			task_id, weight_percent, is_billable)
		select s.organization_id, s.id, 'project', s.project_id, s.task_id, 100, s.is_billable
		from (${SEEDED}) s where s.project_id is not null`);
	await client.query(`update work_period set canonical_record_id = id
		where id in (select id from (${SEEDED}) s)`);
}
