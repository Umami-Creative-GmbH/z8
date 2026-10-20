import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/**
 * A real current person-wide suspension of an intended driver (an employee-level Required
 * assignment), without inventing an original licence check.
 */
export async function seedSuspendedIntendedDriver(
	pool: Pool,
	input: {
		organizationId: string;
		employeeId: string;
		userId: string;
		at: Date;
		employmentPeriodId?: string;
	},
) {
	await pool.query(
		`insert into driving_licence_intended_driver_assignment (organization_id,assignment_type,employee_id,priority,required,created_at,created_by,updated_at,updated_by) values ($1,'employee',$2,2,true,$3,$4,$3,$4)`,
		[input.organizationId, input.employeeId, input.at, input.userId],
	);
	await pool.query(
		`insert into driving_impediment_report (organization_id,employee_id,employment_period_id,command_id,reported_at,reporter_user_id) values ($1,$2,$3,$4,$5,$6)`,
		[
			input.organizationId,
			input.employeeId,
			input.employmentPeriodId ?? null,
			randomUUID(),
			input.at,
			input.userId,
		],
	);
}
