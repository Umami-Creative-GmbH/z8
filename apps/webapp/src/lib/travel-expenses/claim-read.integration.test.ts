import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t599-org",
	objects: new Map<string, Buffer>(),
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
		S3_PRIVATE_BUCKET: "t599-private",
		S3_PRIVATE_ACCESS_KEY_ID: "test-key",
		S3_PRIVATE_SECRET_ACCESS_KEY: "test-secret",
		S3_PRIVATE_REGION: "eu-central-1",
	},
}));
vi.mock("@aws-sdk/client-s3", async (original) => ({
	...(await original<typeof import("@aws-sdk/client-s3")>()),
	S3Client: class {
		async send(command: {
			input: { Bucket: string; Key: string; VersionId?: string };
		}) {
			const bytes = harness.objects.get(
				`${command.input.Bucket}/${command.input.Key}/${command.input.VersionId ?? "latest"}`,
			);
			if (!bytes) throw new Error("NoSuchKey");
			return {
				Body: { transformToByteArray: async () => new Uint8Array(bytes) },
			};
		}
	},
}));
const { GET: getDetail } = await import(
	"@/app/api/travel-expenses/[claimId]/route"
);
const { GET: getReceipt } = await import(
	"@/app/api/travel-expenses/[claimId]/receipts/[attachmentId]/route"
);
const ids = {
	claim: "e5990000-0000-4000-8000-000000000001",
	receipt: "e5990000-0000-4000-8000-000000000002",
	requester: "e5990000-0000-4000-8000-000000000003",
	reviewer: "e5990000-0000-4000-8000-000000000004",
	stranger: "e5990000-0000-4000-8000-000000000005",
	decision: "e5990000-0000-4000-8000-000000000006",
	request: "e5990000-0000-4000-8000-000000000007",
};
const admin = integrationAdminPool();
const receiptBytes = Buffer.from("%PDF-1.4 recorded hotel receipt");
async function cleanup() {
	await admin.query(
		"delete from organization where id in ('t599-org', 't599-foreign')",
	);
	await admin.query('delete from "user" where id like $1', ["t599-%"]);
}
async function seed() {
	await cleanup();
	await admin.query(
		"insert into organization (id, name, slug, created_at) values ('t599-org','Expenses','t599-org',now()), ('t599-foreign','Foreign','t599-foreign',now())",
	);
	for (const [name, employeeId, role] of [
		["requester", ids.requester, "employee"],
		["reviewer", ids.reviewer, "manager"],
		["stranger", ids.stranger, "employee"],
	]) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t599-${name}`, name, `t599-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,'t599-org',$2,'member','approved',now())",
			[`t599-member-${name}`, `t599-${name}`],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,'t599-org',$3,now())",
			[employeeId, `t599-${name}`, role],
		);
	}
	await admin.query(
		`insert into travel_expense_claim (id,organization_id,employee_id,approver_id,type,status,trip_start,trip_end,original_currency,original_amount,calculated_currency,calculated_amount,notes,created_by,updated_at)
 values ($1,'t599-org',$2,$3,'receipt','submitted','2026-03-28T23:00:00Z','2026-03-31T21:59:59Z','EUR','120.50','EUR','120.50','Original context','t599-requester',now())`,
		[ids.claim, ids.requester, ids.reviewer],
	);
	await admin.query(
		`insert into approval_request (id,organization_id,entity_type,entity_id,requested_by,approver_id,status,updated_at) values ($1,'t599-org','travel_expense_claim',$2,$3,$4,'pending',now())`,
		[ids.request, ids.claim, ids.requester, ids.reviewer],
	);
	await admin.query(
		`insert into travel_expense_attachment (id,claim_id,organization_id,storage_provider,storage_bucket,storage_key,storage_version_id,file_name,mime_type,size_bytes,checksum_sha256,uploaded_by)
 values ($1,$2,'t599-org','s3-private','t599-private','original/hotel.pdf','recorded-v1','hotel.pdf','application/pdf',$3,$4,$5)`,
		[
			ids.receipt,
			ids.claim,
			receiptBytes.length,
			createHash("sha256").update(receiptBytes).digest("hex"),
			ids.requester,
		],
	);
	await admin.query(
		`insert into travel_expense_decision_log (id,claim_id,organization_id,actor_employee_id,approver_id,action,comment,created_at) values ($1,$2,'t599-org',$3,$3,'approved','Original approval note','2026-04-01T10:00:00Z')`,
		[ids.decision, ids.claim, ids.reviewer],
	);
	await admin.query(
		`insert into "user" (id,name,email,created_at,updated_at) values ('t599-foreign-user','Foreign reviewer','t599-foreign@example.test',now(),now())`,
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ('t599-foreign-member','t599-foreign','t599-foreign-user','member','approved',now())",
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,updated_at) values ('e5990000-0000-4000-8000-000000000008','t599-foreign-user','t599-foreign','manager',now())",
	);
	harness.userId = "t599-requester";
	harness.organizationId = "t599-org";
	harness.objects.clear();
	harness.objects.set(
		"t599-private/original/hotel.pdf/recorded-v1",
		receiptBytes,
	);
	harness.objects.set(
		"t599-private/original/hotel.pdf/latest",
		Buffer.from("replacement object"),
	);
}
const detail = () =>
	getDetail(
		new Request("http://localhost/api/travel-expenses/claim") as NextRequest,
		{ params: Promise.resolve({ claimId: ids.claim }) },
	);
const receipt = (attachmentId = ids.receipt, download = false) =>
	getReceipt(
		new Request(
			`http://localhost/api/travel-expenses/claim/receipts/receipt${download ? "?download=1" : ""}`,
		) as NextRequest,
		{ params: Promise.resolve({ claimId: ids.claim, attachmentId }) },
	);
describe("legacy travel claim reads", () => {
	beforeEach(seed);
	afterAll(cleanup);
	it("lets the owner read the original claim, receipt identity and decision history without guessing dates", async () => {
		const response = await detail();
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			claim: {
				id: ids.claim,
				tripStartDate: null,
				tripEndDate: null,
				approverId: ids.reviewer,
				status: "submitted",
			},
			attachments: [{ id: ids.receipt, fileName: "hotel.pdf" }],
			decisions: [
				{
					id: ids.decision,
					comment: "Original approval note",
					createdAt: "2026-04-01T10:00:00.000Z",
				},
			],
		});
	});
	it("previews and downloads the recorded receipt version rather than the replacement at the same key", async () => {
		const preview = await receipt();
		expect(preview.status).toBe(200);
		expect(Buffer.from(await preview.arrayBuffer())).toEqual(receiptBytes);
		expect(preview.headers.get("content-type")).toBe("application/pdf");
		const download = await receipt(ids.receipt, true);
		expect(download.status).toBe(200);
		expect(Buffer.from(await download.arrayBuffer())).toEqual(receiptBytes);
		expect(download.headers.get("content-disposition")).toContain(
			"attachment;",
		);
	});
	it("allows the existing assigned reviewer to read the same claim and receipt without changing pending decisions", async () => {
		harness.userId = "t599-reviewer";
		expect((await detail()).status).toBe(200);
		const response = await receipt();
		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(receiptBytes);
		expect(await (await detail()).json()).toMatchObject({
			claim: {
				id: ids.claim,
				status: "submitted",
				approverId: ids.reviewer,
				approvalWorkflowId: null,
			},
		});
	});
	it("rejects unassigned employees and foreign-organization reviewers", async () => {
		harness.userId = "t599-stranger";
		expect((await detail()).status).toBe(404);
		expect((await receipt()).status).toBe(404);
		harness.userId = "t599-foreign-user";
		harness.organizationId = "t599-foreign";
		expect((await detail()).status).toBe(404);
		expect((await receipt()).status).toBe(404);
	});
	it("rejects a foreign-organization attachment even when it names an accessible claim", async () => {
		await admin.query(
			"update travel_expense_attachment set organization_id='t599-foreign' where id=$1",
			[ids.receipt],
		);
		expect((await receipt()).status).toBe(404);
		expect(await (await detail()).json()).toMatchObject({ attachments: [] });
	});
	it("refuses altered receipt content and a changed recorded bucket", async () => {
		harness.objects.set(
			"t599-private/original/hotel.pdf/recorded-v1",
			Buffer.alloc(receiptBytes.length, 65),
		);
		expect((await receipt()).status).toBe(503);
		harness.objects.set(
			"t599-private/original/hotel.pdf/recorded-v1",
			receiptBytes,
		);
		await admin.query(
			"update travel_expense_attachment set storage_bucket='different-private' where id=$1",
			[ids.receipt],
		);
		expect((await receipt()).status).toBe(503);
	});
	it("keeps a historical receipt with no checksum/version readable without backfilling identity", async () => {
		await admin.query(
			"update travel_expense_attachment set checksum_sha256=null, storage_version_id=null where id=$1",
			[ids.receipt],
		);
		harness.objects.set("t599-private/original/hotel.pdf/latest", receiptBytes);
		expect(Buffer.from(await (await receipt()).arrayBuffer())).toEqual(
			receiptBytes,
		);
		expect(await (await detail()).json()).toMatchObject({
			attachments: [
				{ id: ids.receipt, checksumSha256: null, storageVersionId: null },
			],
		});
	});
	it("requires authentication and rejects malformed identifiers", async () => {
		harness.userId = null;
		expect((await detail()).status).toBe(401);
		expect((await receipt()).status).toBe(401);
		harness.userId = "t599-requester";
		const response = await getDetail(
			new Request("http://localhost/api/travel-expenses/bad") as NextRequest,
			{ params: Promise.resolve({ claimId: "bad" }) },
		);
		expect(response.status).toBe(404);
	});
});
