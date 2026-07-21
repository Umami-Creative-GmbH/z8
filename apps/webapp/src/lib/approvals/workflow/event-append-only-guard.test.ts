import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type ApprovalWorkflowEventMutationViolation,
	findApprovalWorkflowEventMutationViolations as analyzeFixtureViolations,
	scanProductionApprovalWorkflowEventMutations,
} from "./event-append-only-guard";

function findApprovalWorkflowEventMutationViolations(
	source: string,
	fileName: string,
): ApprovalWorkflowEventMutationViolation[] {
	return analyzeFixtureViolations(
		`${source}\nimport { db } from "@/db";`,
		fileName,
	);
}

function expectSingleViolation(
	source: string,
	kind: ApprovalWorkflowEventMutationViolation["kind"],
	line: number,
): void {
	expect(
		findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
	).toEqual([
		{
			column: expect.any(Number),
			fileName: "fixture.ts",
			kind,
			line,
		},
	]);
}

describe("approval workflow event append-only source guard", () => {
	it.each([
		[
			"direct named import",
			`import { approvalWorkflowEvent } from "@/db";
db.update(approvalWorkflowEvent).set({ version: 2 });`,
			"drizzle_update",
			2,
		],
		[
			"renamed import alias",
			`import { approvalWorkflowEvent as eventTable } from "@/db";
db.delete(eventTable);`,
			"drizzle_delete",
			2,
		],
		[
			"namespace property",
			`import * as schema from "@/db";
db.update(schema.approvalWorkflowEvent);`,
			"drizzle_update",
			2,
		],
		[
			"variable alias of namespace property",
			`import * as schema from "@/db";
const durableEvents = schema.approvalWorkflowEvent;
db.delete(durableEvents);`,
			"drizzle_delete",
			3,
		],
		[
			"quoted schema-qualified raw update with comments",
			`import { sql } from "drizzle-orm";
const statement = sql\`UPDATE /* lock */ public."approval_workflow_event" SET version = 2\`;`,
			"raw_sql_update",
			2,
		],
		[
			"quoted schema-qualified raw delete",
			`import { sql } from "drizzle-orm";
const statement = sql\`DELETE\nFROM "audit"."approval_workflow_event" WHERE id = \${id}\`;`,
			"raw_sql_delete",
			2,
		],
		[
			"unquoted schema-qualified raw delete",
			`import { sql } from "drizzle-orm";
const statement = sql.raw("DELETE FROM audit.approval_workflow_event WHERE id = $1");`,
			"raw_sql_delete",
			2,
		],
	] as const)("detects %s", (_name, source, kind, line) => {
		expectSingleViolation(source, kind, line);
	});

	it("detects a parenthesized wrapped event table", () => {
		const source = `import { approvalWorkflowEvent } from "@/db";
db.update((approvalWorkflowEvent));`;

		expectSingleViolation(source, "drizzle_update", 2);
	});

	it("detects an as-expression wrapped event table", () => {
		const source = `import { approvalWorkflowEvent } from "@/db";
db.update(approvalWorkflowEvent as any);`;

		expectSingleViolation(source, "drizzle_update", 2);
	});

	it("detects a non-null wrapped event table", () => {
		const source = `import { approvalWorkflowEvent } from "@/db";
db.update(approvalWorkflowEvent!);`;

		expectSingleViolation(source, "drizzle_update", 2);
	});

	it("detects a satisfies-expression wrapped event table", () => {
		const source = `import { approvalWorkflowEvent } from "@/db";
db.update(approvalWorkflowEvent satisfies unknown);`;

		expectSingleViolation(source, "drizzle_update", 2);
	});

	it("detects a sql tag destructured from a Drizzle namespace", () => {
		const source = `import * as drizzle from "drizzle-orm";
const { sql } = drizzle;
sql\`delete from approval_workflow_event\`;`;

		expectSingleViolation(source, "raw_sql_delete", 3);
	});

	it("detects a renamed Drizzle sql tagged template", () => {
		const source = `import { sql as statement } from "drizzle-orm";
const query = statement\`update approval_workflow_event set version = 2\`;`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects an event table interpolated into a SQL mutation", () => {
		const source = `import { sql } from "drizzle-orm";
import { approvalWorkflowEvent } from "@/db";
const query = sql\`delete from \${approvalWorkflowEvent} where id = \${id}\`;`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it.each([
		[
			`import * as schema from "./schema";
db.delete(schema.approvalWorkflowEvent);`,
			join(process.cwd(), "src", "db", "index.ts"),
		],
		[
			`import { approvalWorkflowEvent as events } from "../db/schema";
db.update(events);`,
			join(process.cwd(), "src", "lib", "feature.ts"),
		],
	] as const)("preserves actual relative schema imports", (source, fileName) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, fileName),
		).toHaveLength(1);
	});

	it.each([
		`import { sql } from "drizzle-orm";
sql\`UPDATE ONLY approval_workflow_event SET version = 2\`;`,
		`import { sql } from "drizzle-orm";
sql\`DELETE /* mutation */ FROM
ONLY public."approval_workflow_event" WHERE id = \${id}\`;`,
	] as const)("detects PostgreSQL ONLY event-table mutations", (source) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects a destructured event-table alias", () => {
		const source = `import * as schema from "@/db";
const { approvalWorkflowEvent: events } = schema;
db.update(events).set({ version: 2 });`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects an event-table assignment alias", () => {
		const source = `import { approvalWorkflowEvent } from "@/db";
let events;
events = approvalWorkflowEvent;
db.delete(events);`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it.each([
		`import * as schema from "@/db";
let events;
({ approvalWorkflowEvent: events } = schema);
db.delete(events);`,
		`import * as schema from "@/db/schema";
const schemaAlias = schema;
let firstEvent;
let events;
({ "approvalWorkflowEvent": firstEvent } = schemaAlias);
events = firstEvent;
db.update(events);`,
	] as const)("detects destructuring-assignment event aliases", (source) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it.each([
		`import * as schema from "@/db";
let approvalWorkflowEvent;
({ approvalWorkflowEvent } = schema);
db.delete(approvalWorkflowEvent);`,
		`import * as schema from "@/db/schema";
let events;
({ approvalWorkflowEvent: events = fallbackTable } = schema);
db.update(events);`,
		`import * as schema from "@/db/schema";
let approvalWorkflowEvent;
({ approvalWorkflowEvent = fallbackTable } = schema);
db.delete(approvalWorkflowEvent);`,
	] as const)("detects shorthand and default-valued destructuring assignments", (source) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects SQL mutation text passed through an alias of sql.raw", () => {
		const source = `import { sql } from "drizzle-orm";
const rawStatement = sql.raw;
const query = rawStatement("update approval_workflow_event set version = 2");`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects a SQL mutation string passed directly to execute", () => {
		const source = `import { db } from "@/db";
await db.execute("delete from approval_workflow_event where id = $1");`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects an interpolated SQL mutation template passed directly to query", () => {
		const source = `import type { PoolClient } from "pg";
import { approvalWorkflowEvent } from "@/db";
declare const client: PoolClient;
await client.query(\`update \${approvalWorkflowEvent} set version = 2\`);`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it.each([
		"update",
		"delete",
	] as const)("detects a bracket-access Drizzle %s", (method) => {
		const source = `import { approvalWorkflowEvent as events } from "@/db";
db["${method}"](events);`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects a quoted sql tag on a Drizzle namespace import", () => {
		const source = `import * as drizzle from "drizzle-orm";
const query = drizzle["sql"]\`update approval_workflow_event set version = 2\`;`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects quoted event-table access through transitive namespace aliases", () => {
		const source = `import * as schema from "@/db";
const firstSchema = schema;
const secondSchema = firstSchema;
const { "approvalWorkflowEvent": events } = secondSchema;
db.delete(events);`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects a quoted sql.raw alias", () => {
		const source = `import { sql } from "drizzle-orm";
const rawStatement = sql["raw"];
rawStatement("delete from approval_workflow_event");`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects a SQL mutation passed to a quoted execute method", () => {
		const source = `import { db } from "@/db";
await db["execute"]("update approval_workflow_event set version = 2");`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects assignment and transitive aliases of sql.raw", () => {
		const source = `import { sql } from "drizzle-orm";
let rawStatement;
rawStatement = sql.raw;
const transitiveRaw = rawStatement;
transitiveRaw("delete from approval_workflow_event");`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects assignment and transitive aliases of the sql tag", () => {
		const source = `import { sql as drizzleSql } from "drizzle-orm";
let firstSql;
firstSql = drizzleSql;
const transitiveSql = firstSql;
transitiveSql\`update approval_workflow_event set version = 2\`;`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects a sql tag through a transitive Drizzle namespace alias", () => {
		const source = `import * as drizzle from "drizzle-orm";
const firstDrizzle = drizzle;
const transitiveDrizzle = firstDrizzle;
transitiveDrizzle["sql"]\`delete from approval_workflow_event\`;`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("detects quoted sql.raw access through a Drizzle namespace", () => {
		const source = `import * as drizzle from "drizzle-orm";
const rawStatement = drizzle["sql"]["raw"];
rawStatement("update approval_workflow_event set version = 2");`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it("does not treat an unrelated raw method as executable SQL", () => {
		const source = `formatter.raw("delete from approval_workflow_event");`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toEqual([]);
	});

	it.each([
		`declare const sql: (strings: TemplateStringsArray) => unknown;
sql\`delete from approval_workflow_event\`;`,
		`import { sql } from "text-formatter";
sql\`update approval_workflow_event set version = 2\`;`,
	] as const)("does not trust a non-Drizzle sql binding", (source) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toEqual([]);
	});

	it.each([
		`import { approvalWorkflowEvent } from "audit-kit";
db.update(approvalWorkflowEvent);`,
		`import * as schema from "audit-kit";
db.delete(schema.approvalWorkflowEvent);`,
		`import { sql } from "drizzle-orm";
function render(sql: (strings: TemplateStringsArray) => unknown) {
	return sql\`update approval_workflow_event set version = 2\`;
}`,
		`import { approvalWorkflowEvent as events } from "@/db";
function mutate(events: unknown) {
	return db.delete(events);
}`,
		`import { approvalWorkflowEvent } from "@/db/schema";
function mutate() {
	const approvalWorkflowEvent = anotherTable;
	return db.update(approvalWorkflowEvent);
}`,
	] as const)("honors module boundaries and lexical shadowing", (source) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toEqual([]);
	});

	it.each([
		`import { sql } from "drizzle-orm";
for (let sql = formatter; keepGoing; sql = formatter)
	sql\`update approval_workflow_event set version = 2\`;
sql\`delete from approval_workflow_event\`;`,
		`import { approvalWorkflowEvent } from "@/db";
for (const approvalWorkflowEvent of tables)
	db.update(approvalWorkflowEvent);
db.delete(approvalWorkflowEvent);`,
		`import * as schema from "@/db/schema";
for (const schema in schemas)
	db.update(schema.approvalWorkflowEvent);
db.delete(schema.approvalWorkflowEvent);`,
	] as const)("honors loop-local bindings and restores outer bindings", (source) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it.each([
		`import { approvalWorkflowEvent as events } from "@/db/schema";
function mutate() {
	const nestedEvents = events;
	return db.delete(nestedEvents);
}`,
		`import { sql as drizzleSql } from "drizzle-orm";
function mutate() {
	const nestedSql = drizzleSql;
	return nestedSql\`update approval_workflow_event set version = 2\`;
}`,
	] as const)("detects real aliases inside nested scopes", (source) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toHaveLength(1);
	});

	it.each([
		`import { sql } from "drizzle-orm";
sql\`select 1; -- delete from approval_workflow_event
select 2\`;`,
		`import { sql } from "drizzle-orm";
sql\`select /* update approval_workflow_event set version = 2 */ 1\`;`,
	] as const)("ignores mutation text inside SQL comments", (source) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toEqual([]);
	});

	it("ignores mutation text inside nested PostgreSQL block comments", () => {
		const source = `import { sql } from "drizzle-orm";
sql\`select /* outer comment
	/* inner comment */
	update approval_workflow_event set version = 2
*/ 1\`;`;

		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toEqual([]);
	});

	it.each([
		`import { sql } from "drizzle-orm";
sql\`select 'delete from approval_workflow_event'\`;`,
		`import { sql } from "drizzle-orm";
sql\`select $body$update approval_workflow_event set version = 2$body$\`;`,
	] as const)("ignores mutation text inside SQL string literals", (source) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
		).toEqual([]);
	});

	it.each([
		`import { approvalWorkflowEvent } from "@/db";
db.insert(approvalWorkflowEvent).values({});`,
		`import * as schema from "@/db";
db.select().from(schema.approvalWorkflowEvent);`,
		`// Never UPDATE public.approval_workflow_event.
const documentation = "approval_workflow_event is append-only";`,
		`const unrelated = sql\`update approval_workflow_stage set status = 'approved'\`;`,
		`import { sql } from "drizzle-orm";
import { approvalWorkflowStage } from "@/db";
sql\`update \${approvalWorkflowStage} set status = 'approved'\`;`,
		`const inert = \`delete from approval_workflow_event\`;`,
		`import { sql } from "drizzle-orm";
sql\`select * from approval_workflow_event\`;`,
		`const unrelated = { approvalWorkflowEvent: anotherTable };
db.update(unrelated.approvalWorkflowEvent);`,
	] as const)("allows append/select/comment/documentation fixture", (source) => {
		expect(
			findApprovalWorkflowEventMutationViolations(source, "fixture.tsx"),
		).toEqual([]);
	});

	it("scans every supplied shipped production root", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "event-append-only-"));
		const sourceRoot = join(fixtureRoot, "src");
		const scriptsRoot = join(fixtureRoot, "scripts");
		mkdirSync(sourceRoot);
		mkdirSync(scriptsRoot);
		writeFileSync(
			join(sourceRoot, "mutation.ts"),
			`import { db } from "@/db";
db.execute("update approval_workflow_event set version = 2");`,
		);
		writeFileSync(
			join(scriptsRoot, "mutation.mts"),
			`import type { PoolClient } from "pg";
declare const client: PoolClient;
client.query("delete from approval_workflow_event");`,
		);

		try {
			expect(
				scanProductionApprovalWorkflowEventMutations([sourceRoot, scriptsRoot]),
			).toHaveLength(2);
		} finally {
			rmSync(fixtureRoot, { force: true, recursive: true });
		}
	});

	it("sorts and deduplicates reversed production roots", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "event-append-only-"));
		const firstRoot = join(fixtureRoot, "a");
		const secondRoot = join(fixtureRoot, "b");
		const firstFile = join(firstRoot, "mutation.ts");
		const secondFile = join(secondRoot, "mutation.ts");

		try {
			mkdirSync(firstRoot);
			mkdirSync(secondRoot);
			writeFileSync(
				firstFile,
				`import { db } from "@/db";
db.execute("delete from approval_workflow_event");`,
			);
			writeFileSync(
				secondFile,
				`import { db } from "@/db";
db.execute("update approval_workflow_event set version = 2");`,
			);

			expect(
				scanProductionApprovalWorkflowEventMutations([
					secondRoot,
					firstRoot,
					secondRoot,
				]),
			).toEqual([
				{
					column: 1,
					fileName: firstFile,
					kind: "raw_sql_delete",
					line: 2,
				},
				{
					column: 1,
					fileName: secondFile,
					kind: "raw_sql_update",
					line: 2,
				},
			]);
		} finally {
			rmSync(fixtureRoot, { force: true, recursive: true });
		}
	});

	it("does not recurse into symlinked production directories", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "event-append-only-"));
		const targetRoot = join(fixtureRoot, "target");
		const scannedRoot = join(fixtureRoot, "scanned");

		try {
			mkdirSync(targetRoot);
			mkdirSync(scannedRoot);
			writeFileSync(
				join(targetRoot, "mutation.ts"),
				`import { db } from "@/db";
db.execute("delete from approval_workflow_event");`,
			);
			try {
				symlinkSync(targetRoot, join(scannedRoot, "linked"), "dir");
			} catch {
				return;
			}

			expect(scanProductionApprovalWorkflowEventMutations(scannedRoot)).toEqual(
				[],
			);
		} finally {
			rmSync(fixtureRoot, { force: true, recursive: true });
		}
	});

	it("prefilters files with no append-only scan candidates", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "event-append-only-"));
		const sourceFile = join(fixtureRoot, "malformed.ts");

		try {
			writeFileSync(sourceFile, "const unfinished = `");

			expect(scanProductionApprovalWorkflowEventMutations(fixtureRoot)).toEqual(
				[],
			);
		} finally {
			rmSync(fixtureRoot, { force: true, recursive: true });
		}
	});

	it("prefilters conservatively for uppercase and concatenated SQL", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "event-append-only-"));
		const concatenatedFile = join(fixtureRoot, "a-concatenated.ts");
		const uppercaseFile = join(fixtureRoot, "b-uppercase.ts");
		const noncandidateFile = join(fixtureRoot, "c-noncandidate.ts");

		try {
			writeFileSync(
				concatenatedFile,
				`import { db } from "@/db";
const table = "approval_workflow_" + "event";
db.execute("DELETE FROM " + table);`,
			);
			writeFileSync(
				uppercaseFile,
				`import { db } from "@/db";
db.execute("UPDATE APPROVAL_WORKFLOW_EVENT SET version = 2");`,
			);
			writeFileSync(noncandidateFile, "const unfinished = `");

			expect(scanProductionApprovalWorkflowEventMutations(fixtureRoot)).toEqual(
				[
					{
						column: 1,
						fileName: concatenatedFile,
						kind: "raw_sql_delete",
						line: 3,
					},
					{
						column: 1,
						fileName: uppercaseFile,
						kind: "raw_sql_update",
						line: 2,
					},
				],
			);
		} finally {
			rmSync(fixtureRoot, { force: true, recursive: true });
		}
	});

	it("prefilters only event-specific raw SQL and table provenance", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "event-append-only-"));
		const directFile = join(fixtureRoot, "a-direct.ts");
		const interpolationFile = join(fixtureRoot, "b-interpolation.ts");
		const splitFile = join(fixtureRoot, "c-split.ts");
		const uppercaseFile = join(fixtureRoot, "d-uppercase.ts");
		const genericExecuteFile = join(fixtureRoot, "e-generic-execute.ts");
		const genericSqlFile = join(fixtureRoot, "f-generic-sql.ts");
		const noncandidateFile = join(fixtureRoot, "g-noncandidate.ts");

		try {
			writeFileSync(
				directFile,
				`import { db } from "@/db";
const table = "approval_workflow_event";
db.execute("DELETE FROM " + table);`,
			);
			writeFileSync(
				interpolationFile,
				`import { approvalWorkflowEvent, db } from "@/db";
db.delete(approvalWorkflowEvent);`,
			);
			writeFileSync(
				splitFile,
				`import { db } from "@/db";
const table = "approval_" + "workflow_" + "event";
db.execute("DELETE FROM " + table);`,
			);
			writeFileSync(
				uppercaseFile,
				`import { db } from "@/db";
db.execute("UPDATE APPROVAL_WORKFLOW_EVENT SET version = 2");`,
			);
			writeFileSync(
				genericExecuteFile,
				'db.execute("select 1"); const unfinished = `',
			);
			writeFileSync(genericSqlFile, "sql`select 1`; const unfinished = `");
			writeFileSync(noncandidateFile, "const unfinished = `");

			expect(scanProductionApprovalWorkflowEventMutations(fixtureRoot)).toEqual(
				[
					{
						column: 1,
						fileName: directFile,
						kind: "raw_sql_delete",
						line: 3,
					},
					{
						column: 1,
						fileName: interpolationFile,
						kind: "drizzle_delete",
						line: 2,
					},
					{
						column: 1,
						fileName: splitFile,
						kind: "raw_sql_delete",
						line: 3,
					},
					{
						column: 1,
						fileName: uppercaseFile,
						kind: "raw_sql_update",
						line: 2,
					},
				],
			);
		} finally {
			rmSync(fixtureRoot, { force: true, recursive: true });
		}
	});

	it("scans runtime-named directories while excluding exact non-production artifacts", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "event-append-only-"));
		const webappRoot = join(fixtureRoot, "apps", "webapp");
		const mutation = `import { db } from "@/db";
db.execute("update approval_workflow_event set version = 2");`;
		const productionFiles = [
			"src/lib/time-record/migration/runtime.ts",
			"src/lib/operations/meta/runtime.mts",
			"scripts/snapshots/runtime.cts",
		];
		const excludedFiles = [
			"drizzle/0001_migration.ts",
			"drizzle/meta/0001_snapshot.ts",
			"src/db/auth-schema.ts",
			"src/lib/ignored.test.ts",
			"src/lib/ignored.spec.tsx",
			"src/lib/__tests__/ignored.ts",
		];

		try {
			for (const file of [...productionFiles, ...excludedFiles]) {
				const fileName = join(webappRoot, file);
				mkdirSync(join(fileName, ".."), { recursive: true });
				writeFileSync(fileName, mutation);
			}

			const violations =
				scanProductionApprovalWorkflowEventMutations(webappRoot);
			expect(violations).toHaveLength(productionFiles.length);
			expect(violations).toEqual(
				expect.arrayContaining(
					productionFiles.map((file) =>
						expect.objectContaining({ fileName: join(webappRoot, file) }),
					),
				),
			);
		} finally {
			rmSync(fixtureRoot, { force: true, recursive: true });
		}
	});

	it("owns the only normal-test production source scan", () => {
		const workflowDirectory = join(
			process.cwd(),
			"src",
			"lib",
			"approvals",
			"workflow",
		);
		const scanOwners = readdirSync(workflowDirectory)
			.filter(
				(fileName) =>
					fileName.endsWith(".test.ts") &&
					!fileName.endsWith(".integration.test.ts"),
			)
			.filter((fileName) =>
				readFileSync(join(workflowDirectory, fileName), "utf8").includes(
					"scanProductionApprovalWorkflowEventMutations(",
				),
			)
			.sort();

		expect(scanOwners).toEqual(["event-append-only-guard.test.ts"]);
	});

	it("scans production TypeScript extensions while excluding tests and generated artifacts", () => {
		const violations = scanProductionApprovalWorkflowEventMutations([
			join(process.cwd(), "src"),
			join(process.cwd(), "scripts"),
		]);
		expect(violations).toEqual([]);
	}, 15_000);
});
