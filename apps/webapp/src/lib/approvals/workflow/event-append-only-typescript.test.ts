import { describe, expect, it } from "vitest";
import { analyzeApprovalWorkflowEventMutations } from "./event-append-only-typescript";

const FILE_NAME = "/repo/apps/webapp/src/lib/fixture.ts";
const WORKFLOW_FILE_NAME =
	"/repo/apps/webapp/src/lib/approvals/workflow/fixture.ts";

describe("analyzeApprovalWorkflowEventMutations", () => {
	it("rejects malformed source before returning a partial violation result", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
db.delete(approvalWorkflowEvent);
const unfinished = \`delete from approval_workflow_event`;
		let error: unknown;

		try {
			analyzeApprovalWorkflowEventMutations(source, FILE_NAME);
		} catch (caught) {
			error = caught;
		}

		expect(error).toMatchObject({
			message:
				`Approval workflow event mutation analysis parse error at ${FILE_NAME}:3:56 ` +
				"[TS1160] Unterminated template literal.",
		});
	});

	it("resolves a relative schema import from a Windows-style source file name", () => {
		const source = `import { approvalWorkflowEvent } from "../../../db/schema/approval-workflow";
import { db } from "../../../db";
db.delete(approvalWorkflowEvent);`;
		const fileName =
			"C:\\repo\\apps\\webapp\\src\\lib\\approvals\\workflow\\fixture.ts";

		expect(analyzeApprovalWorkflowEventMutations(source, fileName)).toEqual([
			{
				column: 1,
				fileName,
				kind: "drizzle_delete",
				line: 3,
			},
		]);
	});

	it("resolves a relative workflow ports receiver from a Windows-style source file name", () => {
		const source = `import type { ApprovalTransactionClient as Transaction } from "./ports";
declare const transaction: Transaction;
transaction.execute("update approval_workflow_event set version = 2");`;
		const fileName =
			"C:\\repo\\apps\\webapp\\src\\lib\\approvals\\workflow\\fixture.ts";

		expect(analyzeApprovalWorkflowEventMutations(source, fileName)).toEqual([
			{
				column: 1,
				fileName,
				kind: "raw_sql_update",
				line: 3,
			},
		]);
	});

	it.each([
		"(approvalWorkflowEvent)",
		"approvalWorkflowEvent as unknown",
		"<unknown>approvalWorkflowEvent",
		"approvalWorkflowEvent!",
		"approvalWorkflowEvent satisfies unknown",
	] as const)("unwraps a protected event table: %s", (table) => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";

db.update(${table});`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_update",
				line: 3,
			},
		]);
	});

	it("resolves sql destructured from a Drizzle namespace", () => {
		const source = `import * as drizzle from "drizzle-orm";
const { sql } = drizzle;
sql\`delete from approval_workflow_event\`;`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "raw_sql_delete",
				line: 3,
			},
		]);
	});

	it("resolves a direct declaration alias of the event table", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
const events = approvalWorkflowEvent;
db.delete(events);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 3,
			},
		]);
	});

	it("resolves transitive declaration aliases of the event table", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
const first = approvalWorkflowEvent;
const events = first;
db.update(events);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_update",
				line: 4,
			},
		]);
	});

	it("resolves a renamed default-valued destructuring declaration", () => {
		const source = `import * as schema from "@/db/schema";
import { db } from "@/db";
const { approvalWorkflowEvent: events = fallbackTable } = schema;
db.delete(events);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 4,
			},
		]);
	});

	it("resolves direct and transitive assignment aliases", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
let first;
let events;
first = approvalWorkflowEvent;
events = first;
db.update(events);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_update",
				line: 6,
			},
		]);
	});

	it("resolves every simple chained assignment without aliasing compound assignments", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
let first;
let second;
let compound = otherTable;
first = second = approvalWorkflowEvent;
compound += approvalWorkflowEvent;
db.delete(first);
db.update(second);
db.delete(compound);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 7,
			},
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_update",
				line: 8,
			},
		]);
	});

	it.each([
		"({ approvalWorkflowEvent: events = fallbackTable } = schema);",
		"({ approvalWorkflowEvent } = schema);",
	] as const)("resolves a destructuring assignment: %s", (assignment) => {
		const localName = assignment.includes(": events")
			? "events"
			: "approvalWorkflowEvent";
		const source = `import * as schema from "@/db/schema";
import { db } from "@/db";
let events;
let approvalWorkflowEvent;
${assignment}
db.delete(${localName});`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 6,
			},
		]);
	});

	it("uses the latest write strictly before each mutable alias use", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
let table = otherTable;
db.update(table);
table = approvalWorkflowEvent;
db.delete(table);
table = otherTable;
db.update(table);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 5,
			},
		]);
	});

	it.each([
		[
			"if else",
			`if (condition) table = approvalWorkflowEvent;
else table = otherTable;`,
		],
		["one-branch conditional", "if (condition) table = approvalWorkflowEvent;"],
		["loop", "for (const value of values) table = approvalWorkflowEvent;"],
		[
			"try catch",
			`try { table = approvalWorkflowEvent; }
catch { table = otherTable; }`,
		],
		[
			"switch",
			`switch (choice) {
	case "protected":
		table = approvalWorkflowEvent;
		break;
	default:
		table = otherTable;
}`,
		],
	] as const)("keeps a protected write from any %s path", (_name, branch) => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
let table = otherTable;
${branch}
db.delete(table);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: source.split("\n").length,
			},
		]);
	});

	it("lets an unconditional reassignment away clear conditional protection", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
let table = otherTable;
if (condition) table = approvalWorkflowEvent;
table = otherTable;
db.delete(table);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual(
			[],
		);
	});

	it.each([
		"condition && (table = otherTable);",
		"condition || (table = otherTable);",
		"condition ?? (table = otherTable);",
	] as const)("keeps protection across a short-circuit write: %s", (branch) => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
let table = approvalWorkflowEvent;
${branch}
db.delete(table);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 4,
			},
		]);
	});

	it("lets a finally overwrite clear protected provenance after its try statement", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
let table = approvalWorkflowEvent;
try {
} finally {
	table = otherTable;
}
db.delete(table);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual(
			[],
		);
	});

	it("keeps a try-only overwrite conditional after the try statement", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
let table = approvalWorkflowEvent;
try {
	table = otherTable;
} catch {
}
db.delete(table);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 7,
			},
		]);
	});

	it("requires known database provenance for Drizzle update and delete receivers", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
db.update(approvalWorkflowEvent);
const dbAlias = db;
dbAlias.delete(approvalWorkflowEvent);
formatter.update(approvalWorkflowEvent);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_update",
				line: 2,
			},
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 4,
			},
		]);
	});

	it("indexes typed destructured database parameters without trusting unrelated objects", () => {
		const source = `import type { ApprovalDbService } from "@/lib/approvals/server/types";
function mutate({ db: connection }: ApprovalDbService) {
	connection.execute("delete from approval_workflow_event");
}
function nested({ service: { db: nestedConnection } }: { service: ApprovalDbService }) {
	nestedConnection.execute("update approval_workflow_event set version = 2");
}
function unrelated({ db }: { db: { execute(sql: string): unknown } }) {
	db.execute("delete from approval_workflow_event");
}`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 2,
				fileName: FILE_NAME,
				kind: "raw_sql_delete",
				line: 3,
			},
			{
				column: 2,
				fileName: FILE_NAME,
				kind: "raw_sql_update",
				line: 6,
			},
		]);
	});

	it.each([
		[
			"database import",
			`import { db } from "@/db";
db.execute("delete from approval_workflow_event");`,
			"raw_sql_delete",
		],
		[
			"pg PoolClient type",
			`import type { PoolClient } from "pg";
declare const client: PoolClient;
client.query("update approval_workflow_event set version = 2");`,
			"raw_sql_update",
		],
		[
			"aliased pg Pool construction",
			`import * as pg from "pg";
const pool = new pg.Pool();
const client = pool;
client["query"]("delete from approval_workflow_event");`,
			"raw_sql_delete",
		],
		[
			"Drizzle NodePgDatabase type",
			`import type { NodePgDatabase } from "drizzle-orm/node-postgres";
declare const database: NodePgDatabase;
database.execute("update approval_workflow_event set version = 2");`,
			"raw_sql_update",
		],
		[
			"qualified Drizzle NodePgDatabase type",
			`import type * as nodePg from "drizzle-orm/node-postgres";
declare const database: nodePg.NodePgDatabase;
database.execute("delete from approval_workflow_event");`,
			"raw_sql_delete",
		],
		[
			"initialized Drizzle NodePgDatabase type",
			`import type { NodePgDatabase } from "drizzle-orm/node-postgres";
declare function createDatabase(): NodePgDatabase;
const database: NodePgDatabase = createDatabase();
database.execute("update approval_workflow_event set version = 2");`,
			"raw_sql_update",
		],
		[
			"ApprovalDbService db property",
			`import type { ApprovalDbService } from "@/lib/approvals/server/types";
declare const service: ApprovalDbService;
const serviceAlias = service;
serviceAlias.db.execute("delete from approval_workflow_event");`,
			"raw_sql_delete",
		],
		[
			"ApprovalDbService indexed db type",
			`import type { ApprovalDbService } from "@/lib/approvals/server/types";
declare const database: ApprovalDbService["db"];
database.execute("update approval_workflow_event set version = 2");`,
			"raw_sql_update",
		],
	] as const)("trusts a known %s receiver", (_name, source, kind) => {
		const result = analyzeApprovalWorkflowEventMutations(source, FILE_NAME);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ fileName: FILE_NAME, kind });
	});

	it.each([
		[
			"named alias construction",
			`import { Client as PgClient } from "pg";
const client = new PgClient();
client.query("delete from approval_workflow_event");`,
		],
		[
			"namespace construction",
			`import * as pg from "pg";
const client = new pg.Client();
client.query("delete from approval_workflow_event");`,
		],
		[
			"typed declaration",
			`import type { Client as PgClient } from "pg";
declare const client: PgClient;
client.query("delete from approval_workflow_event");`,
		],
		[
			"qualified typed declaration",
			`import type * as pg from "pg";
declare const client: pg.Client;
client.query("delete from approval_workflow_event");`,
		],
	] as const)("tracks a trusted pg Client receiver from %s", (_name, source) => {
		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "raw_sql_delete",
				line: 3,
			},
		]);
	});

	it("does not trust pg Client names from unrelated sources", () => {
		const source = `import { Client } from "unrelated-pg";
import * as pg from "unrelated-pg-namespace";
const importedClient = new Client();
const namespaceClient = new pg.Client();
importedClient.query("delete from approval_workflow_event");
namespaceClient.query("delete from approval_workflow_event");`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual(
			[],
		);
	});

	it.each([
		[
			"named alias factory",
			`import { drizzle as createDb } from "drizzle-orm/node-postgres";
import { approvalWorkflowEvent } from "@/db";
const database = createDb(client);
database.delete(approvalWorkflowEvent);`,
		],
		[
			"namespace factory",
			`import * as nodePg from "drizzle-orm/node-postgres";
import { approvalWorkflowEvent } from "@/db";
const database = nodePg.drizzle(client);
database.delete(approvalWorkflowEvent);`,
		],
	] as const)("tracks a locally constructed Drizzle receiver from a trusted %s", (_name, source) => {
		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 4,
			},
		]);
	});

	it("does not trust local or unrelated drizzle factories", () => {
		const source = `import { drizzle as importedDrizzle } from "unrelated-drizzle";
import * as unrelated from "unrelated-drizzle-namespace";
import { approvalWorkflowEvent } from "@/db";
function drizzle() { return formatter; }
const localDatabase = drizzle(client);
const importedDatabase = importedDrizzle(client);
const namespaceDatabase = unrelated.drizzle(client);
localDatabase.delete(approvalWorkflowEvent);
importedDatabase.delete(approvalWorkflowEvent);
namespaceDatabase.delete(approvalWorkflowEvent);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual(
			[],
		);
	});

	it.each([
		["relative", "./ports"],
		["alias", "@/lib/approvals/workflow/ports"],
	] as const)("recognizes aliased workflow DB types from an approved %s module", (_name, moduleName) => {
		const source = `import type {
	ApprovalDbService as WorkflowDbService,
	ApprovalTransactionClient as Transaction,
} from "${moduleName}";
declare const service: WorkflowDbService;
declare const transaction: Transaction;
service.db.execute("delete from approval_workflow_event");
transaction.execute("update approval_workflow_event set version = 2");`;

		expect(
			analyzeApprovalWorkflowEventMutations(source, WORKFLOW_FILE_NAME),
		).toEqual([
			{
				column: 1,
				fileName: WORKFLOW_FILE_NAME,
				kind: "raw_sql_delete",
				line: 7,
			},
			{
				column: 1,
				fileName: WORKFLOW_FILE_NAME,
				kind: "raw_sql_update",
				line: 8,
			},
		]);
	});

	it.each([
		"workflow-ports-lookalike",
		"@/lib/approvals/other/ports",
	] as const)("does not trust workflow DB type names from unrelated module %s", (moduleName) => {
		const source = `import type {
	ApprovalDbService,
	ApprovalTransactionClient,
} from "${moduleName}";
declare const service: ApprovalDbService;
declare const transaction: ApprovalTransactionClient;
service.db.execute("delete from approval_workflow_event");
transaction.execute("update approval_workflow_event set version = 2");`;

		expect(
			analyzeApprovalWorkflowEventMutations(source, WORKFLOW_FILE_NAME),
		).toEqual([]);
	});

	it("does not trust an unrelated query or execute receiver", () => {
		const source = `declare const runner: {
	query(sql: string): unknown;
	execute(sql: string): unknown;
};
runner.query("update approval_workflow_event set version = 2");
runner.execute("delete from approval_workflow_event");`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual(
			[],
		);
	});

	it("trusts db only on the @/db namespace, not a schema namespace", () => {
		const source = `import * as database from "@/db";
import * as schema from "@/db/schema";
database.db.execute("delete from approval_workflow_event");
schema.db.execute("update approval_workflow_event set version = 2");`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "raw_sql_delete",
				line: 3,
			},
		]);
	});

	it("evaluates constant and aliased substitutions in a Drizzle SQL tag", () => {
		const source = `import { sql } from "drizzle-orm";
const action = "up" + "date";
const tableName = "approval_workflow_event";
const target = tableName;
sql\`\${action} \${target} set version = 2\`;`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "raw_sql_update",
				line: 5,
			},
		]);
	});

	it("evaluates constant concatenated SQL passed through an alias", () => {
		const source = `import { db } from "@/db";
const target = "approval_workflow" + "_event";
const statement = "delete from " + target;
const aliasedStatement = statement;
db.execute(aliasedStatement);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "raw_sql_delete",
				line: 5,
			},
		]);
	});

	it.each([
		`import { sql } from "drizzle-orm";
declare const dynamicTable: string;
sql\`delete from \${dynamicTable}\`;`,
		`import { db } from "@/db";
declare const dynamicSql: string;
db.execute("update " + dynamicSql);`,
	] as const)("does not infer a mutation from dynamic SQL", (source) => {
		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual(
			[],
		);
	});

	it.each([
		[
			`import { sql } from "drizzle-orm";
const raw = sql["raw"];
const rawAlias = raw;
rawAlias("delete from approval_workflow_event");`,
			4,
		],
		[
			`import { sql } from "drizzle-orm";
let raw;
raw = sql.raw;
const rawAlias = raw;
rawAlias("delete from approval_workflow_event");`,
			5,
		],
	] as const)("resolves a direct or assigned sql.raw alias", (source, line) => {
		const result = analyzeApprovalWorkflowEventMutations(source, FILE_NAME);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ kind: "raw_sql_delete", line });
	});

	it("returns exact sorted and deduplicated violations for bracket calls", () => {
		const source = `import { sql } from "drizzle-orm";
import { approvalWorkflowEvent, db } from "@/db";
sql\`update approval_workflow_event set version = 2; delete from approval_workflow_event; delete from approval_workflow_event\`;
db["delete"](approvalWorkflowEvent);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "raw_sql_delete",
				line: 3,
			},
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "raw_sql_update",
				line: 3,
			},
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 4,
			},
		]);
	});

	it("honors nested and loop-local shadowing", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
function nested(approvalWorkflowEvent: unknown) {
	db.update(approvalWorkflowEvent);
}
for (const approvalWorkflowEvent of tables) db.delete(approvalWorkflowEvent);
db.delete(approvalWorkflowEvent);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 6,
			},
		]);
	});

	it("retains protection across a for-of assignment target", () => {
		const source = `import { approvalWorkflowEvent, db } from "@/db";
let events = approvalWorkflowEvent;
for (events of tables) {
	db.update(events);
}
db.delete(events);`;

		expect(analyzeApprovalWorkflowEventMutations(source, FILE_NAME)).toEqual([
			{
				column: 2,
				fileName: FILE_NAME,
				kind: "drizzle_update",
				line: 4,
			},
			{
				column: 1,
				fileName: FILE_NAME,
				kind: "drizzle_delete",
				line: 6,
			},
		]);
	});

	it("rethrows analysis limits as deterministic guard failures", () => {
		const source = [
			'import { db } from "@/db";',
			'const sql0 = "delete from approval_workflow_event";',
			...Array.from(
				{ length: 128 },
				(_, index) => `const sql${index + 1} = sql${index};`,
			),
			"db.execute(sql128);",
		].join("\n");
		let error: unknown;

		try {
			analyzeApprovalWorkflowEventMutations(source, FILE_NAME);
		} catch (caught) {
			error = caught;
		}

		expect(error).toMatchObject({
			cause: {
				code: "APPROVAL_WORKFLOW_EVENT_ANALYSIS_LIMIT",
				limit: "constant_evaluator_depth",
			},
			message:
				`Approval workflow event mutation analysis failed at ${FILE_NAME}:131:1: ` +
				"Approval workflow event analysis limit exceeded: constant_evaluator_depth",
		});
	});
});
