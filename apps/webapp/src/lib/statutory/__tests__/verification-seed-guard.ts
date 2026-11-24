/**
 * The statutory verification seed's database guard (#2018). A host name check alone passes a
 * port-forward or SSH tunnel to production on `localhost`, so the seed also looks at what the
 * database holds: any organization besides its own means the database may not be disposable, and
 * the seed refuses to write (or remove) anything unless the caller explicitly overrides it.
 */
import type { Pool } from "pg";
import { STATUTORY_VERIFICATION_ORGANIZATION_ID } from "./verification-seed";

export const ALLOW_POPULATED_DATABASE_FLAG = "--allow-populated-database";

export type VerificationSeedTargetVerdict =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: string };

/** Decides whether the seed may touch a database holding `foreignOrganizations` other organizations. */
export function judgeVerificationSeedTarget(input: {
	readonly foreignOrganizations: number;
	readonly allowPopulated: boolean;
}): VerificationSeedTargetVerdict {
	if (input.foreignOrganizations === 0 || input.allowPopulated) return { ok: true };
	const organizations =
		input.foreignOrganizations === 1
			? "1 organization"
			: `${input.foreignOrganizations} organizations`;
	return {
		ok: false,
		reason:
			`Refusing to touch this database: it holds ${organizations} besides '${STATUTORY_VERIFICATION_ORGANIZATION_ID}', so it may not be disposable. ` +
			`If it is a disposable copy, pass ${ALLOW_POPULATED_DATABASE_FLAG}.`,
	};
}

/** Reads the database and judges it; run it before the seed writes or removes anything. */
export async function checkVerificationSeedTarget(
	pool: Pick<Pool, "query">,
	options: { readonly allowPopulated: boolean },
): Promise<VerificationSeedTargetVerdict> {
	const {
		rows: [row],
	} = await pool.query<{ count: number }>(
		`SELECT count(*)::int AS count FROM organization WHERE id <> $1`,
		[STATUTORY_VERIFICATION_ORGANIZATION_ID],
	);
	return judgeVerificationSeedTarget({
		foreignOrganizations: row?.count ?? 0,
		allowPopulated: options.allowPopulated,
	});
}
