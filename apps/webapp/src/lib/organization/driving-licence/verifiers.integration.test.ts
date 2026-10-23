import { Temporal } from "temporal-polyfill";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1312-admin",
	organizationId: "t1312-org",
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: session.userId, role: "user" },
				session: {
					id: `session-${session.userId}`,
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));

const actions = await import("./verifier-actions");
const pool = integrationAdminPool();
const ORG = "t1312-org";
const ids = {
	admin: "e1312000-0000-4000-8000-000000000001",
	verifier: "e1312000-0000-4000-8000-000000000002",
	anna: "e1312000-0000-4000-8000-000000000003",
	ben: "e1312000-0000-4000-8000-000000000004",
	team: "e1312000-0000-4000-8000-000000000005",
	foreign: "e1312000-0000-4000-8000-000000000006",
};
async function cleanup() {
	await pool.query("delete from organization where id like 't1312-%'");
	await pool.query('delete from "user" where id like $1', ["t1312-%"]);
}
async function seed() {
	await cleanup();
	for (const organizationId of [ORG, "t1312-foreign"]) {
		await pool.query(
			"insert into organization(id,name,slug,timezone,created_at) values($1,$1,$1,'Europe/Berlin',now())",
			[organizationId],
		);
	}
	await pool.query(
		"insert into team(id,organization_id,name,updated_at) values($1,$2,'Berlin',now())",
		[ids.team, ORG],
	);
	for (const name of ["admin", "verifier", "anna", "ben", "foreign"] as const) {
		const org = name === "foreign" ? "t1312-foreign" : ORG;
		const userId = `t1312-${name}`;
		await pool.query(
			'insert into "user"(id,name,email,created_at,updated_at) values($1,$2,$3,now(),now())',
			[userId, name, `${userId}@example.test`],
		);
		await pool.query(
			"insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,$4,'approved',now())",
			[`member-${userId}`, org, userId, name === "admin" ? "admin" : "member"],
		);
		await pool.query(
			"insert into employee(id,organization_id,user_id,team_id,is_active,updated_at) values($1,$2,$3,$4,true,now())",
			[ids[name], org, userId, name === "anna" ? ids.team : null],
		);
	}
	for (const name of ["admin", "verifier", "anna", "ben", "foreign"] as const) {
		await pool.query(
			"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,start_provenance) values($1,$2,$1,'open','2026-01-01T00:00:00Z','recorded')",
			[ids[name], name === "foreign" ? "t1312-foreign" : ORG],
		);
	}
	// Verifier grants change only while driving licence control is on (#1418).
	await pool.query(
		"insert into driving_licence_policy(organization_id,enabled,interval_months,timezone,reminder_lead_days,retention_months,retention_justification,updated_at,updated_by) values($1,true,24,'Europe/Berlin','[30,7]',36,'Necessary evidence for organization driving checks',now(),'t1312-admin')",
		[ORG],
	);
	session.userId = "t1312-admin";
	session.organizationId = ORG;
}
function signIn(name: string) {
	session.userId = `t1312-${name}`;
}

describe("driving licence verifier grants through public actions", () => {
	beforeAll(seed);
	beforeEach(seed);
	afterAll(cleanup);
	it("grants organization responsibility without granting administrators inspection access", async () => {
		const grant = await actions.saveDrivingLicenceVerifierGrantAction({
			verifierEmployeeId: ids.verifier,
			scope: "all",
			teamIds: [],
			employeeIds: [],
		});
		expect(grant.success).toBe(true);
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: false, canVerify: false } });
		signIn("verifier");
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: true } });
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.verifier,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: false } });
		const own = await actions.getDrivingLicenceVerifierResponsibilityAction();
		expect(own.success && own.data?.scope).toBe("all");
	});
	it("shows named responsibility and follows changed team membership without copied employee access", async () => {
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.verifier,
					scope: "specific",
					teamIds: [ids.team],
					employeeIds: [ids.ben],
				})
			).success,
		).toBe(true);
		signIn("verifier");
		const own = await actions.getDrivingLicenceVerifierResponsibilityAction();
		expect(own.success && own.data?.teams).toEqual([
			{ id: ids.team, name: "Berlin" },
		]);
		expect(own.success && own.data?.employees).toEqual([
			{ id: ids.ben, name: "ben" },
		]);
		expect(await actions.listDrivingLicenceVerifierEmployeesAction()).toEqual({
			success: true,
			data: [
				{ id: ids.anna, canVerify: true },
				{ id: ids.ben, canVerify: true },
			],
		});
		await pool.query("update employee set team_id = null where id = $1", [
			ids.anna,
		]);
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: false, canVerify: false } });
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.ben,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: true } });
	});
	it("revokes scope immediately and keeps grant and revocation attribution visible to administrators", async () => {
		const created = await actions.saveDrivingLicenceVerifierGrantAction({
			verifierEmployeeId: ids.verifier,
			scope: "all",
			teamIds: [],
			employeeIds: [],
		});
		if (!created.success) throw new Error(created.error);
		expect(
			await actions.revokeDrivingLicenceVerifierGrantAction({
				grantId: created.data.grantId,
			}),
		).toEqual({ success: true, data: created.data });
		const history = await actions.getDrivingLicenceVerifierAdminDataAction();
		expect(history.success && history.data.grants).toEqual([
			expect.objectContaining({
				id: created.data.grantId,
				grantedBy: "t1312-admin",
				revokedBy: "t1312-admin",
				revokedAt: expect.any(String),
			}),
		]);
		signIn("verifier");
		expect(
			await actions.getDrivingLicenceVerifierResponsibilityAction(),
		).toEqual({ success: true, data: null });
		expect(await actions.listDrivingLicenceVerifierEmployeesAction()).toEqual({
			success: true,
			data: [],
		});
		expect(
			(await actions.getDrivingLicenceVerifierAdminDataAction()).success,
		).toBe(false);
	});
	it("refuses foreign recipients, named employees, team selections, reads and grant revocation", async () => {
		const grant = {
			verifierEmployeeId: ids.verifier,
			scope: "specific" as const,
			teamIds: [],
			employeeIds: [ids.foreign],
		};
		expect(
			(await actions.saveDrivingLicenceVerifierGrantAction(grant)).success,
		).toBe(false);
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					...grant,
					verifierEmployeeId: ids.foreign,
					employeeIds: [ids.anna],
				})
			).success,
		).toBe(false);
		await pool.query(
			"insert into team(id,organization_id,name,updated_at) values($1,'t1312-foreign','Foreign team',now())",
			[ids.foreign],
		);
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					...grant,
					teamIds: [ids.foreign],
					employeeIds: [],
				})
			).success,
		).toBe(false);
		const created = await actions.saveDrivingLicenceVerifierGrantAction({
			...grant,
			scope: "all",
			employeeIds: [],
		});
		if (!created.success) throw new Error(created.error);
		signIn("verifier");
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.foreign,
			}),
		).toEqual({ success: true, data: { canRead: false, canVerify: false } });
		session.organizationId = "t1312-foreign";
		signIn("foreign");
		await pool.query(
			"update member set role='admin' where user_id='t1312-foreign'",
		);
		expect(
			(
				await actions.revokeDrivingLicenceVerifierGrantAction({
					grantId: created.data.grantId,
				})
			).success,
		).toBe(false);
		session.organizationId = ORG;
		signIn("verifier");
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: true } });
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					...grant,
					scope: "all",
					employeeIds: [],
				})
			).success,
		).toBe(false);
	});
	afterEach(() => vi.restoreAllMocks());
	it("expires responsibility at its exact UTC deadline and replaces it with an attributable fresh grant", async () => {
		const clock = vi
			.spyOn(Temporal.Now, "instant")
			.mockReturnValue(Temporal.Instant.from("2026-10-16T12:00:00Z"));
		const created = await actions.saveDrivingLicenceVerifierGrantAction({
			verifierEmployeeId: ids.verifier,
			scope: "all",
			teamIds: [],
			employeeIds: [],
			expiresAt: "2026-10-16T13:00:00Z",
		});
		expect(created.success).toBe(true);
		signIn("verifier");
		clock.mockReturnValue(Temporal.Instant.from("2026-10-16T12:59:59.999Z"));
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: true } });
		clock.mockReturnValue(Temporal.Instant.from("2026-10-16T13:00:00Z"));
		expect(
			await actions.getDrivingLicenceVerifierResponsibilityAction(),
		).toEqual({ success: true, data: null });
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: false, canVerify: false } });
		signIn("admin");
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.verifier,
					scope: "specific",
					teamIds: [],
					employeeIds: [ids.ben],
				})
			).success,
		).toBe(true);
		const history = await actions.getDrivingLicenceVerifierAdminDataAction();
		expect(history.success && history.data.grants).toHaveLength(2);
		signIn("verifier");
		expect(await actions.listDrivingLicenceVerifierEmployeesAction()).toEqual({
			success: true,
			data: [{ id: ids.ben, canVerify: true }],
		});
	});
	it("ends an until-dated grant after that whole day in the policy calendar timezone", async () => {
		await pool.query(
			"update driving_licence_policy set timezone='America/New_York' where organization_id=$1",
			[ORG],
		);
		const clock = vi
			.spyOn(Temporal.Now, "instant")
			.mockReturnValue(Temporal.Instant.from("2026-10-16T12:00:00Z"));
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.verifier,
					scope: "all",
					teamIds: [],
					employeeIds: [],
					until: "2026-10-20",
				})
			).success,
		).toBe(true);
		const admin = await actions.getDrivingLicenceVerifierAdminDataAction();
		expect(admin.success && admin.data.timezone).toBe("America/New_York");
		expect(admin.success && admin.data.grants).toEqual([
			expect.objectContaining({
				verifierEmployeeId: ids.verifier,
				until: "2026-10-20",
				expired: false,
				expiresAt: "2026-10-21T04:00:00.000Z",
			}),
		]);
		signIn("verifier");
		const own = await actions.getDrivingLicenceVerifierResponsibilityAction();
		expect(own.success && own.data).toMatchObject({
			until: "2026-10-20",
			timezone: "America/New_York",
		});
		clock.mockReturnValue(Temporal.Instant.from("2026-10-21T03:59:59.999Z"));
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: true } });
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.verifier,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: false } });
		clock.mockReturnValue(Temporal.Instant.from("2026-10-21T04:00:00Z"));
		expect(
			await actions.getDrivingLicenceVerifierResponsibilityAction(),
		).toEqual({ success: true, data: null });
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: false, canVerify: false } });
		expect(await actions.listDrivingLicenceVerifierEmployeesAction()).toEqual({
			success: true,
			data: [],
		});
		signIn("admin");
		const ended = await actions.getDrivingLicenceVerifierAdminDataAction();
		expect(ended.success && ended.data.grants).toEqual([
			expect.objectContaining({ until: "2026-10-20", expired: true }),
		]);
	});
	it("lets administrators set, change and clear an until date that is never in the past", async () => {
		vi.spyOn(Temporal.Now, "instant").mockReturnValue(
			// 00:30 on 17 October in the policy timezone (Europe/Berlin).
			Temporal.Instant.from("2026-10-16T22:30:00Z"),
		);
		const grant = {
			verifierEmployeeId: ids.verifier,
			scope: "all" as const,
			teamIds: [],
			employeeIds: [],
		};
		expect(
			await actions.saveDrivingLicenceVerifierGrantAction({
				...grant,
				until: "2026-10-16",
			}),
		).toEqual({ success: false, error: "until_in_past" });
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					...grant,
					until: "2026-10-17",
					expiresAt: "2026-10-18T00:00:00Z",
				})
			).success,
		).toBe(false);
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					...grant,
					until: "2026-10-17",
				})
			).success,
		).toBe(true);
		const current = async () => {
			const data = await actions.getDrivingLicenceVerifierAdminDataAction();
			if (!data.success) throw new Error(data.error);
			return data.data.grants.filter((g) => !g.revokedAt);
		};
		expect(await current()).toEqual([
			expect.objectContaining({
				until: "2026-10-17",
				expiresAt: "2026-10-17T22:00:00.000Z",
			}),
		]);
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					...grant,
					until: "2026-10-30",
				})
			).success,
		).toBe(true);
		expect(await current()).toEqual([
			expect.objectContaining({
				until: "2026-10-30",
				expiresAt: "2026-10-30T23:00:00.000Z",
			}),
		]);
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					...grant,
					until: null,
				})
			).success,
		).toBe(true);
		expect(await current()).toEqual([
			expect.objectContaining({ until: null, expiresAt: null, expired: false }),
		]);
		const all = await actions.getDrivingLicenceVerifierAdminDataAction();
		expect(all.success && all.data.grants).toHaveLength(3);
	});
	it("does not inherit verifier authority from management, payroll or personnel file grants", async () => {
		await pool.query("update employee set role='manager' where id=$1", [
			ids.verifier,
		]);
		await pool.query(
			"insert into payroll_access_grant(organization_id,payroll_employee_id,scope,created_by,updated_at) values($1,$2,'all','t1312-admin',now())",
			[ORG, ids.verifier],
		);
		await pool.query(
			"insert into personnel_file_officer_grant(organization_id,officer_employee_id,scope,categories,created_by) values($1,$2,'all',ARRAY['contract'],'t1312-admin')",
			[ORG, ids.verifier],
		);
		signIn("verifier");
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: false, canVerify: false } });
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.verifier,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				})
			).success,
		).toBe(false);
		signIn("admin");
		await pool.query(
			"update member set role='owner' where user_id='t1312-admin'",
		);
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: false, canVerify: false } });
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.admin,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				})
			).success,
		).toBe(true);
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.admin,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: false } });
	});
	it("denies inactive or unapproved verifier accounts and never restores a grant in a new employment period", async () => {
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.verifier,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				})
			).success,
		).toBe(true);
		signIn("verifier");
		await pool.query(
			"update member set status='pending' where user_id='t1312-verifier'",
		);
		expect(
			(
				await actions.getDrivingLicenceEmployeeAccessAction({
					employeeId: ids.anna,
				})
			).success,
		).toBe(false);
		await pool.query(
			"update member set status='approved' where user_id='t1312-verifier'",
		);
		await pool.query("update employee set is_active=false where id=$1", [
			ids.verifier,
		]);
		expect(
			(await actions.getDrivingLicenceVerifierResponsibilityAction()).success,
		).toBe(false);
		await pool.query("update employee set is_active=true where id=$1", [
			ids.verifier,
		]);
		await pool.query(
			"update employee_employment_period set status='closed',ended_at=now() where id=$1",
			[ids.verifier],
		);
		await pool.query(
			"insert into employee_employment_period(organization_id,employee_id,status,started_at,start_provenance) values($1,$2,'open',now(),'recorded')",
			[ORG, ids.verifier],
		);
		expect(
			await actions.getDrivingLicenceVerifierResponsibilityAction(),
		).toEqual({ success: true, data: null });
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: false, canVerify: false } });
		signIn("admin");
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.verifier,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				})
			).success,
		).toBe(true);
		signIn("verifier");
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: true } });
	});
	it("resolves secondary team memberships live and keeps former employee evidence read-only", async () => {
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.verifier,
					scope: "specific",
					teamIds: [ids.team],
					employeeIds: [],
				})
			).success,
		).toBe(true);
		await pool.query(
			"insert into team_membership(organization_id,employee_id,team_id,created_by) values($1,$2,$3,'t1312-admin')",
			[ORG, ids.ben, ids.team],
		);
		signIn("verifier");
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.ben,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: true } });
		await pool.query("delete from team_membership where employee_id=$1", [
			ids.ben,
		]);
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.ben,
			}),
		).toEqual({ success: true, data: { canRead: false, canVerify: false } });
		await pool.query("update employee set is_active=false where id=$1", [
			ids.anna,
		]);
		expect(
			await actions.getDrivingLicenceEmployeeAccessAction({
				employeeId: ids.anna,
			}),
		).toEqual({ success: true, data: { canRead: true, canVerify: false } });
	});
	it("denies a verifier at an effective pending departure cutoff before background revocation runs", async () => {
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.verifier,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				})
			).success,
		).toBe(true);
		await pool.query(
			"insert into employee_departure(organization_id,employee_id,employment_period_id,mode,last_working_day,timezone,cutoff_at,created_by,request_id,request_fingerprint,revision,status) values($1,$2,$2,'scheduled','2026-01-01','Europe/Berlin','2026-01-02T00:00:00Z','t1312-admin',gen_random_uuid(),'test',1,'pending')",
			[ORG, ids.verifier],
		);
		signIn("verifier");
		expect(
			(await actions.getDrivingLicenceVerifierResponsibilityAction()).success,
		).toBe(false);
		expect(
			(
				await actions.getDrivingLicenceEmployeeAccessAction({
					employeeId: ids.anna,
				})
			).success,
		).toBe(false);
		signIn("admin");
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.verifier,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				})
			).success,
		).toBe(false);
	});
	it("refuses newly naming a former employee and keeps one the grant already names (#1438)", async () => {
		const named = (employeeIds: string[]) =>
			actions.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: ids.verifier,
				scope: "specific",
				teamIds: [],
				employeeIds,
			});
		await pool.query("update employee set is_active = false where id = $1", [ids.ben]);
		expect(await named([ids.ben])).toEqual({ success: false, error: "former_employee" });
		await pool.query("update employee set is_active = true where id = $1", [ids.ben]);
		expect((await named([ids.ben])).success).toBe(true);
		await pool.query("update employee set is_active = false where id = $1", [ids.ben]);
		expect((await named([ids.ben, ids.anna])).success).toBe(true);
		const [active] = (
			await pool.query<{ employee_ids: string[] }>(
				"select employee_ids from driving_licence_verifier_grant where verifier_employee_id = $1 and revoked_at is null",
				[ids.verifier],
			)
		).rows;
		expect(active?.employee_ids.toSorted()).toEqual([ids.anna, ids.ben].toSorted());
	});
	it("offers the current roster and keeps a former employee a live grant names, marked (#1438)", async () => {
		const offered = async () => {
			const data = await actions.getDrivingLicenceVerifierAdminDataAction();
			if (!data.success) throw new Error(data.error);
			return Object.fromEntries(data.data.employees.map((row) => [row.id, row.isFormer]));
		};
		await pool.query("update employee set is_active = false where id = any($1::uuid[])", [
			[ids.ben, ids.anna],
		]);
		expect(await offered()).toEqual({ [ids.admin]: false, [ids.verifier]: false });

		await pool.query("update employee set is_active = true where id = $1", [ids.ben]);
		expect(
			(
				await actions.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: ids.verifier,
					scope: "specific",
					teamIds: [],
					employeeIds: [ids.ben],
				})
			).success,
		).toBe(true);
		await pool.query("update employee set is_active = false where id = $1", [ids.ben]);
		expect(await offered()).toEqual({
			[ids.admin]: false,
			[ids.verifier]: false,
			[ids.ben]: true,
		});
	});
});
