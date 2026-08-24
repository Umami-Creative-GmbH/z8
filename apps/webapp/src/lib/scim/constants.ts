import type {
	SCIMManagedConnection,
	SCIMManagedConnectionEvent,
	SCIMManagedCredential,
	SCIMScope,
} from "@better-auth/scim";
import { Temporal } from "temporal-polyfill";

export const SCIM_SCOPES = [
	"scim.users.read",
	"scim.users.write",
	"scim.groups.read",
	"scim.groups.write",
] as const satisfies readonly SCIMScope[];

export function getSCIMCredentialExpiresAt(now = new Date()): Date {
	const expiresAt = Temporal.Instant.fromEpochMilliseconds(now.getTime()).add({
		hours: 365 * 24,
	});

	return new Date(expiresAt.epochMilliseconds);
}

export type SCIMManagedConnectionDTO = SCIMManagedConnection & {
	token?: never;
};
export type SCIMManagedCredentialDTO = SCIMManagedCredential & {
	token?: never;
};
export type SCIMManagedConnectionEventDTO = SCIMManagedConnectionEvent & {
	token?: never;
};

export interface SCIMCredentialIssue {
	connection: SCIMManagedConnectionDTO;
	credential: SCIMManagedCredentialDTO;
	token: string;
}
