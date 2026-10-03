import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db } from "@/db";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { AutoClockOutCandidate } from "./types";

export interface AutoClockOutScanState {
	claim(now: Instant): Promise<{ token: string; after: AutoClockOutCandidate | null } | null>;
	advance(input: { token: string; after: AutoClockOutCandidate; now: Instant }): Promise<void>;
	release(input: {
		token: string;
		after: AutoClockOutCandidate | null;
		now: Instant;
	}): Promise<void>;
}

export class AutoClockOutScanLeaseNotOwnedError extends Error {
	constructor() {
		super("Automatic clock-out scan lease is no longer owned");
		this.name = "AutoClockOutScanLeaseNotOwnedError";
	}
}

/** Internal global discovery cursor; candidate commands still enforce organization scope. */
export function createAutoClockOutScanState(
	database: Pick<typeof db, "execute">,
): AutoClockOutScanState {
	return {
		async claim(now) {
			const token = randomUUID();
			const result = await database.execute<{
				cursor: AutoClockOutCandidate | null;
			}>(sql`
				INSERT INTO automatic_clock_out_scan_state (id, claim_token, lease_expires_at, updated_at)
				VALUES ('maintenance', ${token}::uuid, ${dateFromInstant(now.add({ minutes: 5 }))}, ${dateFromInstant(now)})
				ON CONFLICT (id) DO UPDATE SET claim_token = EXCLUDED.claim_token,
				lease_expires_at = EXCLUDED.lease_expires_at, updated_at = EXCLUDED.updated_at
				WHERE automatic_clock_out_scan_state.claim_token IS NULL
				OR automatic_clock_out_scan_state.lease_expires_at <= ${dateFromInstant(now)}
				RETURNING cursor`);
			return result.rows.length === 1 ? { token, after: result.rows[0].cursor } : null;
		},
		async advance({ token, after, now }) {
			const result = await database.execute(sql`
				UPDATE automatic_clock_out_scan_state SET cursor = ${JSON.stringify(after)}::jsonb,
				lease_expires_at = ${dateFromInstant(now.add({ minutes: 5 }))}, updated_at = ${dateFromInstant(now)}
				WHERE id = 'maintenance' AND claim_token = ${token}::uuid AND lease_expires_at > ${dateFromInstant(now)} RETURNING id`);
			if (result.rows.length !== 1) throw new AutoClockOutScanLeaseNotOwnedError();
		},
		async release({ token, after, now }) {
			const result = await database.execute(sql`
				UPDATE automatic_clock_out_scan_state SET cursor = ${after ? JSON.stringify(after) : null}::jsonb,
				claim_token = NULL, lease_expires_at = NULL, updated_at = ${dateFromInstant(now)}
				WHERE id = 'maintenance' AND claim_token = ${token}::uuid AND lease_expires_at > ${dateFromInstant(now)} RETURNING id`);
			if (result.rows.length !== 1) throw new AutoClockOutScanLeaseNotOwnedError();
		},
	};
}
