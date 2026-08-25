import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const migration = readFileSync(
	new URL(
		"../../../drizzle/0054_employee_invitation_draft_identity.sql",
		import.meta.url,
	),
	"utf8",
);

const employeeGuard = migration.slice(
	migration.indexOf(
		'CREATE OR REPLACE FUNCTION "guard_accessible_owner_employee_deactivation"()',
	),
	migration.indexOf(
		'DROP TRIGGER IF EXISTS "guard_accessible_owner_employee_deactivation_trigger"',
	),
);
const memberGuard = migration.slice(
	migration.indexOf(
		'CREATE OR REPLACE FUNCTION "guard_accessible_owner_membership_change"()',
	),
	migration.indexOf(
		'DROP TRIGGER IF EXISTS "guard_accessible_owner_membership_change_trigger"',
	),
);
const identityGuard = migration.slice(
	migration.indexOf(
		'CREATE OR REPLACE FUNCTION "employee_identity_advisory_lock"()',
	),
	migration.indexOf(
		'DROP TRIGGER IF EXISTS "employee_identity_advisory_lock_trigger"',
	),
);
const memberIdentityGuard = migration.slice(
	migration.indexOf(
		'CREATE OR REPLACE FUNCTION "member_identity_advisory_lock"()',
	),
	migration.indexOf(
		'DROP TRIGGER IF EXISTS "a_member_identity_advisory_lock_trigger"',
	),
);
const sessionIdentityGuard = migration.slice(
	migration.indexOf(
		'CREATE OR REPLACE FUNCTION "session_identity_advisory_lock"()',
	),
	migration.indexOf(
		'DROP TRIGGER IF EXISTS "session_identity_advisory_lock_trigger"',
	),
);

const fixedViolationMessage =
	"Organization must retain an approved accessible owner";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

class OrganizationRowLockModel {
	private readonly tails = new Map<string, Promise<void>>();

	async run(organizationId: string, operation: () => Promise<void>) {
		const previous = this.tails.get(organizationId) ?? Promise.resolve();
		const release = deferred();
		this.tails.set(
			organizationId,
			previous.then(() => release.promise),
		);
		await previous;
		try {
			return await operation();
		} finally {
			release.resolve();
		}
	}
}

class IdentityLockModel extends OrganizationRowLockModel {}

describe("employee owner lifecycle migration guards", () => {
	it("locks the organization row before checking an active owner employee deactivation", () => {
		expect(employeeGuard).toContain(
			"OLD.is_active IS TRUE AND NEW.is_active IS FALSE",
		);
		expect(employeeGuard).toContain(
			'PERFORM 1\n\t\tFROM public."organization"\n\t\tWHERE "id" = OLD.organization_id\n\t\tFOR UPDATE',
		);
		expect(employeeGuard.indexOf('FROM public."organization"')).toBeLessThan(
			employeeGuard.indexOf('FROM public."member" AS "target_owner"'),
		);
	});

	it("guards member deletion and only relevant owner-removing updates", () => {
		expect(memberGuard).toContain("TG_OP = 'DELETE'");
		expect(memberGuard).toContain(
			"NEW.organization_id IS DISTINCT FROM OLD.organization_id",
		);
		expect(memberGuard).toContain("NEW.user_id IS DISTINCT FROM OLD.user_id");
		expect(memberGuard).toContain("NEW.status IS DISTINCT FROM 'approved'");
		expect(memberGuard).toContain("NOT (");
		expect(migration).toContain(
			'BEFORE DELETE OR UPDATE OF "role", "status", "organization_id", "user_id" ON "member"',
		);
		expect(migration).not.toContain('BEFORE UPDATE ON "member"');
	});

	it("allows parent-deletion cascades without a forgeable session bypass", () => {
		expect(migration).not.toContain("app.organization_cleanup");
		expect(migration).not.toContain("current_setting(");
		expect(memberGuard).toContain('FROM public."organization"');
		expect(memberGuard).toContain('WHERE "id" = OLD.organization_id');
		expect(memberGuard).toContain("IF NOT FOUND THEN");
		expect(memberGuard.indexOf("IF NOT FOUND THEN")).toBeLessThan(
			memberGuard.indexOf("IF NOT EXISTS ("),
		);
		expect(memberGuard).toContain("IF removes_old_owner THEN");
	});

	it("checks employee identity uniqueness after acquiring the advisory lock", () => {
		const lockPosition = identityGuard.indexOf("pg_advisory_xact_lock");
		const duplicateCheckPosition = identityGuard.indexOf(
			'FROM public."employee" AS "existing_employee"',
		);

		expect(lockPosition).toBeGreaterThanOrEqual(0);
		expect(duplicateCheckPosition).toBeGreaterThan(lockPosition);
		expect(identityGuard).toContain(
			'"existing_employee"."organization_id" = NEW.organization_id',
		);
		expect(identityGuard).toContain(
			'"existing_employee"."user_id" = NEW.user_id',
		);
		expect(identityGuard).toContain("TG_OP = 'INSERT'");
		expect(identityGuard).toContain('"existing_employee"."id" <> OLD.id');
		expect(identityGuard).toContain("ERRCODE = '23505'");
		expect(identityGuard).toContain(
			"MESSAGE = 'Employee identity already exists in organization'",
		);
	});

	it("locks member insert, delete, identity, and status updates using normalized user email", () => {
		expect(memberIdentityGuard).toContain('FROM public."user" AS "user"');
		expect(memberIdentityGuard).toContain('lower(btrim("user"."email"))');
		expect(memberIdentityGuard).toContain("OLD.user_id");
		expect(memberIdentityGuard).toContain("NEW.user_id");
		expect(memberIdentityGuard).toContain("OLD.organization_id");
		expect(memberIdentityGuard).toContain("NEW.organization_id");
		expect(memberIdentityGuard).toContain("LEAST(old_lock_key, new_lock_key)");
		expect(memberIdentityGuard).toContain(
			"GREATEST(old_lock_key, new_lock_key)",
		);
		expect(migration).toContain(
			'BEFORE INSERT OR DELETE OR UPDATE OF "user_id", "organization_id", "status" ON "member"',
		);
	});

	it("requires approved membership after taking the session identity lock", () => {
		const lockPosition = sessionIdentityGuard.indexOf("pg_advisory_xact_lock");
		const membershipPosition = sessionIdentityGuard.indexOf(
			'FROM public."member" AS "approved_member"',
		);

		expect(lockPosition).toBeGreaterThanOrEqual(0);
		expect(membershipPosition).toBeGreaterThan(lockPosition);
		expect(sessionIdentityGuard).toContain(
			'"approved_member"."status" = \'approved\'',
		);
		expect(sessionIdentityGuard).not.toContain('FROM public."employee"');
		expect(sessionIdentityGuard).not.toContain("bootstrap_member");
		expect(sessionIdentityGuard).toContain(
			"MESSAGE = 'Active organization access is not available'",
		);
	});

	it("acquires member identity locks before the owner organization-row guard", () => {
		const identityTriggerPosition = migration.indexOf(
			'CREATE TRIGGER "a_member_identity_advisory_lock_trigger"',
		);
		const ownerTriggerPosition = migration.indexOf(
			'CREATE TRIGGER "guard_accessible_owner_membership_change_trigger"',
		);

		expect(identityTriggerPosition).toBeGreaterThanOrEqual(0);
		expect(ownerTriggerPosition).toBeGreaterThan(identityTriggerPosition);
		expect(
			"a_member_identity_advisory_lock_trigger" <
				"guard_accessible_owner_membership_change_trigger",
		).toBe(true);
	});

	it("locks active-organization session inserts and both identities on relevant updates", () => {
		expect(sessionIdentityGuard).toContain('FROM public."user" AS "user"');
		expect(sessionIdentityGuard).toContain(
			"OLD.active_organization_id IS NOT NULL",
		);
		expect(sessionIdentityGuard).toContain(
			"NEW.active_organization_id IS NOT NULL",
		);
		expect(sessionIdentityGuard).toContain("LEAST(old_lock_key, new_lock_key)");
		expect(sessionIdentityGuard).toContain(
			"GREATEST(old_lock_key, new_lock_key)",
		);
		expect(migration).toContain(
			'BEFORE INSERT OR UPDATE OF "user_id", "active_organization_id" ON "session"',
		);
	});

	it("models replacement membership and active-session writes waiting for cleanup", async () => {
		const lock = new IdentityLockModel();
		const cleanupMayCommit = deferred();
		const events: string[] = [];
		const cleanup = lock.run("org-1:person@example.com", async () => {
			events.push("cleanup-lock");
			await cleanupMayCommit.promise;
			events.push("cleanup-commit");
		});
		const replacement = lock.run("org-1:person@example.com", async () => {
			events.push("replacement-member");
		});
		const activeSession = lock.run("org-1:person@example.com", async () => {
			events.push("active-session");
		});

		await vi.waitFor(() => expect(events).toEqual(["cleanup-lock"]));
		cleanupMayCommit.resolve();
		await Promise.all([cleanup, replacement, activeSession]);

		expect(events).toEqual([
			"cleanup-lock",
			"cleanup-commit",
			"replacement-member",
			"active-session",
		]);
	});

	it("models cleanup and SCIM status reactivation restoring prior SCIM-owned values", async () => {
		const runRace = async (first: "cleanup" | "scim") => {
			const lock = new IdentityLockModel();
			const firstMayCommit = deferred();
			const state = {
				memberStatus: "suspended",
				employeeActive: false,
				priorScimMemberStatus: "pending",
				priorScimEmployeeActive: false,
			};
			const events: string[] = [];
			const cleanup = () =>
				lock.run("org-1:person@example.com", async () => {
					events.push("cleanup-lock");
					if (first === "cleanup") await firstMayCommit.promise;
					if (state.memberStatus !== "approved") state.employeeActive = false;
					events.push("cleanup-commit");
				});
			const scim = () =>
				lock.run("org-1:person@example.com", async () => {
					events.push("scim-lock");
					if (first === "scim") await firstMayCommit.promise;
					state.memberStatus = state.priorScimMemberStatus;
					state.employeeActive = state.priorScimEmployeeActive;
					events.push("scim-commit");
				});
			const firstRun = first === "cleanup" ? cleanup() : scim();
			const secondRun = first === "cleanup" ? scim() : cleanup();
			await vi.waitFor(() => expect(events).toHaveLength(1));
			firstMayCommit.resolve();
			await Promise.all([firstRun, secondRun]);
			return { events, state };
		};

		const cleanupFirst = await runRace("cleanup");
		expect(cleanupFirst.events).toEqual([
			"cleanup-lock",
			"cleanup-commit",
			"scim-lock",
			"scim-commit",
		]);
		expect(cleanupFirst.state).toEqual({
			memberStatus: "pending",
			employeeActive: false,
			priorScimMemberStatus: "pending",
			priorScimEmployeeActive: false,
		});

		const scimFirst = await runRace("scim");
		expect(scimFirst.events).toEqual([
			"scim-lock",
			"scim-commit",
			"cleanup-lock",
			"cleanup-commit",
		]);
		expect(scimFirst.state).toEqual({
			memberStatus: "pending",
			employeeActive: false,
			priorScimMemberStatus: "pending",
			priorScimEmployeeActive: false,
		});
	});

	it("fails safely on historical duplicate identities before creating the unique index", () => {
		const preflightPosition = migration.indexOf(
			"Employee identity uniqueness preflight failed",
		);
		const indexPosition = migration.indexOf(
			'CREATE UNIQUE INDEX IF NOT EXISTS "employee_organizationId_userId_unique_idx"',
		);
		const preflight = migration.slice(
			migration.lastIndexOf("DO $$", preflightPosition),
			indexPosition,
		);

		expect(preflightPosition).toBeGreaterThanOrEqual(0);
		expect(indexPosition).toBeGreaterThan(preflightPosition);
		expect(preflight).toContain('GROUP BY "organization_id", "user_id"');
		expect(preflight).toContain("HAVING count(*) > 1");
		expect(preflight).toContain("duplicate_identity_count");
		expect(preflight).toContain(
			"Resolve duplicate employee identities manually",
		);
		expect(preflight).toContain("No employee rows were changed");
		expect(preflight).not.toMatch(/array_agg|json_agg|user_id\s*\|\|/i);
		expect(preflight).not.toMatch(/DELETE FROM\s+(public\.)?"employee"/i);
		expect(preflight).not.toMatch(/UPDATE\s+(public\.)?"employee"/i);
		expect(migration).toContain(
			'ON "employee" USING btree ("organization_id", "user_id")',
		);
	});

	it("models serialized employee identity inserts as one success and one conflict", async () => {
		const lock = new OrganizationRowLockModel();
		const identities = new Set<string>();
		const results = await Promise.all(
			["first", "second"].map((attempt) =>
				lock.run("org-1:user-1", async () => {
					if (identities.has("org-1:user-1")) return `${attempt}:conflict`;
					identities.add("org-1:user-1");
					return `${attempt}:inserted`;
				}),
			),
		);

		expect(results).toEqual(["first:inserted", "second:conflict"]);
	});

	it("matches owner as a comma-separated role token without substring matching", () => {
		expect(employeeGuard).toContain(
			"'owner' = ANY(regexp_split_to_array(COALESCE(\"target_owner\".\"role\", ''), '\\s*,\\s*'))",
		);
		expect(memberGuard).toContain(
			"'owner' = ANY(regexp_split_to_array(COALESCE(OLD.role, ''), '\\s*,\\s*'))",
		);
		for (const guard of [employeeGuard, memberGuard]) {
			expect(guard).not.toMatch(/LIKE\s+'%owner%'/i);
			expect(guard).not.toMatch(/position\s*\(.*owner/i);
		}
	});

	it("requires approved ownership and an active-or-bootstrap alternative in the same organization", () => {
		for (const guard of [employeeGuard, memberGuard]) {
			expect(guard).toContain(
				'"alternative_owner"."organization_id" = OLD.organization_id',
			);
			expect(guard).toContain('"alternative_owner"."status" = \'approved\'');
			expect(guard).toContain(
				"'owner' = ANY(regexp_split_to_array(COALESCE(\"alternative_owner\".\"role\", ''), '\\s*,\\s*'))",
			);
			expect(guard).toContain("NOT EXISTS (");
			expect(guard).toContain('"owner_employee"."is_active" IS TRUE');
		}
		expect(employeeGuard).toContain('"target_owner"."status" = \'approved\'');
		expect(employeeGuard).toContain(
			'"alternative_owner"."user_id" <> OLD.user_id',
		);
		expect(memberGuard).toContain('"alternative_owner"."id" <> OLD.id');
	});

	it("raises a fixed check violation without row or user data", () => {
		for (const guard of [employeeGuard, memberGuard]) {
			expect(guard).toContain("ERRCODE = '23514'");
			expect(guard).toContain(`MESSAGE = '${fixedViolationMessage}'`);
			expect(guard).not.toMatch(/MESSAGE\s*=.*OLD\./);
		}
	});

	it("drops and recreates both triggers idempotently", () => {
		for (const name of [
			"a_member_identity_advisory_lock",
			"guard_accessible_owner_employee_deactivation",
			"guard_accessible_owner_membership_change",
			"session_identity_advisory_lock",
		]) {
			const functionName = name.startsWith("a_") ? name.slice(2) : name;
			expect(migration).toContain(
				`CREATE OR REPLACE FUNCTION "${functionName}"()`,
			);
			expect(migration).toContain(`DROP TRIGGER IF EXISTS "${name}_trigger"`);
			expect(migration).toContain(`CREATE TRIGGER "${name}_trigger"`);
			expect(migration).toContain(`EXECUTE FUNCTION "${functionName}"()`);
		}
	});

	it("uses the same old organization row lock for employee and member operations", () => {
		const lockStatement =
			'PERFORM 1\n\t\tFROM public."organization"\n\t\tWHERE "id" = OLD.organization_id\n\t\tFOR UPDATE';
		expect(employeeGuard).toContain(lockStatement);
		expect(memberGuard).toContain(lockStatement);
	});

	it("schema-qualifies invariant reads against search-path shadowing", () => {
		for (const guard of [employeeGuard, memberGuard]) {
			expect(guard).toContain('FROM public."organization"');
			expect(guard).toContain('FROM public."member" AS "alternative_owner"');
			expect(guard).toContain('FROM public."employee" AS "owner_employee"');
		}
		expect(employeeGuard).toContain('FROM public."member" AS "target_owner"');
	});

	it("models concurrent employee deactivation and member removal as serialized on one org row", async () => {
		const lock = new OrganizationRowLockModel();
		const firstMayFinish = deferred();
		const events: string[] = [];

		const employeeDeactivation = lock.run("org-1", async () => {
			events.push("employee-enter");
			await firstMayFinish.promise;
			events.push("employee-exit");
		});
		const memberRemoval = lock.run("org-1", async () => {
			events.push("member-enter");
		});

		await vi.waitFor(() => expect(events).toEqual(["employee-enter"]));
		firstMayFinish.resolve();
		await Promise.all([employeeDeactivation, memberRemoval]);

		expect(events).toEqual(["employee-enter", "employee-exit", "member-enter"]);
	});
});
