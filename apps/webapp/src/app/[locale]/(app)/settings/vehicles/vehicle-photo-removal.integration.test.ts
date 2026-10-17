import sharp from "sharp";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: "removal-photo-owner",
	organizationId: "removal-photo-org",
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
vi.mock("@/lib/organization-mfa/organization-access", async (original) => ({
	...(await original<
		typeof import("@/lib/organization-mfa/organization-access")
	>()),
	canAccessOrganization: async () => true,
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
const { listVehiclePhotos, initiateVehiclePhotoUpload, removeVehiclePhoto } =
	await import("./photo-actions");
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
		"delete from organization where id in ('removal-photo-org','removal-photo-other')",
	);
	await admin.query(
		"delete from organization_vehicle_photo_upload where organization_id in ('removal-photo-org','removal-photo-other')",
	);
	await admin.query("delete from \"user\" where id like 'removal-photo-%'");
}
beforeEach(async () => {
	await cleanup();
	harness.userId = "removal-photo-owner";
	harness.organizationId = "removal-photo-org";
	harness.objects.clear();
	harness.failDelete = false;
	harness.failStore = false;
	harness.beforeStore = null;
	await admin.query(
		"insert into organization(id,name,slug,created_at) values ('removal-photo-org','Photos','removal-photo-org',now()),('removal-photo-other','Other','removal-photo-other',now())",
	);
	for (const [id, role] of [
		["removal-photo-owner", "owner"],
		["removal-photo-admin", "admin"],
		["removal-photo-member", "member"],
		["removal-photo-manager", "member"],
		["removal-photo-employee-admin", "member"],
	]) {
		await admin.query(
			"insert into \"user\"(id,name,email,created_at,updated_at) values($1,$1,$1 || '@example.test',now(),now())",
			[id],
		);
		await admin.query(
			"insert into member(id,organization_id,user_id,role,status,created_at) values($1,'removal-photo-org',$1,$2,'approved',now())",
			[id, role],
		);
	}
	await admin.query(
		"insert into employee(user_id,organization_id,role,updated_at) values('removal-photo-manager','removal-photo-org','manager',now()),('removal-photo-employee-admin','removal-photo-org','admin',now())",
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
it("removes a photo immediately, releases capacity and durably retries physical deletion", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	expect(await removeVehiclePhoto(vehicleId, id)).toMatchObject({
		success: true,
		data: { ok: true, removed: true },
	});
	expect((await gallery()).photos).toEqual([]);
	expect((await read(id)).status).toBe(404);
	expect(harness.objects.size).toBe(1);
	harness.failDelete = true;
	expect(await runVehiclePhotoCleanupJob()).toMatchObject({ failed: 1 });
	expect((await read(id)).status).toBe(404);
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
				"select action from audit_log where entity_id=$1 and action='vehicle.photo_removed'",
				[vehicleId],
			)
		).rowCount,
	).toBe(1);
});
it.each([
	"removal-photo-member",
	"removal-photo-manager",
	"removal-photo-employee-admin",
	"",
])(
	"denies removal by unauthorized actor %s without changing the gallery",
	async (userId) => {
		const id = await start();
		expect((await upload(id, await image())).status).toBe(200);
		harness.userId = userId;
		expect(await removeVehiclePhoto(vehicleId, id)).toMatchObject({
			success: false,
		});
		harness.userId = "removal-photo-owner";
		expect((await read(id)).status).toBe(200);
		expect((await gallery()).photos.map((p) => p.id)).toEqual([id]);
		expect(
			(
				await admin.query(
					"select action from audit_log where entity_id=$1 and action='vehicle.photo_removed'",
					[vehicleId],
				)
			).rowCount,
		).toBe(0);
	},
);
it("denies other organizations and mismatched vehicle identities, while allowing an organization admin", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	const other = await changeVehicles({
		kind: "create",
		name: "Other",
		licencePlate: "PHOTO2",
		drivers: { employeeIds: [], teamIds: [] },
	});
	if (!other.success || !other.data.ok) throw new Error("create failed");
	const otherVehicle = other.data.vehicles.find((v) => v.id !== vehicleId);
	if (!otherVehicle) throw new Error("Missing other vehicle");
	expect(await removeVehiclePhoto(otherVehicle.id, id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "photo_not_found" },
	});
	await admin.query(
		"insert into member(id,organization_id,user_id,role,status,created_at) values('removal-other-membership','removal-photo-other','removal-photo-owner','owner','approved',now())",
	);
	harness.organizationId = "removal-photo-other";
	expect(await removeVehiclePhoto(vehicleId, id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "vehicle_not_found" },
	});
	harness.organizationId = "removal-photo-org";
	harness.userId = "removal-photo-admin";
	expect((await read(id)).status).toBe(200);
	expect(await removeVehiclePhoto(vehicleId, id)).toMatchObject({
		success: true,
		data: { ok: true, removed: true },
	});
});
it("rechecks archival on stale removal and allows removal after restoration", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	await changeVehicles({ kind: "archive", vehicleId });
	expect(await removeVehiclePhoto(vehicleId, id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "vehicle_archived" },
	});
	expect((await gallery()).archived).toBe(true);
	expect((await read(id)).status).toBe(200);
	await changeVehicles({ kind: "restore", vehicleId });
	expect(await removeVehiclePhoto(vehicleId, id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect((await read(id)).status).toBe(404);
});
it("serializes repeated concurrent removal without duplicate audit and never reattaches that identity", async () => {
	const id = await start();
	const bytes = await image();
	expect((await upload(id, bytes)).status).toBe(200);
	const results = await Promise.all([
		removeVehiclePhoto(vehicleId, id),
		removeVehiclePhoto(vehicleId, id),
	]);
	expect(results).toEqual(
		expect.arrayContaining([
			{ success: true, data: { ok: true, removed: true } },
			{ success: true, data: { ok: true, removed: false } },
		]),
	);
	expect((await upload(id, bytes)).status).toBe(409);
	expect(
		(
			await admin.query(
				"select action from audit_log where entity_id=$1 and action='vehicle.photo_removed'",
				[vehicleId],
			)
		).rowCount,
	).toBe(1);
});
it("releases one of twenty slots and preserves the surviving upload order", async () => {
	const ids: string[] = [];
	const bytes = await image();
	for (let index = 0; index < 20; index++) {
		const id = await start();
		ids.push(id);
		expect((await upload(id, bytes)).status).toBe(200);
	}
	expect(await initiateVehiclePhotoUpload(vehicleId)).toMatchObject({
		success: true,
		data: { ok: false, reason: "photo_limit" },
	});
	expect(await removeVehiclePhoto(vehicleId, ids[4])).toMatchObject({
		success: true,
		data: { ok: true },
	});
	const replacement = await start();
	expect((await upload(replacement, bytes)).status).toBe(200);
	expect((await gallery()).photos.map((p) => p.id)).toEqual([
		...ids.filter((id) => id !== ids[4]),
		replacement,
	]);
});
it("serializes a removal with an attaching upload and keeps the remaining photo safe from cleanup", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	const fresh = await start();
	let release!: () => void;
	let entered!: () => void;
	const writing = new Promise<void>((r) => (entered = r));
	const gate = new Promise<void>((r) => (release = r));
	harness.beforeStore = async () => {
		entered();
		await gate;
	};
	const attaching = upload(fresh, await image());
	await writing;
	const removal = removeVehiclePhoto(vehicleId, id);
	release();
	expect((await attaching).status).toBe(200);
	expect(await removal).toMatchObject({ success: true, data: { ok: true } });
	await runVehiclePhotoCleanupJob();
	expect((await read(id)).status).toBe(404);
	expect((await read(fresh)).status).toBe(200);
	expect((await gallery()).photos.map((p) => p.id)).toEqual([fresh]);
});
it("rolls back both removal and cleanup intent when the successful-change audit cannot commit", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	await admin.query(
		"create function t1272_reject_removal_audit() returns trigger language plpgsql as $$ begin if NEW.organization_id='removal-photo-org' and NEW.action='vehicle.photo_removed' then raise exception 'test audit unavailable'; end if; return NEW; end $$; create trigger t1272_reject_removal_audit before insert on audit_log for each row execute function t1272_reject_removal_audit()",
	);
	try {
		expect(await removeVehiclePhoto(vehicleId, id)).toMatchObject({
			success: false,
		});
		expect((await gallery()).photos.map((p) => p.id)).toEqual([id]);
		expect((await read(id)).status).toBe(200);
		expect(
			(
				await admin.query(
					"select status from organization_vehicle_photo_upload where id=$1",
					[id],
				)
			).rows,
		).toEqual([{ status: "attached" }]);
		await runVehiclePhotoCleanupJob();
		expect((await read(id)).status).toBe(200);
	} finally {
		await admin.query(
			"drop trigger t1272_reject_removal_audit on audit_log; drop function t1272_reject_removal_audit()",
		);
	}
	expect(await removeVehiclePhoto(vehicleId, id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
});
it("keeps whole-vehicle deletion coherent when an individual removal runs concurrently", async () => {
	const id = await start();
	expect((await upload(id, await image())).status).toBe(200);
	const [removal, deletion] = await Promise.all([
		removeVehiclePhoto(vehicleId, id),
		changeVehicles({ kind: "delete", vehicleId }),
	]);
	expect(deletion).toMatchObject({ success: true, data: { ok: true } });
	expect(removal.success).toBe(true);
	expect((await read(id)).status).toBe(404);
	expect(
		(
			await admin.query(
				"select action from audit_log where entity_id=$1 and action='vehicle.photo_removed'",
				[vehicleId],
			)
		).rowCount,
	).toBeLessThanOrEqual(1);
	await runVehiclePhotoCleanupJob();
	expect(harness.objects.size).toBe(0);
});
it.each([undefined, null, "", 42])(
	"refuses malformed photo identity %s without deleting the gallery",
	async (invalid) => {
		const id = await start();
		expect((await upload(id, await image())).status).toBe(200);
		expect(
			await Reflect.apply(removeVehiclePhoto, undefined, [vehicleId, invalid]),
		).toMatchObject({ success: false });
		expect((await gallery()).photos.map((p) => p.id)).toEqual([id]);
		expect((await read(id)).status).toBe(200);
	},
);
