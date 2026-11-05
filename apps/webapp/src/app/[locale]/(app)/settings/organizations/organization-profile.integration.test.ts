import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1566-owner" as string | null,
	organizationId: "t1566-org" as string | null,
}));
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				session.userId
					? {
							user: { id: session.userId, role: "user" },
							session: {
								id: `session-${session.userId}`,
								userId: session.userId,
								activeOrganizationId: session.organizationId,
							},
						}
					: null,
		},
	},
}));

const { getOrganizationProfile, saveOrganizationProfile } = await import(
	"./profile-actions"
);
const pool = integrationAdminPool();
const emptyProfile = {
	legalCompanyName: "",
	addressLine1: "",
	addressLine2: "",
	postalCode: "",
	city: "",
	stateOrRegion: "",
	country: "",
	vatId: "",
};
async function clean() {
	await pool.query("delete from organization where id like 't1566-%'");
	await pool.query('delete from "user" where id like $1', ["t1566-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1566-org", "t1566-other"]) {
		await pool.query(
			"insert into organization(id,name,slug,created_at) values($1,'Display name',$1,now())",
			[org],
		);
	}
	for (const [name, role, status] of [
		["owner", "owner", "approved"],
		["admin", "admin", "approved"],
		["member", "member", "approved"],
		["pending", "admin", "pending"],
		["inactive", "admin", "approved"],
	]) {
		await pool.query(
			'insert into "user"(id,name,email,created_at,updated_at) values($1,$1,$2,now(),now())',
			[`t1566-${name}`, `${name}@t1566.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,'t1566-org',$2,$3,now())",
			[`t1566-${name}`, role, status],
		);
	}
	// Even membership in both organizations must not bypass the active-org boundary.
	await pool.query(
		"insert into member(id,user_id,organization_id,role,status,created_at) values('t1566-other-owner','t1566-owner','t1566-other','owner','approved',now())",
	);
	await pool.query(
		"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values('15660000-0000-4000-8000-000000000001','t1566-inactive','t1566-org','admin',false,now())",
	);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1566-owner";
	session.organizationId = "t1566-org";
	await pool.query(
		"delete from organization_profile where organization_id like 't1566-%'",
	);
});

it("starts empty and lets the owner save and reload a partial legal profile", async () => {
	expect(await getOrganizationProfile("t1566-org")).toEqual({
		success: true,
		data: emptyProfile,
	});
	expect(
		await saveOrganizationProfile("t1566-org", {
			...emptyProfile,
			legalCompanyName: "Umami Creative GmbH",
		}),
	).toMatchObject({ success: true });
	expect(await getOrganizationProfile("t1566-org")).toEqual({
		success: true,
		data: { ...emptyProfile, legalCompanyName: "Umami Creative GmbH" },
	});
});

it("validates supplied profile values at the authenticated boundary without replacing saved values", async () => {
	await saveOrganizationProfile("t1566-org", {
		...emptyProfile,
		legalCompanyName: "Umami Creative GmbH",
	});
	for (const [field, value] of [
		["vatId", "not a vat id"],
		["country", "ZZ"],
		["city", "x".repeat(201)],
		["addressLine1", 42],
		["legalCompanyName", null],
		["postalCode", "\u0000"],
	]) {
		expect(
			await saveOrganizationProfile("t1566-org", {
				...emptyProfile,
				[field]: value,
			}),
		).toMatchObject({
			success: true,
			data: { ok: false, fieldErrors: { [field]: expect.any(String) } },
		});
	}
	expect(await getOrganizationProfile("t1566-org")).toMatchObject({
		success: true,
		data: { legalCompanyName: "Umami Creative GmbH" },
	});
});

it("accepts omitted VAT and address values when saving a partial or empty profile", async () => {
	expect(
		await saveOrganizationProfile("t1566-org", {
			legalCompanyName: "Legal entity",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(await getOrganizationProfile("t1566-org")).toEqual({
		success: true,
		data: { ...emptyProfile, legalCompanyName: "Legal entity" },
	});
	expect(await saveOrganizationProfile("t1566-org", {})).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect(await getOrganizationProfile("t1566-org")).toEqual({
		success: true,
		data: emptyProfile,
	});
});

it("lets an admin save all fields, reload them, then clear the entire profile", async () => {
	session.userId = "t1566-admin";
	const profile = {
		legalCompanyName: "Umami Creative GmbH",
		addressLine1: "Example Street 7",
		addressLine2: "Floor 2",
		postalCode: "10115",
		city: "Berlin",
		stateOrRegion: "Berlin",
		country: "DE",
		vatId: "DE123456789",
	};
	expect(
		await saveOrganizationProfile("t1566-org", {
			...profile,
			legalCompanyName: "  Umami Creative GmbH  ",
			country: "de",
			vatId: "de123456789",
		}),
	).toEqual({ success: true, data: { ok: true, profile } });
	expect(await getOrganizationProfile("t1566-org")).toEqual({
		success: true,
		data: profile,
	});
	expect(
		await saveOrganizationProfile("t1566-org", emptyProfile),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(await getOrganizationProfile("t1566-org")).toEqual({
		success: true,
		data: emptyProfile,
	});
});

it.each(["member", "pending", "inactive"])(
	"denies profile reads and writes to a %s actor using real organization permissions",
	async (actor) => {
		await saveOrganizationProfile("t1566-org", {
			...emptyProfile,
			city: "Berlin",
		});
		session.userId = `t1566-${actor}`;
		expect(await getOrganizationProfile("t1566-org")).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			await saveOrganizationProfile("t1566-org", {
				...emptyProfile,
				city: "Forbidden",
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		session.userId = "t1566-owner";
		expect(await getOrganizationProfile("t1566-org")).toMatchObject({
			success: true,
			data: { city: "Berlin" },
		});
	},
);

it("denies unauthenticated, missing-active-organization and nonmember access", async () => {
	for (const [userId, organizationId] of [
		[null, "t1566-org"],
		["t1566-owner", null],
		["t1566-member", "t1566-other"],
	]) {
		session.userId = userId;
		session.organizationId = organizationId;
		expect(
			await getOrganizationProfile(organizationId ?? "t1566-org"),
		).toMatchObject({ success: false });
		expect(
			await saveOrganizationProfile(
				organizationId ?? "t1566-org",
				emptyProfile,
			),
		).toMatchObject({ success: false });
	}
});

it("keeps two organizations independent and rejects another organization's identifier even for a shared owner", async () => {
	await saveOrganizationProfile("t1566-org", {
		...emptyProfile,
		city: "Berlin",
		organizationId: "t1566-other",
		name: "Cannot rename",
		timezone: "Pacific/Auckland",
	});
	expect(await getOrganizationProfile("t1566-other")).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	expect(
		await saveOrganizationProfile("t1566-other", {
			...emptyProfile,
			city: "Forbidden",
		}),
	).toMatchObject({ success: false, code: "AuthorizationError" });
	session.organizationId = "t1566-other";
	expect(await getOrganizationProfile("t1566-other")).toEqual({
		success: true,
		data: emptyProfile,
	});
	await saveOrganizationProfile("t1566-other", {
		...emptyProfile,
		city: "Paris",
	});
	expect(await getOrganizationProfile("t1566-other")).toMatchObject({
		success: true,
		data: { city: "Paris" },
	});
	session.organizationId = "t1566-org";
	expect(await getOrganizationProfile("t1566-org")).toMatchObject({
		success: true,
		data: { city: "Berlin" },
	});
});

it("preserves display name, operational geography and Stripe billing data when saving or clearing legal identity", async () => {
	await pool.query(
		"update organization set country='AT',region='Vienna',timezone='Europe/Vienna',metadata='{\"description\":\"Keep me\"}',shifts_enabled=true where id='t1566-org'",
	);
	await pool.query(
		"insert into subscription(organization_id,status,stripe_customer_id,metadata) values('t1566-org','active','cus_t1566','{\"billing_address\":\"Original billing address\"}') on conflict(organization_id) do nothing",
	);
	const unrelated = async () => ({
		organization: (
			await pool.query("select * from organization where id='t1566-org'")
		).rows,
		subscription: (
			await pool.query(
				"select * from subscription where organization_id='t1566-org'",
			)
		).rows,
	});
	const before = await unrelated();
	expect(await getOrganizationProfile("t1566-org")).toEqual({
		success: true,
		data: emptyProfile,
	});
	for (const profile of [
		{
			...emptyProfile,
			legalCompanyName: "Legal entity",
			country: "US",
			stateOrRegion: "California",
		},
		emptyProfile,
	]) {
		expect(await saveOrganizationProfile("t1566-org", profile)).toMatchObject({
			success: true,
			data: { ok: true },
		});
		expect(await unrelated()).toEqual(before);
	}
});

it("keeps unrelated display-name edits owner-only when an admin can edit the legal profile", async () => {
	session.userId = "t1566-admin";
	expect(
		await saveOrganizationProfile("t1566-org", {
			...emptyProfile,
			legalCompanyName: "Legal entity",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	const { updateOrganizationDetails } = await import("./actions");
	expect(
		await updateOrganizationDetails("t1566-org", { name: "Renamed" }),
	).toMatchObject({ success: false, code: "AuthorizationError" });
});
