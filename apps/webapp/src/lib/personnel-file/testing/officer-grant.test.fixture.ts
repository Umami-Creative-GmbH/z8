import { DOCUMENT_CATEGORIES, type DocumentCategory } from "../document.types";

/**
 * Test seeding for personnel file officer grants (#866), for PostgreSQL
 * suites of later slices. Writes the grant rows directly (no audit entry),
 * through any pg-style client such as `integrationAdminPool()` or a lifecycle
 * fixture's `pool`. To exercise the audited write path, call
 * `savePersonnelFileOfficerGrant` from `../officer-grant-store` instead.
 */

export interface SqlClient {
	query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface SeedPersonnelFileOfficerGrantInput {
	organizationId: string;
	/** The officer's employee id; they need an active employee and an approved membership to get access. */
	officerEmployeeId: string;
	/** A user id for `created_by` (any existing user). */
	createdBy: string;
	/** Defaults to every category. */
	categories?: readonly DocumentCategory[];
	/** Defaults to `specific` when teams or employees are named, otherwise `all`. */
	scope?: "all" | "specific";
	teamIds?: readonly string[];
	employeeIds?: readonly string[];
}

/** Inserts an active grant with its team and employee rows and returns its id. */
export async function seedPersonnelFileOfficerGrant(
	client: SqlClient,
	input: SeedPersonnelFileOfficerGrantInput,
): Promise<string> {
	const teamIds = input.teamIds ?? [];
	const employeeIds = input.employeeIds ?? [];
	const scope = input.scope ?? (teamIds.length + employeeIds.length > 0 ? "specific" : "all");
	const { rows } = await client.query(
		`insert into personnel_file_officer_grant
		 (organization_id, officer_employee_id, scope, categories, created_by, updated_by)
		 values ($1, $2, $3, $4::text[], $5, $5) returning id`,
		[
			input.organizationId,
			input.officerEmployeeId,
			scope,
			[...(input.categories ?? DOCUMENT_CATEGORIES)],
			input.createdBy,
		],
	);
	const grantId = (rows[0] as { id: string } | undefined)?.id;
	if (!grantId) throw new Error("Failed to seed the personnel file officer grant");
	for (const teamId of teamIds) {
		await client.query(
			`insert into personnel_file_officer_team (organization_id, grant_id, team_id, created_by)
			 values ($1, $2, $3, $4)`,
			[input.organizationId, grantId, teamId, input.createdBy],
		);
	}
	for (const employeeId of employeeIds) {
		await client.query(
			`insert into personnel_file_officer_employee (organization_id, grant_id, employee_id, created_by)
			 values ($1, $2, $3, $4)`,
			[input.organizationId, grantId, employeeId, input.createdBy],
		);
	}
	return grantId;
}

/** Sets a seeded grant inactive (no audit entry), freeing the officer for a new grant. */
export async function deactivateSeededPersonnelFileOfficerGrant(
	client: SqlClient,
	grantId: string,
): Promise<void> {
	await client.query("update personnel_file_officer_grant set is_active = false where id = $1", [
		grantId,
	]);
}
