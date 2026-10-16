import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: "photo-owner",
	organizationId: "photo-org",
	objects: new Map<string, Uint8Array>(),
	failDelete: false,
	failStore: false,
	beforeStore: null as null | (() => Promise<void>),
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
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/enterprise-identity/session-sso-store", async (original) => ({
	...(await original<
		typeof import("@/lib/enterprise-identity/session-sso-store")
	>()),
	canAccessOrganizationWithSso: async () => true,
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	getStorageConfig: async () => ({ bucket: "private" }),
	uploadPrivateObject: async (_org: string, key: string, data: Uint8Array) => {
		await harness.beforeStore?.();
		if (harness.failStore) throw new Error("Temporary storage failure");
		harness.objects.set(key, data);
		return { bucket: "private", versionId: null };
	},
	readPrivateObject: async ({ key }: { key: string }) => {
		const data = harness.objects.get(key);
		if (!data) throw new Error("Missing object");
		return data;
	},
	deletePrivateObjectVersions: async ({ key }: { key: string }) => {
		if (harness.failDelete) throw new Error("Storage unavailable");
		harness.objects.delete(key);
	},
}));
const { changeVehicles } = await import("./actions");
const { listVehiclePhotos, initiateVehiclePhotoUpload } = await import(
	"./photo-actions"
);
const { runVehiclePhotoCleanupJob } = await import(
	"@/lib/jobs/vehicle-photo-cleanup"
);
const { POST, GET } = await import(
	"@/app/api/organization/vehicles/[vehicleId]/photos/[photoId]/route"
);
const admin = integrationAdminPool();
let vehicleId: string;
const origin = "https://z8.example.test";
async function start(id = vehicleId) {
	const result = await initiateVehiclePhotoUpload(id);
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return result.data.uploadId;
}
async function upload(
	id: string,
	bytes: Uint8Array,
	type = "image/png",
	vehicle = vehicleId,
) {
	return POST(
		new Request(`${origin}/api/organization/vehicles/${vehicle}/photos/${id}`, {
			method: "POST",
			headers: { origin, "content-type": type },
			body: bytes,
		}),
		{ params: Promise.resolve({ vehicleId: vehicle, photoId: id }) },
	);
}
async function read(id: string, vehicle = vehicleId) {
	return GET(new Request(origin), {
		params: Promise.resolve({ vehicleId: vehicle, photoId: id }),
	});
}
async function gallery() {
	const result = await listVehiclePhotos(vehicleId);
	if (!result.success) throw new Error(result.error);
	return result.data;
}
async function image() {
	return sharp({
		create: { width: 80, height: 40, channels: 3, background: "red" },
	})
		.png()
		.toBuffer();
}
async function cleanup() {
	await admin.query(
		"delete from organization where id in ('photo-org','photo-other')",
	);
	await admin.query(
		"delete from organization_vehicle_photo_upload where organization_id in ('photo-org','photo-other')",
	);
	await admin.query("delete from \"user\" where id like 'photo-%'");
}
beforeEach(async () => {
	await cleanup();
	harness.userId = "photo-owner";
	harness.organizationId = "photo-org";
	harness.objects.clear();
	harness.failDelete = false;
	harness.failStore = false;
	harness.beforeStore = null;
	await admin.query(
		"insert into organization(id,name,slug,created_at) values ('photo-org','Photos','photo-org',now()),('photo-other','Other','photo-other',now())",
	);
	for (const [id, role] of [
		["photo-owner", "owner"],
		["photo-admin", "admin"],
		["photo-member", "member"],
		["photo-manager", "member"],
		["photo-employee-admin", "member"],
	]) {
		await admin.query(
			"insert into \"user\"(id,name,email,created_at,updated_at) values($1,$1,$1 || '@example.test',now(),now())",
			[id],
		);
		await admin.query(
			"insert into member(id,organization_id,user_id,role,status,created_at) values($1,'photo-org',$1,$2,'approved',now())",
			[id, role],
		);
	}
	await admin.query(
		"insert into employee(user_id,organization_id,role,updated_at) values('photo-manager','photo-org','manager',now()),('photo-employee-admin','photo-org','admin',now())",
	);
	const result = await changeVehicles({
		kind: "create",
		name: "Photo van",
		licencePlate: "PHOTO 1",
		drivers: { employeeIds: [], teamIds: [] },
	});
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	vehicleId = result.data.vehicles[0].id;
});
afterAll(cleanup);
describe("private vehicle photos through actions and routes", () => {
	it("saves an optimized private photo immediately and serves it only through the authorized route", async () => {
		const id = await start();
		const response = await upload(id, await image());
		expect(response.status).toBe(200);
		const saved = await gallery();
		expect(saved.photos).toMatchObject([
			{ id, vehicleId, width: 80, height: 40 },
		]);
		expect(JSON.stringify(saved)).not.toContain("storageKey");
		const delivered = await read(id);
		expect(delivered.status).toBe(200);
		expect(delivered.headers.get("cache-control")).toBe("private, no-store");
		const metadata = await sharp(
			Buffer.from(await delivered.arrayBuffer()),
		).metadata();
		expect(metadata.format).toBe("webp");
		expect(metadata.exif).toBeUndefined();
		expect(
			(
				await admin.query(
					"select action from audit_log where entity_id=$1 and action='vehicle.photo_added'",
					[vehicleId],
				)
			).rowCount,
		).toBe(1);
	});
});

it("keeps failed cleanup recoverable after vehicle deletion and never cleans attached photos", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	await runVehiclePhotoCleanupJob();
	expect((await read(id)).status).toBe(200);
	harness.failDelete = true;
	const removed = await changeVehicles({ kind: "delete", vehicleId });
	expect(removed).toMatchObject({ success: true, data: { ok: true } });
	expect((await read(id)).status).toBe(404);
	expect(await runVehiclePhotoCleanupJob()).toMatchObject({ failed: 1 });
	expect(harness.objects.size).toBe(1);
	harness.failDelete = false;
	await admin.query(
		"update organization_vehicle_photo_upload set next_attempt_at=now()-interval '1 second' where id=$1",
		[id],
	);
	expect(await runVehiclePhotoCleanupJob()).toMatchObject({ deleted: 1 });
	expect(harness.objects.size).toBe(0);
	expect(
		(
			await admin.query(
				"select status from organization_vehicle_photo_upload where id=$1",
				[id],
			)
		).rows,
	).toEqual([{ status: "cleaned" }]);
});

it("retries a transient storage failure with the same upload identity exactly once", async () => {
	const id = await start();
	harness.failStore = true;
	expect((await upload(id, await image())).status).toBe(503);
	harness.failStore = false;
	expect((await upload(id, await image())).status).toBe(200);
	expect((await upload(id, await image())).status).toBe(200);
	expect((await gallery()).photos).toHaveLength(1);
	expect(
		(
			await admin.query(
				"select action from audit_log where entity_id=$1 and action='vehicle.photo_added'",
				[vehicleId],
			)
		).rowCount,
	).toBe(1);
});
it("retains by-value cleanup work when an organization cascades its vehicle deletion", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	await admin.query("delete from organization where id='photo-org'");
	expect(
		(
			await admin.query(
				"select status,storage_bucket from organization_vehicle_photo_upload where id=$1",
				[id],
			)
		).rows,
	).toEqual([{ status: "cleanup_required", storage_bucket: "private" }]);
	await runVehiclePhotoCleanupJob();
	expect(harness.objects.size).toBe(0);
});
it.each([
	[
		"truncated PNG",
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		"image/png",
	],
	["spoofed PNG", Buffer.from("not an image"), "image/png"],
	[
		"SVG",
		Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
		"image/svg+xml",
	],
	["HEIC", Buffer.from("not decoded"), "image/heic"],
])(
	"refuses %s with useful image feedback and no attachment",
	async (_name, bytes, mime) => {
		const id = await start();
		const result = await upload(id, bytes, mime);
		expect(result.status).toBe(400);
		expect((await result.json()).error).toMatch(/JPEG|PNG|WebP|HEIC|decode/);
		expect((await gallery()).photos).toHaveLength(0);
		expect(harness.objects.size).toBe(0);
		expect(
			(
				await admin.query(
					"select action from audit_log where entity_id=$1 and action='vehicle.photo_added'",
					[vehicleId],
				)
			).rowCount,
		).toBe(0);
	},
);
it("applies embedded orientation, bounds the long edge and removes EXIF including GPS", async () => {
	const bytes = await sharp({
		create: { width: 4000, height: 2000, channels: 3, background: "red" },
	})
		.withMetadata({ orientation: 6 })
		.withExif({
			IFD0: { Artist: "Private person" },
			IFD3: {
				GPSLatitudeRef: "N",
				GPSLatitude: "48/1 8/1 0/1",
				GPSLongitudeRef: "E",
				GPSLongitude: "11/1 34/1 0/1",
			},
		})
		.jpeg()
		.toBuffer();
	expect((await sharp(bytes).metadata()).exif).toBeDefined();
	const id = await start();
	expect((await upload(id, bytes, "image/jpeg")).status).toBe(200);
	const delivered = await read(id);
	const metadata = await sharp(
		Buffer.from(await delivered.arrayBuffer()),
	).metadata();
	expect(metadata).toMatchObject({ format: "webp", width: 1280, height: 2560 });
	expect(metadata.exif).toBeUndefined();
	expect(metadata.xmp).toBeUndefined();
	expect(metadata.icc).toBeUndefined();
	expect(metadata.orientation).toBeUndefined();
});
it("accepts the inclusive actual 10 MiB boundary and rejects one byte more without trusting headers", async () => {
	const jpeg = await sharp(await image())
		.jpeg()
		.toBuffer();
	const exact = Buffer.alloc(10 * 1024 * 1024);
	jpeg.copy(exact);
	expect((await upload(await start(), exact, "image/jpeg")).status).toBe(200);
	const oversized = Buffer.concat([exact, Buffer.from([0])]);
	expect((await upload(await start(), oversized, "image/jpeg")).status).toBe(
		413,
	);
	expect((await gallery()).photos).toHaveLength(1);
});
it("keeps initiation order when finalizations complete in reverse order", async () => {
	const first = await start(),
		second = await start();
	const bytes = await sharp(await image())
		.webp()
		.toBuffer();
	expect((await upload(second, bytes, "image/webp")).status).toBe(200);
	expect((await upload(first, await image())).status).toBe(200);
	expect((await gallery()).photos.map((p) => p.id)).toEqual([first, second]);
});
it("serializes simultaneous finalizations at twenty and repeated finalization does not consume another slot", async () => {
	const bytes = await image();
	for (let n = 0; n < 19; n++)
		expect((await upload(await start(), bytes)).status).toBe(200);
	const a = await start(),
		b = await start();
	const results = await Promise.all([upload(a, bytes), upload(b, bytes)]);
	expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
	const rows = (await gallery()).photos;
	expect(rows).toHaveLength(20);
	const accepted = rows.find((p) => p.id === a || p.id === b);
	if (!accepted) throw new Error("Missing accepted photo");
	expect((await upload(accepted.id, Buffer.alloc(0))).status).toBe(200);
	expect(await initiateVehiclePhotoUpload(vehicleId)).toMatchObject({
		success: true,
		data: { ok: false, reason: "photo_limit" },
	});
	expect(
		(
			await admin.query(
				"select action from audit_log where entity_id=$1 and action='vehicle.photo_added'",
				[vehicleId],
			)
		).rowCount,
	).toBe(20);
});
it.each(["photo-member", "photo-manager", "photo-employee-admin", ""])(
	"denies %s at every direct server entry point",
	async (userId) => {
		const id = await start();
		expect((await upload(id, await image())).status).toBe(200);
		const pending = await start();
		harness.userId = userId;
		expect(await listVehiclePhotos(vehicleId)).toMatchObject({
			success: false,
		});
		expect(await initiateVehiclePhotoUpload(vehicleId)).toMatchObject({
			success: false,
		});
		expect((await read(id)).status).toBe(userId ? 403 : 401);
		expect((await upload(pending, await image())).status).toBe(
			userId ? 403 : 401,
		);
	},
);
it("permits organization admin access but denies other-organization and mismatched vehicle identifiers", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	harness.userId = "photo-admin";
	expect((await read(id)).status).toBe(200);
	expect((await gallery()).photos).toHaveLength(1);
	const other = await changeVehicles({
		kind: "create",
		name: "Other van",
		licencePlate: "PHOTO 2",
		drivers: { employeeIds: [], teamIds: [] },
	});
	if (!other.success || !other.data.ok) throw new Error("create failed");
	const otherVehicle = other.data.vehicles.find((v) => v.id !== vehicleId);
	if (!otherVehicle) throw new Error("Missing other vehicle");
	expect((await read(id, otherVehicle.id)).status).toBe(404);
	harness.userId = "photo-owner";
	harness.organizationId = "photo-other";
	await admin.query(
		"insert into member(id,organization_id,user_id,role,status,created_at) values('photo-other-membership','photo-other','photo-owner','owner','approved',now())",
	);
	expect((await read(id)).status).toBe(404);
	expect(await initiateVehiclePhotoUpload(vehicleId)).toMatchObject({
		success: true,
		data: { ok: false, reason: "vehicle_not_found" },
	});
	expect(await listVehiclePhotos(vehicleId)).toMatchObject({ success: false });
});
it("refuses cross-origin binary uploads", async () => {
	const id = await start();
	const response = await POST(
		new Request(
			`${origin}/api/organization/vehicles/${vehicleId}/photos/${id}`,
			{
				method: "POST",
				headers: {
					origin: "https://attacker.test",
					"content-type": "image/png",
				},
				body: await image(),
			},
		),
		{ params: Promise.resolve({ vehicleId, photoId: id }) },
	);
	expect(response.status).toBe(403);
	expect((await gallery()).photos).toHaveLength(0);
});
it("keeps archived photos viewable, refuses attachment, and allows fresh uploads after restoration", async () => {
	const saved = await start();
	expect((await upload(saved, await image())).status).toBe(200);
	const pending = await start();
	await changeVehicles({ kind: "archive", vehicleId });
	expect((await gallery()).archived).toBe(true);
	expect((await read(saved)).status).toBe(200);
	expect(await initiateVehiclePhotoUpload(vehicleId)).toMatchObject({
		success: true,
		data: { ok: false, reason: "vehicle_archived" },
	});
	expect((await upload(pending, await image())).status).toBe(409);
	expect((await gallery()).photos).toHaveLength(1);
	await changeVehicles({ kind: "restore", vehicleId });
	expect((await upload(await start(), await image())).status).toBe(200);
	expect((await gallery()).photos).toHaveLength(2);
});
it.each(["archive", "delete"] as const)(
	"refuses a delayed upload after a concurrent %s commits",
	async (kind) => {
		const id = await start();
		const bytes = await image();
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		let entered!: () => void;
		const reading = new Promise<void>((r) => (entered = r));
		let sent = false;
		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				if (!sent) {
					sent = true;
					controller.enqueue(bytes);
					entered();
				} else {
					await gate;
					controller.close();
				}
			},
		});
		const request = new Request(
			`${origin}/api/organization/vehicles/${vehicleId}/photos/${id}`,
			{
				method: "POST",
				headers: { origin, "content-type": "image/png" },
				body,
				duplex: "half",
			} as RequestInit,
		);
		const pending = POST(request, {
			params: Promise.resolve({ vehicleId, photoId: id }),
		});
		await reading;
		expect(await changeVehicles({ kind, vehicleId })).toMatchObject({
			success: true,
			data: { ok: true },
		});
		release();
		expect((await pending).status).toBe(409);
		expect((await read(id)).status).toBe(404);
		expect(harness.objects.size).toBe(0);
	},
);
it("an upload holding the attachment lock commits before a concurrent archive and cleanup cannot remove it", async () => {
	const id = await start();
	let entered!: () => void;
	let release!: () => void;
	const writing = new Promise<void>((r) => (entered = r));
	const gate = new Promise<void>((r) => (release = r));
	harness.beforeStore = async () => {
		entered();
		await gate;
	};
	const pending = upload(id, await image());
	await writing;
	const archive = changeVehicles({ kind: "archive", vehicleId });
	await runVehiclePhotoCleanupJob();
	release();
	expect((await pending).status).toBe(200);
	await archive;
	expect((await read(id)).status).toBe(200);
	expect((await gallery()).archived).toBe(true);
});
it("rejects authorization revoked after initiation without producing a photo audit", async () => {
	harness.userId = "photo-admin";
	const id = await start();
	await admin.query(
		"update member set role='member' where user_id='photo-admin'",
	);
	expect((await upload(id, await image())).status).toBe(403);
	expect(harness.objects.size).toBe(0);
	expect(
		(
			await admin.query(
				"select action from audit_log where entity_id=$1 and action='vehicle.photo_added'",
				[vehicleId],
			)
		).rowCount,
	).toBe(0);
});
it("records abandoned upload cleanup durably and refuses finalization once cleanup consumed its identity", async () => {
	const id = await start();
	await admin.query(
		"update organization_vehicle_photo_upload set next_attempt_at=now()-interval '1 second' where id=$1",
		[id],
	);
	expect(await runVehiclePhotoCleanupJob()).toMatchObject({ deleted: 1 });
	expect((await upload(id, await image())).status).toBe(409);
	expect((await gallery()).photos).toHaveLength(0);
});
it("preserves the gallery when existing work usage prevents vehicle deletion", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	await admin.query(
		"create table t1270_vehicle_use_probe(vehicle_id uuid not null,organization_id text not null,foreign key(vehicle_id,organization_id) references organization_vehicle(id,organization_id))",
	);
	try {
		await admin.query(
			"insert into t1270_vehicle_use_probe values($1,'photo-org')",
			[vehicleId],
		);
		expect(await changeVehicles({ kind: "delete", vehicleId })).toMatchObject({
			success: true,
			data: { ok: false, reason: "vehicle_used" },
		});
		expect((await read(id)).status).toBe(200);
		await runVehiclePhotoCleanupJob();
		expect(harness.objects.size).toBe(1);
	} finally {
		await admin.query("drop table t1270_vehicle_use_probe");
	}
});
it("enforces same-organization ownership in PostgreSQL even with valid foreign identifiers", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	await expect(
		admin.query(
			"update organization_vehicle_photo set organization_id='photo-other' where id=$1",
			[id],
		),
	).rejects.toThrow();
	expect((await read(id)).status).toBe(200);
});
it("keeps the durable object reference when an audit failure rolls back attachment after storage succeeds", async () => {
	const id = await start();
	await admin.query(
		"create function t1270_reject_photo_audit() returns trigger language plpgsql as $$ begin if NEW.organization_id='photo-org' and NEW.action='vehicle.photo_added' then raise exception 'test audit unavailable'; end if; return NEW; end $$; create trigger t1270_reject_photo_audit before insert on audit_log for each row execute function t1270_reject_photo_audit()",
	);
	try {
		expect((await upload(id, await image())).status).toBe(503);
		expect((await gallery()).photos).toHaveLength(0);
		expect(harness.objects.size).toBe(1);
		expect(
			(
				await admin.query(
					"select storage_bucket,status from organization_vehicle_photo_upload where id=$1",
					[id],
				)
			).rows,
		).toEqual([{ storage_bucket: "private", status: "pending" }]);
	} finally {
		await admin.query(
			"drop trigger t1270_reject_photo_audit on audit_log; drop function t1270_reject_photo_audit()",
		);
	}
	await admin.query(
		"update organization_vehicle_photo_upload set next_attempt_at=now()-interval '1 second' where id=$1",
		[id],
	);
	expect(await runVehiclePhotoCleanupJob()).toMatchObject({ deleted: 1 });
	expect(harness.objects.size).toBe(0);
});
