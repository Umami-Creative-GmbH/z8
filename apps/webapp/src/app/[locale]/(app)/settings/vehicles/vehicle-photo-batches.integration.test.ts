import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: "batch-owner",
	organizationId: "batch-org",
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
const {
	listVehiclePhotos,
	initiateVehiclePhotoUpload,
	initiateVehiclePhotoBatchUpload,
	reconcileVehiclePhotoUpload,
} = await import("./photo-actions");
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
		"delete from organization where id in ('batch-org','batch-other')",
	);
	await admin.query(
		"delete from organization_vehicle_photo_upload where organization_id in ('batch-org','batch-other')",
	);
	await admin.query("delete from \"user\" where id like 'batch-%'");
}
beforeEach(async () => {
	await cleanup();
	harness.userId = "batch-owner";
	harness.organizationId = "batch-org";
	harness.objects.clear();
	harness.failDelete = false;
	harness.failStore = false;
	harness.beforeStore = null;
	await admin.query(
		"insert into organization(id,name,slug,created_at) values ('batch-org','Photos','batch-org',now()),('batch-other','Other','batch-other',now())",
	);
	for (const [id, role] of [
		["batch-owner", "owner"],
		["batch-admin", "admin"],
		["batch-member", "member"],
		["batch-manager", "member"],
		["batch-employee-admin", "member"],
	]) {
		await admin.query(
			"insert into \"user\"(id,name,email,created_at,updated_at) values($1,$1,$1 || '@example.test',now(),now())",
			[id],
		);
		await admin.query(
			"insert into member(id,organization_id,user_id,role,status,created_at) values($1,'batch-org',$1,$2,'approved',now())",
			[id, role],
		);
	}
	await admin.query(
		"insert into employee(user_id,organization_id,role,updated_at) values('batch-manager','batch-org','manager',now()),('batch-employee-admin','batch-org','admin',now())",
	);
	const result = await changeVehicles({
		kind: "create",
		name: "Batch van",
		licencePlate: "BATCH 1271",
		drivers: { employeeIds: [], teamIds: [] },
	});
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	vehicleId = result.data.vehicles[0].id;
});
afterAll(cleanup);
describe("vehicle photo batch reconciliation", () => {
	it("recovers a completed identity without another body and never duplicates its attachment audit", async () => {
		const id = await start();
		expect((await upload(id, await image())).status).toBe(200);
		const recovered = await reconcileVehiclePhotoUpload(vehicleId, id);
		expect(recovered).toMatchObject({
			success: true,
			data: { ok: true, photo: { id } },
		});
		expect(await reconcileVehiclePhotoUpload(vehicleId, id)).toEqual(recovered);
		expect((await gallery()).photos).toHaveLength(1);
		expect(
			(
				await admin.query(
					"select id from audit_log where entity_id=$1 and action='vehicle.photo_added'",
					[vehicleId],
				)
			).rowCount,
		).toBe(1);
	});
	it("keeps the selection order across out-of-order completions and a temporary failure", async () => {
		const first = await start();
		const second = await start();
		const third = await start();
		const bytes = await image();
		expect((await upload(second, bytes)).status).toBe(200);
		harness.failStore = true;
		expect((await upload(first, bytes)).status).toBe(503);
		expect((await read(first)).status).toBe(404);
		harness.failStore = false;
		expect((await upload(third, bytes)).status).toBe(200);
		expect((await gallery()).photos.map((photo) => photo.id)).toEqual([
			second,
			third,
		]);
		expect(await reconcileVehiclePhotoUpload(vehicleId, first)).toMatchObject({
			success: true,
			data: { ok: true, photo: null },
		});
		expect((await upload(first, bytes)).status).toBe(200);
		expect((await gallery()).photos.map((photo) => photo.id)).toEqual([
			first,
			second,
			third,
		]);
		expect((await upload(first, new Uint8Array())).status).toBe(200);
		expect(
			(
				await admin.query(
					"select id from audit_log where entity_id=$1 and action='vehicle.photo_added'",
					[vehicleId],
				)
			).rowCount,
		).toBe(3);
	});
	it("keeps completed photos when three pending uploads contend for the last available slot", async () => {
		const bytes = await image();
		for (let index = 0; index < 19; index++)
			expect((await upload(await start(), bytes)).status).toBe(200);
		expect(
			await initiateVehiclePhotoBatchUpload(vehicleId, [
				"12710000-0000-4000-8000-000000000005",
				"12710000-0000-4000-8000-000000000006",
			]),
		).toMatchObject({
			success: true,
			data: { ok: false, reason: "photo_limit", remaining: 1 },
		});
		expect(
			(
				await admin.query(
					"select id from organization_vehicle_photo_upload where organization_id='batch-org'",
				)
			).rowCount,
		).toBe(19);
		const ids = [await start(), await start(), await start()];
		const outcomes = await Promise.all(ids.map((id) => upload(id, bytes)));
		expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
			200, 409, 409,
		]);
		expect(
			await Promise.all(
				outcomes
					.filter((outcome) => outcome.status === 409)
					.map((outcome) => outcome.json()),
			),
		).toEqual([
			expect.objectContaining({ reason: "photo_limit" }),
			expect.objectContaining({ reason: "photo_limit" }),
		]);
		expect((await gallery()).photos).toHaveLength(20);
		expect(
			(
				await admin.query(
					"select id from audit_log where entity_id=$1 and action='vehicle.photo_added'",
					[vehicleId],
				)
			).rowCount,
		).toBe(20);
	});
	it("denies retry reconciliation after role loss and across organizations, vehicles or upload owners", async () => {
		const id = await start();
		expect((await upload(id, await image())).status).toBe(200);
		harness.userId = "batch-admin";
		expect(await reconcileVehiclePhotoUpload(vehicleId, id)).toMatchObject({
			success: true,
			data: { ok: false, reason: "upload_not_found" },
		});
		harness.userId = "batch-member";
		expect(await reconcileVehiclePhotoUpload(vehicleId, id)).toMatchObject({
			success: false,
		});
		harness.userId = "batch-owner";
		harness.organizationId = "batch-other";
		await admin.query(
			"insert into member(id,organization_id,user_id,role,status,created_at) values('batch-other-owner','batch-other','batch-owner','owner','approved',now())",
		);
		expect(await reconcileVehiclePhotoUpload(vehicleId, id)).toMatchObject({
			success: true,
			data: { ok: false, reason: "upload_not_found" },
		});
		harness.organizationId = "batch-org";
		expect(
			await reconcileVehiclePhotoUpload(
				"00000000-0000-4000-8000-000000000001",
				id,
			),
		).toMatchObject({
			success: true,
			data: { ok: false, reason: "upload_not_found" },
		});
		await admin.query(
			"update member set role='owner' where organization_id='batch-org' and user_id='batch-admin'",
		);
		await admin.query(
			"update member set role='member' where organization_id='batch-org' and user_id='batch-owner'",
		);
		expect(await reconcileVehiclePhotoUpload(vehicleId, id)).toMatchObject({
			success: false,
		});
	});
	it("reports archived and deleted vehicles during retry while preserving a completed photo", async () => {
		const saved = await start();
		const pending = await start();
		expect((await upload(saved, await image())).status).toBe(200);
		await changeVehicles({ kind: "archive", vehicleId });
		expect(await reconcileVehiclePhotoUpload(vehicleId, pending)).toMatchObject(
			{ success: true, data: { ok: false, reason: "vehicle_archived" } },
		);
		expect(await reconcileVehiclePhotoUpload(vehicleId, saved)).toMatchObject({
			success: true,
			data: { ok: true, photo: { id: saved } },
		});
		await changeVehicles({ kind: "restore", vehicleId });
		await changeVehicles({ kind: "delete", vehicleId });
		expect(await reconcileVehiclePhotoUpload(vehicleId, pending)).toMatchObject(
			{ success: true, data: { ok: false, reason: "vehicle_not_found" } },
		);
	});
	it("cleans failed and abandoned batch entries durably while keeping completed photos accessible", async () => {
		const saved = await start();
		const rejected = await start();
		const abandoned = await start();
		expect((await upload(saved, await image())).status).toBe(200);
		expect((await upload(rejected, new Uint8Array([1, 2, 3]))).status).toBe(
			400,
		);
		harness.failStore = true;
		expect((await upload(abandoned, await image())).status).toBe(503);
		harness.failStore = false;
		await admin.query(
			"update organization_vehicle_photo_upload set next_attempt_at=now()-interval '1 second' where id=$1",
			[abandoned],
		);
		await runVehiclePhotoCleanupJob();
		expect(
			await reconcileVehiclePhotoUpload(vehicleId, abandoned),
		).toMatchObject({
			success: true,
			data: { ok: false, reason: "upload_expired" },
		});
		expect((await read(rejected)).status).toBe(404);
		expect((await read(abandoned)).status).toBe(404);
		expect((await read(saved)).status).toBe(200);
		expect((await gallery()).photos.map((photo) => photo.id)).toEqual([saved]);
		expect(
			(
				await admin.query(
					"select status from organization_vehicle_photo_upload where id=any($1::uuid[]) order by id",
					[[rejected, abandoned]],
				)
			).rows,
		).toEqual([{ status: "cleaned" }, { status: "cleaned" }]);
	});
	it("reserves a selection atomically and recovers the same identities and order after a lost initiation response", async () => {
		const ids = [
			"12710000-0000-4000-8000-000000000001",
			"12710000-0000-4000-8000-000000000002",
		];
		expect(await initiateVehiclePhotoBatchUpload(vehicleId, ids)).toMatchObject(
			{ success: true, data: { ok: true, uploadIds: ids } },
		);
		expect(await initiateVehiclePhotoBatchUpload(vehicleId, ids)).toMatchObject(
			{ success: true, data: { ok: true, uploadIds: ids } },
		);
		expect((await upload(ids[1], await image())).status).toBe(200);
		expect((await upload(ids[0], await image())).status).toBe(200);
		expect((await gallery()).photos.map((photo) => photo.id)).toEqual(ids);
		expect(
			(
				await admin.query(
					"select id from organization_vehicle_photo_upload where organization_id='batch-org'",
				)
			).rowCount,
		).toBe(2);
	});
	it("rejects unrelated or cross-organization upload identities atomically", async () => {
		const existing = await start();
		const fresh = "12710000-0000-4000-8000-000000000003";
		harness.userId = "batch-admin";
		expect(
			await initiateVehiclePhotoBatchUpload(vehicleId, [existing]),
		).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
		expect(
			await initiateVehiclePhotoBatchUpload(vehicleId, [existing, fresh]),
		).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
		harness.userId = "batch-owner";
		harness.organizationId = "batch-other";
		await admin.query(
			"insert into member(id,organization_id,user_id,role,status,created_at) values('batch-cross-owner','batch-other','batch-owner','owner','approved',now())",
		);
		const created = await changeVehicles({
			kind: "create",
			name: "Other organization van",
			licencePlate: "BATCH 2",
			drivers: { employeeIds: [], teamIds: [] },
		});
		if (!created.success || !created.data.ok)
			throw new Error("Vehicle creation failed");
		expect(
			await initiateVehiclePhotoBatchUpload(created.data.vehicles[0].id, [
				fresh,
				existing,
			]),
		).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
		expect(
			(
				await admin.query(
					"select id from organization_vehicle_photo_upload where organization_id='batch-other'",
				)
			).rowCount,
		).toBe(0);
		expect(
			(
				await admin.query(
					"select id from organization_vehicle_photo_upload where organization_id='batch-org'",
				)
			).rows,
		).toEqual([{ id: existing }]);
	});
	it("refuses invalid selection identities before creating any intent", async () => {
		const id = "12710000-0000-4000-8000-000000000004";
		expect(await initiateVehiclePhotoBatchUpload(vehicleId, [])).toMatchObject({
			success: false,
			code: "ValidationError",
		});
		expect(
			await initiateVehiclePhotoBatchUpload(vehicleId, [id, id]),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(
			await initiateVehiclePhotoBatchUpload(vehicleId, ["invalid"]),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(
			(
				await admin.query(
					"select id from organization_vehicle_photo_upload where organization_id='batch-org'",
				)
			).rowCount,
		).toBe(0);
	});
});
