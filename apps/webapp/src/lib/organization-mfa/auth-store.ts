import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { organizationMfaPolicy } from "@/db/schema";
import type { MfaAuthStore } from "./authentication-plugin";
import {
	factorFingerprint,
	getMfaRevision,
	readLocalMfaProof,
	readPrimaryAuthentication,
	recordMfaRecovery,
	recordPrimaryAuthentication,
	saveLocalMfaProof,
} from "./store";

export const mfaAuthStore: MfaAuthStore = {
	revision: getMfaRevision,
	fingerprint: factorFingerprint,
	saveProof: saveLocalMfaProof,
	readProof: readLocalMfaProof,
	readPrimary: readPrimaryAuthentication,
	savePrimary: recordPrimaryAuthentication,
	recordRecovery: recordMfaRecovery,
	async affected(userId) {
		const [row] = await db
			.select({ organizationId: member.organizationId })
			.from(member)
			.innerJoin(
				organizationMfaPolicy,
				and(
					eq(organizationMfaPolicy.organizationId, member.organizationId),
					eq(organizationMfaPolicy.enabled, true),
				),
			)
			.where(eq(member.userId, userId))
			.limit(1);
		return !!row;
	},
};
