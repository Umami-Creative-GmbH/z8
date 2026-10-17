import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/** A real current person-wide suspension, without inventing an original licence check. */
export async function seedSuspendedDrivingParticipant(
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
		`insert into driving_licence_participant (organization_id,employee_id,enrolled_at,enrolled_by) values ($1,$2,$3,$4)`,
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
