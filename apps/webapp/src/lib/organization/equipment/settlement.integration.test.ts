import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import {
	outstandingQuantity,
	outstandingSql,
	type ReturnSettlement,
	settle,
	settlementColumns,
} from "./settlement";
import { REFUSED_CASES, SETTLED_CASES } from "./settlement.test-fixture";

const { db } = await import("@/db");
const pool = integrationAdminPool();
const ORG = "t1591-org";
const TYPE = "15910000-0000-4000-8000-000000000001";
const id = (n: number) => `15910000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;

async function cleanup() {
	await pool.query("delete from organization where id = $1", [ORG]);
}
beforeEach(async () => {
	await cleanup();
	await pool.query(
		"insert into organization(id,name,slug,timezone,equipment_enabled,created_at) values($1,$1,$1,'Europe/Berlin',true,now())",
		[ORG],
	);
	await pool.query(
		"insert into equipment_type(id,organization_id,name,tracking_mode,default_return_required) values($1,$2,'Shirts','quantity',true)",
		[TYPE, ORG],
	);
});
afterAll(cleanup);

function insert(n: number, s: ReturnSettlement) {
	const c = settlementColumns(s);
	return pool.query(
		"insert into equipment_assignment(id,organization_id,type_id,quantity,return_required,received_quantity,lost_quantity,waived_quantity,exception_received_quantity,received) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
		[
			id(n),
			ORG,
			TYPE,
			s.quantity,
			s.returnRequired,
			c.receivedQuantity,
			c.lostQuantity,
			c.waivedQuantity,
			c.exceptionReceivedQuantity,
			c.received,
		],
	);
}

it("computes the same outstanding return in SQL as settle() does", async () => {
	const expected = new Map<string, number>();
	for (const [n, { terms, receipts, exceptions }] of SETTLED_CASES.entries()) {
		const result = settle(terms, receipts, exceptions);
		if (!result.ok) throw new Error(result.reason);
		await insert(n, result.settlement);
		expected.set(id(n), outstandingQuantity(result.settlement));
	}
	const rows = await db.execute<{ id: string; outstanding: number }>(sql`
		SELECT a.id, ${outstandingSql("a")}::integer AS outstanding
		FROM equipment_assignment a WHERE a.organization_id = ${ORG}
	`);
	expect(new Map(rows.rows.map((r) => [r.id, r.outstanding]))).toEqual(expected);
});

it.each(REFUSED_CASES)(
	"rejects invalid stored assignment totals: $name",
	async ({ terms, counts }) => {
		await expect(insert(0, { ...terms, ...counts })).rejects.toThrow(
			/equipment_assignment_(settlement|received_quantity)_check/,
		);
	},
);

it("lets the database refuse a received flag that disagrees with the receipts", async () => {
	await expect(
		pool.query(
			"insert into equipment_assignment(id,organization_id,type_id,quantity,return_required,received_quantity,received) values($1,$2,$3,2,true,2,false)",
			[id(0), ORG, TYPE],
		),
	).rejects.toThrow(/equipment_assignment_received_check/);
});
