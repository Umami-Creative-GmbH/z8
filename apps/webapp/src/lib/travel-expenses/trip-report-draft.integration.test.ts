import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t601-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	deleted: [] as string[],
}));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
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
vi.mock("@/env", async (original) => ({
	env: {
		...(await original<typeof import("@/env")>()).env,
		TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES: "1024",
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t601-public",
	s3Client: {
		async send(command: { input: { Key: string } }) {
			if (command.constructor.name === "DeleteObjectCommand") {
				harness.tus.delete(command.input.Key);
				return {};
			}
			const bytes = harness.tus.get(command.input.Key);
			if (!bytes) throw new Error("NoSuchKey");
			return {
				ContentLength: bytes.length,
				Body: { transformToByteArray: async () => new Uint8Array(bytes) },
			};
		},
	},
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject(_organizationId: string, key: string, data: Buffer) {
		harness.objects.set(key, Buffer.from(data));
		return { bucket: "t601-private", versionId: null };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
		harness.deleted.push(input.key);
		harness.objects.delete(input.key);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		harness.deleted.push(input.key);
		harness.objects.delete(input.key);
	},
}));

const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { db } = await import("@/db");
const { addTripReportItem, saveTripDetailsDraft } = await import("./report-store");
const { finalizeReportReceiptUpload, stageReportReceiptUpload } = await import(
	"./report-receipt-upload"
);
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e6010000-0000-4000-8000-000000000001",
	colleague: "e6010000-0000-4000-8000-000000000002",
	foreigner: "e6010000-0000-4000-8000-000000000003",
};
const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% train ticket\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t601-org', 't601-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't601-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t601-%"]);
}

async function seed() {
	await cleanup();
	// The organization's zone is the requester's effective zone (no personal setting).
	await admin.query(
		"insert into organization (id, name, slug, timezone, created_at) values ('t601-org','Expenses','t601-org','America/New_York',now()), ('t601-foreign','Foreign','t601-foreign','UTC',now())",
	);
	for (const [name, employeeId, organizationId] of [
		["requester", ids.requester, "t601-org"],
		["colleague", ids.colleague, "t601-org"],
		["foreigner", ids.foreigner, "t601-foreign"],
	]) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t601-${name}`, name, `t601-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'member','approved',now())",
			[`t601-member-${name}`, organizationId, `t601-${name}`],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,'employee',now())",
			[employeeId, `t601-${name}`, organizationId],
		);
	}
}

function signIn(name: "requester" | "colleague" | "foreigner") {
	harness.userId = `t601-${name}`;
	harness.organizationId = name === "foreigner" ? "t601-foreign" : "t601-org";
}

const requesterOwner = {
	organizationId: "t601-org",
	employeeId: ids.requester,
	userId: "t601-requester",
};

async function load(reportId: string) {
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function createTrip() {
	signIn("requester");
	const created = await actions.createTripReportAction();
	if (!created.success) throw new Error(created.error);
	return load(created.data.reportId);
}

async function addItem(reportId: string) {
	const added = await actions.addTripReportItemAction({ reportId });
	if (!added.success) throw new Error(added.error);
	return added.data.item;
}

const tripValues = {
	purpose: "Customer workshop",
	startDate: "2026-09-14",
	endDate: "2026-09-16",
	timeZone: "Europe/Berlin",
	destinations: [
		{ place: "Hamburg", countryCode: "DE" },
		{ place: "Vienna", countryCode: "AT" },
	],
};

function receiptValues(overrides: Record<string, string | null> = {}) {
	return {
		expenseDate: "2026-09-14",
		category: "transport",
		description: "Train to Hamburg",
		amount: "89.90",
		currency: "EUR",
		paidBy: "employee",
		accountingReference: null,
		...overrides,
	};
}

async function upload(reportId: string, itemId: string) {
	const tusFileKey = createOwnedTusFileKey("t601-requester");
	harness.tus.set(tusFileKey, pdfBytes);
	return processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId, fileName: "ticket.pdf" }),
		}) as unknown as NextRequest,
	);
}

describe("trip report drafts (#601)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.deleted.length = 0;
	});
	afterAll(cleanup);

	it("creates a trip in the employee's zone and resumes shared details and several items", async () => {
		const trip = await createTrip();
		expect(trip).toMatchObject({
			kind: "trip",
			status: "draft",
			items: [],
			trip: {
				version: 1,
				purpose: null,
				startDate: null,
				endDate: null,
				timeZone: "America/New_York",
				destinations: [],
			},
		});

		const saved = await actions.saveTripDetailsDraftAction({
			reportId: trip.id,
			expectedVersion: 1,
			values: tripValues,
		});
		expect(saved).toMatchObject({
			success: true,
			data: { status: "saved", details: { version: 2, timeZone: "Europe/Berlin" } },
		});

		const train = await addItem(trip.id);
		const hotel = await addItem(trip.id);
		const lunch = await addItem(trip.id);
		for (const [item, values] of [
			[train, receiptValues()],
			[
				hotel,
				receiptValues({
					expenseDate: "2026-09-15",
					category: "accommodation",
					description: "Hotel Hamburg",
					amount: "240.00",
					paidBy: "company",
				}),
			],
			[
				lunch,
				receiptValues({
					expenseDate: "2026-09-16",
					category: "meals",
					description: "Lunch Vienna",
					amount: "12.10",
				}),
			],
		] as const) {
			const result = await actions.saveReceiptItemDraftAction({
				reportId: trip.id,
				itemId: item.id,
				expectedVersion: item.version,
				values,
			});
			expect(result).toMatchObject({ success: true, data: { status: "saved" } });
		}

		const reloaded = await load(trip.id);
		expect(reloaded.trip).toEqual({ version: 2, ...tripValues });
		expect(
			reloaded.items.map((item) => [item.id, item.expenseDate, item.paidBy, item.amount]),
		).toEqual([
			[train.id, "2026-09-14", "employee", "89.90"],
			[hotel.id, "2026-09-15", "company", "240.00"],
			[lunch.id, "2026-09-16", "employee", "12.10"],
		]);

		const drafts = await actions.getMyDraftTravelExpenseReports();
		expect(drafts).toMatchObject({
			success: true,
			data: [
				{
					id: trip.id,
					kind: "trip",
					trip: {
						purpose: "Customer workshop",
						startDate: "2026-09-14",
						endDate: "2026-09-16",
						itemCount: 3,
						reimbursable: "102.00",
						currency: "EUR",
					},
				},
			],
		});
	});

	it("keeps incomplete details, rejects malformed ones and refuses stale saves", async () => {
		const trip = await createTrip();
		const partial = await actions.saveTripDetailsDraftAction({
			reportId: trip.id,
			expectedVersion: 1,
			values: { ...tripValues, endDate: null, destinations: [] },
		});
		expect(partial).toMatchObject({ success: true, data: { status: "saved" } });

		const malformed = await actions.saveTripDetailsDraftAction({
			reportId: trip.id,
			expectedVersion: 2,
			values: { ...tripValues, startDate: "2026-09-20", timeZone: "Mars/Olympus" },
		});
		expect(malformed).toEqual({
			success: true,
			data: {
				status: "invalid",
				errors: { endDate: "end_before_start", timeZone: "invalid_time_zone" },
			},
		});

		const stale = await actions.saveTripDetailsDraftAction({
			reportId: trip.id,
			expectedVersion: 1,
			values: { ...tripValues, purpose: "Stale tab" },
		});
		expect(stale).toMatchObject({
			success: true,
			data: {
				status: "conflict",
				details: { version: 2, purpose: "Customer workshop", endDate: null },
			},
		});
		expect((await load(trip.id)).trip).toMatchObject({ version: 2, purpose: "Customer workshop" });
	});

	it("serializes concurrent edits: one detail save wins and every added item gets its own place", async () => {
		const trip = await createTrip();
		const saves = await Promise.all(
			["First", "Second"].map((purpose) =>
				saveTripDetailsDraft(db, requesterOwner, {
					reportId: trip.id,
					expectedVersion: 1,
					details: { ...tripValues, purpose },
				}),
			),
		);
		expect(saves.map((result) => result.kind).sort()).toEqual(["conflict", "saved"]);

		const added = await Promise.all(
			Array.from({ length: 4 }, () => addTripReportItem(db, requesterOwner, { reportId: trip.id })),
		);
		expect(added.every((result) => result.kind === "added")).toBe(true);
		const { rows } = await admin.query(
			"select position from travel_expense_report_item where report_id = $1 order by position",
			[trip.id],
		);
		expect(rows.map((row) => row.position)).toEqual([0, 1, 2, 3]);
	});

	it("removes an item with its receipts, but not on top of a newer edit", async () => {
		const trip = await createTrip();
		const train = await addItem(trip.id);
		const hotel = await addItem(trip.id);
		expect((await upload(trip.id, train.id)).status).toBe(200);

		await actions.saveReceiptItemDraftAction({
			reportId: trip.id,
			itemId: hotel.id,
			expectedVersion: 1,
			values: receiptValues({ description: "Edited on phone" }),
		});
		const stale = await actions.removeTripReportItemAction({
			reportId: trip.id,
			itemId: hotel.id,
			expectedVersion: 1,
		});
		expect(stale).toMatchObject({
			success: true,
			data: { status: "conflict", item: { id: hotel.id, version: 2 } },
		});

		const removed = await actions.removeTripReportItemAction({
			reportId: trip.id,
			itemId: train.id,
			expectedVersion: 1,
		});
		expect(removed).toEqual({ success: true, data: { status: "removed", itemId: train.id } });
		// The receipt and its preview (#690).
		expect(harness.deleted).toEqual([
			expect.stringContaining(`/${train.id}/`),
			expect.stringContaining(`/${train.id}/`),
		]);
		expect((await load(trip.id)).items.map((item) => item.id)).toEqual([hotel.id]);
		const { rows } = await admin.query(
			"select (select count(*)::int from travel_expense_report_receipt where report_id = $1) as attached, (select count(*)::int from travel_expense_receipt_upload where organization_id = 't601-org') as staged",
			[trip.id],
		);
		expect(rows[0]).toEqual({ attached: 0, staged: 0 });

		expect(
			await actions.removeTripReportItemAction({
				reportId: trip.id,
				itemId: train.id,
				expectedVersion: 1,
			}),
		).toEqual({ success: false, error: "Expense not found" });
	});

	it("leaves an upload that finishes after its item was removed to cleanup", async () => {
		const trip = await createTrip();
		const item = await addItem(trip.id);
		const receiptId = crypto.randomUUID();
		const staged = {
			receiptId,
			organizationId: "t601-org",
			reportId: trip.id,
			itemId: item.id,
			uploadedBy: ids.requester,
			userId: "t601-requester",
			storageKey: `travel-expenses/t601-org/reports/${trip.id}/${item.id}/${receiptId}-a.pdf`,
		};
		await stageReportReceiptUpload(db, staged);
		await actions.removeTripReportItemAction({
			reportId: trip.id,
			itemId: item.id,
			expectedVersion: 1,
		});
		const result = await finalizeReportReceiptUpload(db, {
			...staged,
			stored: { bucket: "t601-private", versionId: null },
			fileName: "a.pdf",
			mimeType: "application/pdf",
			sizeBytes: 10,
			checksumSha256: "0".repeat(64),
		});
		expect(result).toEqual({ kind: "report_not_draft" });
		const { rows } = await admin.query(
			"select status, reason from travel_expense_receipt_upload where id = $1",
			[receiptId],
		);
		expect(rows[0]).toEqual({ status: "cleanup_required", reason: "report_not_draft" });
	});

	it("keeps standalone receipts free of trip details and limited to their one expense", async () => {
		signIn("requester");
		const created = await actions.createStandaloneReceiptReportAction();
		if (!created.success) throw new Error(created.error);
		const standalone = await load(created.data.reportId);
		expect(standalone.trip).toBeNull();

		expect(
			await actions.saveTripDetailsDraftAction({
				reportId: standalone.id,
				expectedVersion: 1,
				values: tripValues,
			}),
		).toEqual({ success: false, error: "Expense report not found" });
		expect(await actions.addTripReportItemAction({ reportId: standalone.id })).toEqual({
			success: false,
			error: "Expense report not found",
		});
		expect(
			await actions.removeTripReportItemAction({
				reportId: standalone.id,
				itemId: standalone.items[0]!.id,
				expectedVersion: 1,
			}),
		).toEqual({ success: false, error: "Expense report not found" });
		await expect(
			admin.query("update travel_expense_report set trip_purpose = 'x' where id = $1", [
				standalone.id,
			]),
		).rejects.toThrow(/travel_expense_report_trip_details_check/);
	});

	it("scopes trip details and items to the owning employee", async () => {
		const trip = await createTrip();
		const item = await addItem(trip.id);
		for (const other of ["colleague", "foreigner"] as const) {
			signIn(other);
			expect(
				await actions.saveTripDetailsDraftAction({
					reportId: trip.id,
					expectedVersion: 1,
					values: tripValues,
				}),
			).toEqual({ success: false, error: "Expense report not found" });
			expect(await actions.addTripReportItemAction({ reportId: trip.id })).toEqual({
				success: false,
				error: "Expense report not found",
			});
			expect(
				await actions.removeTripReportItemAction({
					reportId: trip.id,
					itemId: item.id,
					expectedVersion: 1,
				}),
			).toEqual({ success: false, error: "Expense report not found" });
		}
		signIn("requester");
		expect(await load(trip.id)).toMatchObject({ trip: { version: 1 }, items: [{ id: item.id }] });
	});
});
