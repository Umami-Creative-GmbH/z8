import { beforeEach, describe, expect, test, vi } from "vitest";
import { SecretStoreUnavailableError } from "@/lib/vault/errors";
import {
	buildCredentialRevisionPrefix,
	cleanupUnreferencedCredentialRevision,
	readInstallationCredentialRevision,
	storeInstallationCredentialRevision,
} from "./credential-revisions";

interface RevisionRow {
	id: string;
	installationId: string;
	organizationId: string;
	revisionNumber: number;
	secretStoreProvider: "vault" | "scaleway";
	secretKeyPrefix: string;
	secretKeys: string[];
	status:
		| "staged"
		| "verified"
		| "active"
		| "superseded"
		| "revoked"
		| "cleanup_pending"
		| "cleaned_up";
	externalIdentityFingerprint: string | null;
	verifiedAt: Date | null;
	revokedAt: Date | null;
	createdByUserId: string | null;
	createdAt: Date;
}

function createInMemoryRevisionHarness() {
	const secrets = new Map<string, string>();
	const revisions = new Map<string, RevisionRow>();
	const activeRevisionByInstallation = new Map<string, string | null>();
	let nextId = 1;

	const storeSecret = vi.fn(async (orgId: string, key: string, value: string) => {
		secrets.set(`${orgId}::${key}`, value);
	});
	const readSecret = vi.fn(async (orgId: string, key: string) => {
		return secrets.get(`${orgId}::${key}`) ?? null;
	});
	const deleteSecret = vi.fn(async (orgId: string, key: string) => {
		secrets.delete(`${orgId}::${key}`);
	});

	const store = {
		getLatestRevisionNumber: vi.fn(async (orgId: string, installationId: string) => {
			let max = 0;
			for (const rev of revisions.values()) {
				if (rev.organizationId === orgId && rev.installationId === installationId) {
					max = Math.max(max, rev.revisionNumber);
				}
			}
			return max;
		}),
		insertRevision: vi.fn(async (input: Omit<RevisionRow, "id" | "createdAt">) => {
			const row: RevisionRow = {
				...input,
				id: `rev-${nextId++}`,
				createdAt: new Date("2026-11-26T10:00:00.000Z"),
			};
			revisions.set(row.id, row);
			return row;
		}),
		findRevision: vi.fn(async (orgId: string, installationId: string, revisionId: string) => {
			const row = revisions.get(revisionId);
			if (!row || row.organizationId !== orgId || row.installationId !== installationId) {
				return null;
			}
			return row;
		}),
		getActiveRevisionId: vi.fn(async (_orgId: string, installationId: string) => {
			return activeRevisionByInstallation.get(installationId) ?? null;
		}),
		updateRevisionStatus: vi.fn(
			async (
				orgId: string,
				installationId: string,
				revisionId: string,
				status: RevisionRow["status"],
			) => {
				const row = revisions.get(revisionId);
				if (row && row.organizationId === orgId && row.installationId === installationId) {
					row.status = status;
				}
			},
		),
	};

	return {
		secrets,
		revisions,
		activeRevisionByInstallation,
		storeSecret,
		readSecret,
		deleteSecret,
		store,
	};
}

describe("immutable organization-scoped credential revisions", () => {
	let harness: ReturnType<typeof createInMemoryRevisionHarness>;

	beforeEach(() => {
		harness = createInMemoryRevisionHarness();
	});

	test("writes immutable revisioned keys without overwriting earlier revisions", async () => {
		const rev1 = await storeInstallationCredentialRevision(
			{
				organizationId: "org-1",
				installationId: "inst-1",
				provider: "slack",
				secrets: { bot_token: "xoxb-v1", signing_secret: "sig-v1" },
				status: "verified",
				externalIdentityFingerprint: "slack:T1:A1:B1:U1",
				createdByUserId: "user-1",
			},
			{
				storeSecret: harness.storeSecret,
				deleteSecret: harness.deleteSecret,
				secretStoreProvider: "vault",
				repository: harness.store,
			},
		);

		const rev2 = await storeInstallationCredentialRevision(
			{
				organizationId: "org-1",
				installationId: "inst-1",
				provider: "slack",
				secrets: { bot_token: "xoxb-v2", signing_secret: "sig-v2" },
				status: "verified",
				externalIdentityFingerprint: "slack:T1:A1:B1:U1",
				createdByUserId: "user-1",
			},
			{
				storeSecret: harness.storeSecret,
				deleteSecret: harness.deleteSecret,
				secretStoreProvider: "scaleway",
				repository: harness.store,
			},
		);

		expect(rev1.revisionNumber).toBe(1);
		expect(rev2.revisionNumber).toBe(2);
		expect(rev1.secretKeyPrefix).toBe(buildCredentialRevisionPrefix("slack", "inst-1", 1));
		expect(rev2.secretKeyPrefix).toBe(buildCredentialRevisionPrefix("slack", "inst-1", 2));
		expect(rev1.secretKeyPrefix).not.toBe(rev2.secretKeyPrefix);

		const readV1 = await readInstallationCredentialRevision(
			{ organizationId: "org-1", installationId: "inst-1", revisionId: rev1.id },
			{ readSecret: harness.readSecret, repository: harness.store },
		);
		const readV2 = await readInstallationCredentialRevision(
			{ organizationId: "org-1", installationId: "inst-1", revisionId: rev2.id },
			{ readSecret: harness.readSecret, repository: harness.store },
		);

		expect(readV1).toMatchObject({
			kind: "ok",
			secrets: { bot_token: "xoxb-v1", signing_secret: "sig-v1" },
		});
		expect(readV2).toMatchObject({
			kind: "ok",
			secrets: { bot_token: "xoxb-v2", signing_secret: "sig-v2" },
		});
	});

	test("compensates partial secret write failures and leaves existing revision and legacy secret untouched", async () => {
		harness.secrets.set("org-1::slack/bot_access_token", "xoxb-legacy-live");
		const rev1 = await storeInstallationCredentialRevision(
			{
				organizationId: "org-1",
				installationId: "inst-1",
				provider: "slack",
				secrets: { bot_token: "xoxb-v1", signing_secret: "sig-v1" },
			},
			{
				storeSecret: harness.storeSecret,
				deleteSecret: harness.deleteSecret,
				secretStoreProvider: "vault",
				repository: harness.store,
			},
		);

		harness.storeSecret.mockImplementationOnce(async (orgId, key, value) => {
			harness.secrets.set(`${orgId}::${key}`, value);
		});
		harness.storeSecret.mockRejectedValueOnce(
			new SecretStoreUnavailableError("Vault unavailable mid-write", {
				provider: "vault",
				operation: "write",
			}),
		);

		await expect(
			storeInstallationCredentialRevision(
				{
					organizationId: "org-1",
					installationId: "inst-1",
					provider: "slack",
					secrets: { bot_token: "xoxb-v2-partial", signing_secret: "sig-v2-fail" },
				},
				{
					storeSecret: harness.storeSecret,
					deleteSecret: harness.deleteSecret,
					secretStoreProvider: "vault",
					repository: harness.store,
				},
			),
		).rejects.toBeInstanceOf(SecretStoreUnavailableError);

		// Partial v2 key was cleaned up
		expect(
			harness.secrets.has(
				`org-1::${buildCredentialRevisionPrefix("slack", "inst-1", 2)}/bot_token`,
			),
		).toBe(false);
		// Existing v1 and legacy secret remain intact
		expect(harness.secrets.get("org-1::slack/bot_access_token")).toBe("xoxb-legacy-live");
		const readV1 = await readInstallationCredentialRevision(
			{ organizationId: "org-1", installationId: "inst-1", revisionId: rev1.id },
			{ readSecret: harness.readSecret, repository: harness.store },
		);
		expect(readV1).toMatchObject({
			kind: "ok",
			secrets: { bot_token: "xoxb-v1", signing_secret: "sig-v1" },
		});
	});

	test("distinguishes secret-store outage from confirmed missing revision or secret", async () => {
		const rev1 = await storeInstallationCredentialRevision(
			{
				organizationId: "org-1",
				installationId: "inst-1",
				provider: "slack",
				secrets: { bot_token: "xoxb-v1", signing_secret: "sig-v1" },
			},
			{
				storeSecret: harness.storeSecret,
				deleteSecret: harness.deleteSecret,
				secretStoreProvider: "scaleway",
				repository: harness.store,
			},
		);

		// Cross-org isolation: org-2 cannot read org-1's revision
		const crossOrg = await readInstallationCredentialRevision(
			{ organizationId: "org-2", installationId: "inst-1", revisionId: rev1.id },
			{ readSecret: harness.readSecret, repository: harness.store },
		);
		expect(crossOrg).toEqual({ kind: "missing", reason: "revision_not_found" });

		// Store outage returns unavailable (never missing)
		harness.readSecret.mockRejectedValueOnce(
			new SecretStoreUnavailableError("Scaleway KMS unreachable", {
				provider: "scaleway",
				operation: "read",
			}),
		);
		const outage = await readInstallationCredentialRevision(
			{ organizationId: "org-1", installationId: "inst-1", revisionId: rev1.id },
			{ readSecret: harness.readSecret, repository: harness.store },
		);
		expect(outage.kind).toBe("unavailable");

		// Confirmed missing key returns missing
		harness.secrets.delete(`${"org-1"}::${rev1.secretKeyPrefix}/signing_secret`);
		const missingKey = await readInstallationCredentialRevision(
			{ organizationId: "org-1", installationId: "inst-1", revisionId: rev1.id },
			{ readSecret: harness.readSecret, repository: harness.store },
		);
		expect(missingKey).toMatchObject({
			kind: "missing",
			reason: "secret_missing",
			missingKeys: ["signing_secret"],
		});
	});

	test("refuses to clean up referenced active revision and keeps unreferenced cleanup retryable on outage", async () => {
		const rev1 = await storeInstallationCredentialRevision(
			{
				organizationId: "org-1",
				installationId: "inst-1",
				provider: "slack",
				secrets: { bot_token: "xoxb-v1", signing_secret: "sig-v1" },
			},
			{
				storeSecret: harness.storeSecret,
				deleteSecret: harness.deleteSecret,
				secretStoreProvider: "vault",
				repository: harness.store,
			},
		);

		harness.activeRevisionByInstallation.set("inst-1", rev1.id);
		const refused = await cleanupUnreferencedCredentialRevision(
			{ organizationId: "org-1", installationId: "inst-1", revisionId: rev1.id },
			{ deleteSecret: harness.deleteSecret, repository: harness.store },
		);
		expect(refused).toEqual({ kind: "referenced" });

		// Unreference rev1, fail delete once -> cleanup_pending (retryable), then succeed -> cleaned_up
		harness.activeRevisionByInstallation.set("inst-1", null);
		harness.deleteSecret.mockRejectedValueOnce(
			new SecretStoreUnavailableError("Vault temporarily sealed", {
				provider: "vault",
				operation: "delete",
			}),
		);

		const failedCleanup = await cleanupUnreferencedCredentialRevision(
			{ organizationId: "org-1", installationId: "inst-1", revisionId: rev1.id },
			{ deleteSecret: harness.deleteSecret, repository: harness.store },
		);
		expect(failedCleanup.kind).toBe("retryable_error");
		expect(harness.revisions.get(rev1.id)?.status).toBe("cleanup_pending");

		const retriedCleanup = await cleanupUnreferencedCredentialRevision(
			{ organizationId: "org-1", installationId: "inst-1", revisionId: rev1.id },
			{ deleteSecret: harness.deleteSecret, repository: harness.store },
		);
		expect(retriedCleanup.kind).toBe("cleaned_up");
		expect(harness.revisions.get(rev1.id)?.status).toBe("cleaned_up");
	});
});
