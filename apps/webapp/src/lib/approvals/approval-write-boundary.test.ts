import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import * as approvalWriteBoundary from "./approval-write-boundary";
import {
	CANONICAL_SOURCE_WRITE_OWNERS,
	CANONICAL_WRITE_OWNERS,
	SOURCE_WRITE_EXCEPTIONS,
	scanApprovalWriteBoundary,
	scanApprovalWriteInventory,
	TEMPORARY_LEGACY_WRITE_EXCEPTIONS,
} from "./approval-write-boundary";
import {
	ApprovalWriteBoundaryAnalysisLimitError,
	findProtectedApprovalSqlMutations,
	PROTECTED_APPROVAL_TABLES,
} from "./approval-write-boundary-sql";
import { analyzeApprovalWriteMutations } from "./approval-write-boundary-typescript";

const FILE_NAME = "/repo/apps/webapp/src/lib/approvals/fixture.ts";
const CHAIN_SERVICE_FILE_NAME =
	"/repo/apps/webapp/src/lib/approvals/policies/chain-service.ts";

describe("approval write boundary raw SQL analyzer", () => {
	it("exports exactly the approved protected approval tables", () => {
		expect(PROTECTED_APPROVAL_TABLES).toEqual([
			"approval_request",
			"approval_chain_instance",
			"approval_chain_stage_instance",
			"approval_workflow",
			"approval_workflow_stage",
			"approval_stage_assignment",
			"approval_workflow_event",
			"approval_workflow_command",
			"approval_requester_projection",
			"approval_inbox_projection",
			"approval_outbox",
			"approval_outbox_delivery",
			"approval_workflow_rollout",
			"approval_workflow_migration_issue",
		]);
	});
	it.each([
		[
			"insert",
			"insert into approval_workflow_event (id) values ('event-1')",
			[{ operation: "insert", table: "approval_workflow_event" }],
		],
		[
			"upsert",
			"insert into approval_outbox (id) values ('outbox-1') on conflict (id) do update set payload = excluded.payload",
			[
				{ operation: "insert", table: "approval_outbox" },
				{ operation: "update", table: "approval_outbox" },
			],
		],
		[
			"writable CTE",
			"with removed as (delete from approval_request where id = 'request-1') select * from removed",
			[{ operation: "delete", table: "approval_request" }],
		],
		[
			"update",
			"update public.approval_workflow set version = version + 1",
			[{ operation: "update", table: "approval_workflow" }],
		],
		[
			"delete",
			"delete from approval_chain_stage_instance where id = 'stage-1'",
			[{ operation: "delete", table: "approval_chain_stage_instance" }],
		],
	] as const)("extracts a raw SQL %s mutation", (_name, sqlText, expected) => {
		expect(findProtectedApprovalSqlMutations(sqlText)).toEqual(expected);
	});

	it("detects every protected ordinary work-period source column", () => {
		const source = `import { db, workPeriod } from "@/db";
const table = workPeriod;
const values = {
  approvalStatus: "approved", pendingChanges: null,
  approvalWorkflowId: workflowId, canonicalRecordId: recordId,
  clockInId, clockOutId, startTime, endTime, durationMinutes,
  updatedAt: new Date(),
};
db.update(table).set(values);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				columns: [
					"approval_status",
					"approval_workflow_id",
					"canonical_record_id",
					"clock_in_id",
					"clock_out_id",
					"duration_minutes",
					"end_time",
					"pending_changes",
					"start_time",
				],
				fileName: FILE_NAME,
				line: 9,
				operation: "update",
				table: "work_period",
			},
		]);
	});

	it("detects a binding write through a nested typed database service", () => {
		const source = `import { workPeriod } from "@/db/schema";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
interface Input { dbService: ApprovalDbService; workflowId: string }
export async function bindSource(input: Input) {
  await input.dbService.db.update(workPeriod).set({ approvalWorkflowId: input.workflowId });
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 9,
				columns: ["approval_workflow_id"],
				fileName: FILE_NAME,
				functionName: "bindSource",
				line: 5,
				operation: "update",
				table: "work_period",
			},
		]);
	});

	it("protects direct work-period status writes", () => {
		const source = `import { db, workPeriod } from "@/db";
db.update(workPeriod).set({ pendingChanges: null, updatedAt: new Date() });`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				columns: ["pending_changes"],
				operation: "update",
				table: "work_period",
			}),
		]);
	});

	it("detects canonical Drizzle base, work, and allocation writes", () => {
		const source = `import { db, timeRecord, timeRecordWork, timeRecordAllocation } from "@/db";
export function directCanonicalWrites() {
  db.update(timeRecord).set({
    approvalState: "approved", startAt, endAt, durationMinutes,
    organizationId, employeeId, updatedAt,
  });
  db.insert(timeRecordWork).values({
    recordId, organizationId, recordKind: "work", workCategoryId,
    workLocationType, computationMetadata,
  });
  db.insert(timeRecordAllocation).values({
    id, organizationId, recordId, allocationKind, projectId,
    costCenterId, weightPercent, createdAt,
  });
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				columns: [
					"approval_state",
					"duration_minutes",
					"employee_id",
					"end_at",
					"organization_id",
					"start_at",
				],
				functionName: "directCanonicalWrites",
				operation: "update",
				semantic: "ordinary_finalization",
				table: "time_record",
			}),
			expect.objectContaining({
				columns: [
					"computation_metadata",
					"organization_id",
					"record_id",
					"record_kind",
					"work_category_id",
					"work_location_type",
				],
				operation: "insert",
				semantic: "policy_clock_out_terminal_break",
				table: "time_record_work",
			}),
			expect.objectContaining({
				columns: [
					"allocation_kind",
					"cost_center_id",
					"created_at",
					"id",
					"organization_id",
					"project_id",
					"record_id",
					"weight_percent",
				],
				operation: "insert",
				semantic: "policy_clock_out_terminal_break",
				table: "time_record_allocation",
			}),
		]);
	});

	it("tracks protected writes through Pick clients, transaction aliases, and injected database services", () => {
		const source = `import type { db } from "@/db";
import { timeRecord, timeRecordWork, workPeriod } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { Effect } from "effect";
type InsertClient = Pick<typeof db, "insert">;
type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function createForCompletedPeriod(client: InsertClient) {
  return client.insert(timeRecordWork).values({ recordId, organizationId, recordKind: "work", workCategoryId, workLocationType, computationMetadata });
}
export function applyCorrectionWritesInTransaction(tx: TransactionClient) {
  tx.update(workPeriod).set({ clockInId, startTime, durationMinutes });
}
export function createTimeRecord() {
  return Effect.gen(function* (_) {
    const dbService = yield* _(DatabaseService);
    return dbService.db.insert(timeRecord).values({ organizationId, employeeId, startAt, endAt, durationMinutes, approvalState: "approved" });
  });
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				functionName: "createForCompletedPeriod",
				operation: "insert",
				table: "time_record_work",
			}),
			expect.objectContaining({
				functionName: "applyCorrectionWritesInTransaction",
				operation: "update",
				table: "work_period",
			}),
			expect.objectContaining({
				functionName: "createTimeRecord",
				operation: "insert",
				table: "time_record",
			}),
		]);
	});

	it("does not trust arbitrary insert and update receiver lookalikes", () => {
		const source = `import { timeRecord, workPeriod } from "@/db/schema";
function lookalike(formatter: { insert(value: unknown): any; update(value: unknown): any }) {
  formatter.insert(timeRecord).values({ approvalState: "approved" });
  formatter.update(workPeriod).set({ approvalStatus: "approved" });
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([]);
	});

	it("tracks trusted database receivers through const object properties and aliases", () => {
		const source = `import { db, timeRecord, workPeriod } from "@/db";
const holder = { nested: { database: db } };
const alias = holder;
export function ownedObjectWrite() {
  alias.nested.database.update(workPeriod).set({ approvalStatus: "approved" });
}
const lookalike = { nested: { database: formatter } };
lookalike.nested.database.insert(timeRecord).values({ approvalState: "approved" });
const replaced = { database: db };
replaced.database = formatter;
replaced.database.update(workPeriod).set({ approvalStatus: "approved" });`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				functionName: "ownedObjectWrite",
				operation: "update",
				table: "work_period",
			}),
		]);
	});

	it("invalidates object receiver provenance only along the accessed path", () => {
		const source = `import { db, workPeriod } from "@/db";
const direct = { db, note: "before" };
direct.note = "after";
direct.db.update(workPeriod).set({ approvalStatus: "approved" });
const nested = { branch: { db, note: "before" } };
nested.branch.note = "after";
nested.branch.db.update(workPeriod).set({ approvalStatus: "approved" });
const replacedReceiver = { db };
replacedReceiver.db = formatter;
replacedReceiver.db.update(workPeriod).set({ approvalStatus: "approved" });
const replacedAncestor = { branch: { db } };
Object.assign(replacedAncestor.branch, input);
replacedAncestor.branch.db.update(workPeriod).set({ approvalStatus: "approved" });
let replacedRoot = { branch: { db } };
replacedRoot = input;
replacedRoot.branch.db.update(workPeriod).set({ approvalStatus: "approved" });`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({ line: 4, table: "work_period" }),
			expect.objectContaining({ line: 7, table: "work_period" }),
		]);
	});

	it("allows an exact owner through an object-held receiver but rejects a wrong function", () => {
		const path = "src/lib/approvals/server/work-period-approvals.ts";
		withApprovalWriteTree(
			{
				[path]: `import { db, workPeriod } from "@/db";
const holder = { db };
export function finalizeOrdinaryWorkPeriodTerminal() {
  return holder.db.update(workPeriod).set({ approvalStatus: "approved", pendingChanges: null });
}
export function wrongObjectOwner() {
  return holder.db.update(workPeriod).set({ approvalStatus: "approved", pendingChanges: null });
}`,
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({ functionName: "wrongObjectOwner", path }),
				]);
			},
		);
	});

	it("tracks direct Effect DatabaseService extraction, aliases, and destructuring", () => {
		const source = `import { timeRecord, workPeriod } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
export function* directYield() {
  const service = yield* DatabaseService;
  const alias = service;
  alias.db.update(workPeriod).set({ approvalStatus: "approved" });
}
export function* destructuredYield() {
  const { db: client } = yield* DatabaseService;
  client.insert(timeRecord).values({ organizationId, employeeId, startAt, endAt, durationMinutes, approvalState: "approved" });
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				functionName: "directYield",
				table: "work_period",
			}),
			expect.objectContaining({
				functionName: "destructuredYield",
				table: "time_record",
			}),
		]);
	});

	it("does not trust a local DatabaseService lookalike", () => {
		const source = `import { workPeriod } from "@/db/schema";
const DatabaseService = formatter;
function* lookalike() {
  const service = yield* DatabaseService;
  service.db.update(workPeriod).set({ approvalStatus: "approved" });
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([]);
	});

	it("trusts only imported Effect generator adapter calls for DatabaseService", () => {
		const source = `import { workPeriod } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { Effect } from "effect";
Effect.gen(function* (_) {
  const adapter = _;
  const service = yield* adapter(DatabaseService);
  service.db.update(workPeriod).set({ approvalStatus: "approved" });
});
function* arbitraryWrapper() {
  const service = yield* wrap(DatabaseService);
  service.db.update(workPeriod).set({ approvalStatus: "approved" });
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({ line: 7, table: "work_period" }),
		]);
	});

	it.each([
		`import { sql } from "drizzle-orm";
const table = input;
sql.raw("update " + table + " set approval_status = 'approved'");`,
		`import { db } from "@/db";
const table = input;
db.execute("delete from " + table);`,
		`import { sql } from "drizzle-orm";
const schema = input;
sql\`update \${schema}.work_period set approval_status = 'approved'\`;`,
		`import { sql } from "drizzle-orm";
const table = input;
sql\`insert into public.\${table} (approval_status) values ('approved')\`;`,
	] as const)("fails closed for a dynamic SQL mutation target", (source) => {
		expect(() => analyzeApprovalWriteMutations(source, FILE_NAME)).toThrow(
			/dynamic SQL mutation target/i,
		);
	});

	it("keeps a static SQL target with parameterized values precise", () => {
		const source = `import { sql } from "drizzle-orm";
sql\`update work_period set approval_status = \${status} where id = \${id}\`;`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				columns: ["approval_status"],
				operation: "update",
				table: "work_period",
			}),
		]);
	});

	it("fails closed when a protected payload identifier is reassigned or mutated", () => {
		const source = `import { db, workPeriod } from "@/db";
export function reassigned(input: object) {
  let values = { approvalWorkflowId: "workflow-1" };
  values = input;
  db.update(workPeriod).set(values);
}
export function mutated(input: object) {
  const values = { approvalWorkflowId: "workflow-1" };
  Object.assign(values, input);
  db.update(workPeriod).set(values);
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				functionName: "reassigned",
				uncertainty: "dynamic_payload",
			}),
			expect.objectContaining({
				functionName: "mutated",
				uncertainty: "dynamic_payload",
			}),
		]);
	});

	it("rejects allowed-then-input reassignment inside an exact owner capability", () => {
		const path = "src/lib/approvals/server/work-period-submission.ts";
		withApprovalWriteTree(
			{
				[path]: `import { db, workPeriod } from "@/db";
export function bindSourceWorkflow(input: object) {
  let values = { approvalWorkflowId: "workflow-1" };
  values = input;
  return db.update(workPeriod).set(values);
}`,
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({
						functionName: "bindSourceWorkflow",
						path,
						uncertainty: "dynamic_payload",
					}),
				]);
			},
		);
	});

	it("keeps a const payload identifier precise", () => {
		const source = `import { db, workPeriod } from "@/db";
const values = { approvalWorkflowId: "workflow-1" };
db.update(workPeriod).set(values);`;

		const mutations = analyzeApprovalWriteMutations(source, FILE_NAME);
		expect(mutations).toEqual([
			expect.objectContaining({
				columns: ["approval_workflow_id"],
			}),
		]);
		expect(mutations[0]).not.toHaveProperty("uncertainty");
	});

	it("does not carry an old object mutation across a payload reassignment", () => {
		const source = `import { db, workPeriod } from "@/db";
let values = {};
Object.assign(values, input);
values = { approvalWorkflowId: "workflow-1" };
db.update(workPeriod).set(values);`;

		const mutations = analyzeApprovalWriteMutations(source, FILE_NAME);
		expect(mutations).toEqual([
			expect.objectContaining({ columns: ["approval_workflow_id"] }),
		]);
		expect(mutations[0]).not.toHaveProperty("uncertainty");
	});

	it("tracks static payload property writes without widening unrelated keys", () => {
		const source = `import { db, workPeriod } from "@/db";
export function unprotected() {
  const values = { approvalWorkflowId: "workflow-1" };
  values.note = input;
  db.update(workPeriod).set(values);
}
export function protectedWrite() {
  const values = { note: "initial" };
  values.approvalStatus = "approved";
  db.update(workPeriod).set(values);
}`;

		const mutations = analyzeApprovalWriteMutations(source, FILE_NAME);
		expect(mutations).toEqual([
			expect.objectContaining({
				columns: ["approval_workflow_id"],
				functionName: "unprotected",
			}),
			expect.objectContaining({
				columns: ["approval_status"],
				functionName: "protectedWrite",
			}),
		]);
		expect(mutations).toEqual(
			expect.not.arrayContaining([
				expect.objectContaining({ uncertainty: "dynamic_payload" }),
			]),
		);
	});

	it("fails closed for unknown payload writes, replacements, and helper calls", () => {
		const source = `import { db, workPeriod } from "@/db";
export function computed(key: string) {
  const values = { approvalWorkflowId: "workflow-1" };
  values[key] = input;
  db.update(workPeriod).set(values);
}
export function replaced(input: object) {
  let values = { approvalWorkflowId: "workflow-1" };
  values = input;
  db.update(workPeriod).set(values);
}
export function helperCall() {
  const values = { approvalWorkflowId: "workflow-1" };
  mutate(values);
  db.update(workPeriod).set(values);
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				functionName: "computed",
				uncertainty: "dynamic_payload",
			}),
			expect.objectContaining({
				functionName: "replaced",
				uncertainty: "dynamic_payload",
			}),
			expect.objectContaining({
				functionName: "helperCall",
				uncertainty: "dynamic_payload",
			}),
		]);
	});

	it("distinguishes global Object.assign from shadowed and lookalike calls", () => {
		const source = `import { db, workPeriod } from "@/db";
export function globalReadOnly() {
  const values = { approvalWorkflowId: "workflow-1" };
  Object.assign({}, values);
  db.update(workPeriod).set(values);
}
export function shadowed(Object: { assign(target: object, input: object): void }) {
  const values = { approvalWorkflowId: "workflow-1" };
  Object.assign(values, input);
  db.update(workPeriod).set(values);
}
export function lookalike() {
  const values = { approvalWorkflowId: "workflow-1" };
  helper.assign(values, input);
  db.update(workPeriod).set(values);
}`;

		const mutations = analyzeApprovalWriteMutations(source, FILE_NAME);
		expect(mutations).toEqual([
			expect.objectContaining({ functionName: "globalReadOnly" }),
			expect.objectContaining({
				functionName: "shadowed",
				uncertainty: "dynamic_payload",
			}),
			expect.objectContaining({
				functionName: "lookalike",
				uncertainty: "dynamic_payload",
			}),
		]);
		expect(mutations[0]).not.toHaveProperty("uncertainty");
	});

	it("extracts the complete ordinary and terminal-split raw SQL graph", () => {
		expect(
			findProtectedApprovalSqlMutations(`
update work_period set approval_status = 'approved', pending_changes = null,
  approval_workflow_id = $1, canonical_record_id = $2, clock_in_id = $3,
  clock_out_id = $4, start_time = $5, end_time = $6, duration_minutes = $7;
update time_record set approval_state = 'approved', end_at = $1, duration_minutes = $2;
insert into time_record (id, organization_id, employee_id, record_kind, start_at,
  end_at, duration_minutes, approval_state, origin) values ($1, $2, $3, 'work', $4, $5, $6, 'approved', 'clock');
insert into time_record_work (record_id, organization_id, record_kind, work_category_id,
  work_location_type, computation_metadata) values ($1, $2, 'work', $3, $4, $5);
insert into time_record_allocation (id, organization_id, record_id, allocation_kind,
  project_id, cost_center_id, weight_percent) values ($1, $2, $3, $4, $5, $6, $7);
`),
		).toEqual([
			{
				columns: [
					"approval_status",
					"approval_workflow_id",
					"canonical_record_id",
					"clock_in_id",
					"clock_out_id",
					"duration_minutes",
					"end_time",
					"pending_changes",
					"start_time",
				],
				operation: "update",
				table: "work_period",
			},
			{
				columns: ["approval_state", "duration_minutes", "end_at"],
				operation: "update",
				semantic: "ordinary_finalization",
				table: "time_record",
			},
			{
				columns: [
					"approval_state",
					"duration_minutes",
					"employee_id",
					"end_at",
					"organization_id",
					"start_at",
				],
				operation: "insert",
				semantic: "policy_clock_out_terminal_break",
				table: "time_record",
			},
			{
				columns: [
					"computation_metadata",
					"organization_id",
					"record_id",
					"record_kind",
					"work_category_id",
					"work_location_type",
				],
				operation: "insert",
				semantic: "policy_clock_out_terminal_break",
				table: "time_record_work",
			},
			{
				columns: [
					"allocation_kind",
					"cost_center_id",
					"id",
					"organization_id",
					"project_id",
					"record_id",
					"weight_percent",
				],
				operation: "insert",
				semantic: "policy_clock_out_terminal_break",
				table: "time_record_allocation",
			},
		]);
	});

	it("detects hidden correction inserts through database and payload aliases", () => {
		const source = `import { db as database, timeEntry as entries } from "@/db";
const transaction = database;
const row = { type: "correction", replacesEntryId: originalId, isSuperseded: true };
transaction.insert(entries).values(row);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				columns: ["is_superseded", "replaces_entry_id", "type"],
				fileName: FILE_NAME,
				line: 4,
				operation: "insert",
				semantic: "correction",
				table: "time_entry",
			},
		]);
	});

	it("retains targeted insert keys when an additional spread is dynamic", () => {
		const source = `import { db, timeEntry } from "@/db";
function insertCorrection(extra: Record<string, unknown>) {
  return db.insert(timeEntry).values({ type: "correction", replacesEntryId: originalId, ...extra });
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 10,
				columns: ["replaces_entry_id", "type"],
				fileName: FILE_NAME,
				functionName: "insertCorrection",
				line: 3,
				operation: "insert",
				semantic: "correction",
				table: "time_entry",
				uncertainty: "dynamic_payload",
			},
		]);
	});

	it.each([
		[
			"parameter",
			`import { db, workPeriod } from "@/db";
function mutate(patch: object) {
  return db.update(workPeriod).set(patch);
}`,
			"work_period",
			"update",
		],
		[
			"alias",
			`import { db, timeEntry } from "@/db";
function mutate(patch: object) {
  const values = patch;
  return db.update(timeEntry).set(values);
}`,
			"time_entry",
			"update",
		],
		[
			"helper return",
			`import { db, timeEntry } from "@/db";
declare function correctionValues(): object;
function mutate() {
  return db.insert(timeEntry).values(correctionValues());
}`,
			"time_entry",
			"insert",
		],
		[
			"object spread",
			`import { db, workPeriod } from "@/db";
function mutate(patch: object) {
  return db.update(workPeriod).set({ updatedAt: now, ...patch });
}`,
			"work_period",
			"update",
		],
	] as const)("fails closed for an unresolved targeted Drizzle %s payload", (_name, source, table, operation) => {
		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				functionName: "mutate",
				operation,
				table,
				uncertainty: "dynamic_payload",
			}),
		]);
	});

	it("ignores a statically complete unrelated source payload", () => {
		const source = `import { db, workPeriod } from "@/db";
db.update(workPeriod).set({ projectId, updatedAt: now });`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([]);
	});

	it("resolves protected keys that explicitly override an earlier dynamic spread", () => {
		const source = `import { db, timeEntry } from "@/db";
function insertCorrection(extra: object) {
  return db.insert(timeEntry).values({
    ...extra,
    type: "correction",
    replacesEntryId: originalId,
    isSuperseded: true,
    supersededById: null,
  });
}`;

		const findings = analyzeApprovalWriteMutations(source, FILE_NAME);
		expect(findings).toEqual([
			expect.objectContaining({
				columns: [
					"is_superseded",
					"replaces_entry_id",
					"superseded_by_id",
					"type",
				],
				semantic: "correction",
				table: "time_entry",
			}),
		]);
		expect(findings[0]).not.toHaveProperty("uncertainty");
	});

	it("attributes anonymous callback writes to the nearest named enclosing function", () => {
		const source = `import { db, timeEntry, workPeriod } from "@/db";
export async function importClockodoData(entry: object, period: object) {
  return db.transaction(async (tx) => {
    await tx.insert(timeEntry).values(entry);
    await tx.insert(workPeriod).values(period);
  });
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				functionName: "importClockodoData",
				operation: "insert",
				table: "time_entry",
				uncertainty: "dynamic_payload",
			}),
			expect.objectContaining({
				functionName: "importClockodoData",
				operation: "insert",
				table: "work_period",
				uncertainty: "dynamic_payload",
			}),
		]);
	});

	it("detects correction lifecycle updates without banning other time-entry writes", () => {
		const source = `import { db, timeEntry } from "@/db";
db.update(timeEntry).set({ isSuperseded: false, supersededById: null });
db.update(timeEntry).set({ notes: "ordinary edit" });`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				columns: ["is_superseded", "superseded_by_id"],
				fileName: FILE_NAME,
				line: 2,
				operation: "update",
				semantic: "correction_lifecycle",
				table: "time_entry",
			},
		]);
	});

	it("detects an inactive correction delete with exact lineage constraints", () => {
		const source = `import { db, timeEntry } from "@/db";
import { and, eq, isNull } from "drizzle-orm";
export function hiddenDelete(id: string, originalId: string) {
  return db.delete(timeEntry).where(and(
    eq(timeEntry.id, id),
    eq(timeEntry.type, "correction"),
    eq(timeEntry.replacesEntryId, originalId),
    eq(timeEntry.isSuperseded, true),
    isNull(timeEntry.supersededById),
  ));
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 10,
				columns: [
					"is_superseded",
					"replaces_entry_id",
					"superseded_by_id",
					"type",
				],
				fileName: FILE_NAME,
				functionName: "hiddenDelete",
				line: 4,
				operation: "delete",
				semantic: "inactive_correction",
				table: "time_entry",
			},
		]);
	});

	it("ignores an unrelated time-entry bulk delete", () => {
		const source = `import { db, timeEntry } from "@/db";
db.delete(timeEntry).where(inArray(timeEntry.employeeId, employeeIds));`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([]);
	});

	it.each([
		[
			"workflow binding update",
			"update work_period set pending_changes = null, approval_workflow_id = $1 where id = $2",
			[
				{
					columns: ["approval_workflow_id", "pending_changes"],
					operation: "update",
					table: "work_period",
				},
			],
		],
		[
			"correction insert",
			"insert into time_entry (id, type, replaces_entry_id, is_superseded) values ($1, 'correction', $2, true)",
			[
				{
					columns: ["is_superseded", "replaces_entry_id", "type"],
					operation: "insert",
					semantic: "correction",
					table: "time_entry",
				},
			],
		],
		[
			"correction lifecycle update",
			"update time_entry set is_superseded = false, superseded_by_id = null where id = $1",
			[
				{
					columns: ["is_superseded", "superseded_by_id"],
					operation: "update",
					semantic: "correction_lifecycle",
					table: "time_entry",
				},
			],
		],
		[
			"inactive correction delete",
			"delete from time_entry where type = 'correction' and replaces_entry_id = $1 and is_superseded = true and superseded_by_id is null",
			[
				{
					columns: [
						"is_superseded",
						"replaces_entry_id",
						"superseded_by_id",
						"type",
					],
					operation: "delete",
					semantic: "inactive_correction",
					table: "time_entry",
				},
			],
		],
	] as const)("extracts targeted raw SQL %s", (_name, sqlText, expected) => {
		expect(findProtectedApprovalSqlMutations(sqlText)).toEqual(expected);
	});

	it("rejects a hidden direct source write outside its owner", () => {
		withApprovalWriteTree(
			{
				"src/app/api/time-entries/corrections/hidden.ts":
					'import { db, workPeriod } from "@/db";\nexport function writeHiddenBinding() {\nconst target = workPeriod;\nreturn db.update(target).set({ approvalWorkflowId: "workflow-1" });\n}',
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({
						columns: ["approval_workflow_id"],
						functionName: "writeHiddenBinding",
						kind: "mutation",
						operation: "update",
						path: "src/app/api/time-entries/corrections/hidden.ts",
						table: "work_period",
					}),
				]);
			},
		);
	});

	it("rejects hidden correction deletes in action, REST, and demo paths", () => {
		const hiddenDelete = `import { db, timeEntry } from "@/db";
import { and, eq, isNull } from "drizzle-orm";
export function hiddenDelete(id: string, originalId: string) {
  return db.delete(timeEntry).where(and(eq(timeEntry.id, id), eq(timeEntry.type, "correction"), eq(timeEntry.replacesEntryId, originalId), eq(timeEntry.isSuperseded, true), isNull(timeEntry.supersededById)));
}`;
		withApprovalWriteTree(
			{
				"src/app/actions.ts": hiddenDelete,
				"src/app/api/time-entries/corrections/route.ts": hiddenDelete,
				"src/lib/demo/hidden-correction.ts": hiddenDelete,
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual(
					[
						"src/app/actions.ts",
						"src/app/api/time-entries/corrections/route.ts",
						"src/lib/demo/hidden-correction.ts",
					].map((path) =>
						expect.objectContaining({
							functionName: "hiddenDelete",
							kind: "mutation",
							operation: "delete",
							path,
							semantic: "inactive_correction",
							table: "time_entry",
						}),
					),
				);
			},
		);
	});

	it("conservatively resolves a protected branch of a ternary table expression", () => {
		const source = `import { approvalRequest, db } from "@/db";
db.delete(condition ? approvalRequest : unrelatedTable);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				line: 2,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it.each([
		"||=",
		"&&=",
		"??=",
	] as const)("conservatively tracks a protected logical assignment through %s", (operator) => {
		const source = `import { approvalRequest, db } from "@/db";
let table = unrelatedTable;
table ${operator} approvalRequest;
db.delete(table);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toHaveLength(1);
		expect(analyzeApprovalWriteMutations(source, FILE_NAME)[0]).toMatchObject({
			operation: "delete",
			table: "approval_request",
		});
	});

	it.each([
		[
			"parameter default",
			`function mutate(table = approvalRequest) {
	db.delete(table);
}`,
		],
		[
			"parameter destructuring default",
			`function mutate({ table = approvalRequest } = {}) {
	db.delete(table);
}`,
		],
		[
			"assignment destructuring default",
			`let table;
({ table = approvalRequest } = unrelatedSource);
db.delete(table);`,
		],
	] as const)("tracks a protected %s initializer", (_name, body) => {
		const source = `import { approvalRequest, db } from "@/db";
${body}`;
		const result = analyzeApprovalWriteMutations(source, FILE_NAME);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			operation: "delete",
			table: "approval_request",
		});
	});

	it("tracks loop assignment targets conservatively", () => {
		const source = `import { approvalRequest, db } from "@/db";
let table = unrelatedTable;
for (table of [approvalRequest]) {}
db.delete(table);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toHaveLength(1);
		expect(analyzeApprovalWriteMutations(source, FILE_NAME)[0]).toMatchObject({
			operation: "delete",
			table: "approval_request",
		});
	});

	it("does not let an uncalled nested-function write erase outer provenance", () => {
		const source = `import { approvalRequest, db } from "@/db";
let table = approvalRequest;
function notCalled() {
	table = unrelatedTable;
}
db.delete(table);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				line: 6,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it("makes outer writes before invocation visible inside a nested closure", () => {
		const source = `import { approvalRequest, db } from "@/db";
let table = unrelatedTable;
let database = unrelatedDatabase;
function mutate() {
	database.delete(table);
}
table = approvalRequest;
database = db;
mutate();`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 2,
				fileName: FILE_NAME,
				line: 5,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it.each([
		[
			"before the call",
			`table = approvalRequest;
database = db;
table = unrelatedTable;
database = unrelatedDatabase;
mutate();`,
		],
		[
			"after the call",
			`table = approvalRequest;
database = db;
mutate();
table = unrelatedTable;
database = unrelatedDatabase;`,
		],
	] as const)("unions possible ancestor table and receiver writes %s", (_name, writesAndCall) => {
		const source = `import { approvalRequest, db } from "@/db";
let table = unrelatedTable;
let database = unrelatedDatabase;
function mutate() {
	database.delete(table);
}
${writesAndCall}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 2,
				fileName: FILE_NAME,
				line: 5,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it("handles quoted, schema-qualified, ONLY, commented, and multiple statements", () => {
		expect(
			findProtectedApprovalSqlMutations(`
				INSERT INTO "audit"."approval_requester_projection" (id) VALUES ('projection-1');
				UPDATE /* target */ ONLY public.approval_workflow_stage SET position = 2;
				DELETE-- target follows
				FROM ONLY "public"."approval_inbox_projection";
			`),
		).toEqual([
			{ operation: "insert", table: "approval_requester_projection" },
			{ operation: "update", table: "approval_workflow_stage" },
			{ operation: "delete", table: "approval_inbox_projection" },
		]);
	});

	it("decodes a PostgreSQL Unicode-escaped protected identifier", () => {
		expect(
			findProtectedApprovalSqlMutations(
				`UPDATE U&"approval_workflow_!0065vent" UESCAPE '!' SET version = 2`,
			),
		).toEqual([{ operation: "update", table: "approval_workflow_event" }]);
	});

	it("decodes a Unicode surrogate-pair schema before a protected identifier", () => {
		expect(
			findProtectedApprovalSqlMutations(
				String.raw`UPDATE U&"\D83D\DE00".approval_request SET status = 'approved'`,
			),
		).toEqual([{ operation: "update", table: "approval_request" }]);
	});

	it("parses SEARCH and CYCLE suffixes before a final protected mutation", () => {
		expect(
			findProtectedApprovalSqlMutations(`
WITH RECURSIVE walk(id) AS (SELECT id FROM walk)
SEARCH DEPTH FIRST BY id SET order_path
CYCLE id SET is_cycle USING cycle_path
UPDATE approval_workflow SET version = version + 1;
`),
		).toEqual([{ operation: "update", table: "approval_workflow" }]);
	});

	it("extracts every possible protected MERGE operation", () => {
		expect(
			findProtectedApprovalSqlMutations(`
MERGE INTO "public"."approval_request" AS target
USING source_requests AS source ON target.id = source.id
WHEN MATCHED THEN UPDATE SET status = source.status
WHEN MATCHED AND source.deleted THEN DELETE
WHEN NOT MATCHED THEN INSERT (id, status) VALUES (source.id, source.status);
`),
		).toEqual([
			{ operation: "update", table: "approval_request" },
			{ operation: "delete", table: "approval_request" },
			{ operation: "insert", table: "approval_request" },
		]);
	});

	it("continues parsing MERGE operations after DO NOTHING", () => {
		expect(
			findProtectedApprovalSqlMutations(`
MERGE INTO approval_request AS target
USING source_requests AS source ON target.id = source.id
WHEN MATCHED AND source.ignored THEN DO NOTHING
WHEN MATCHED THEN UPDATE SET status = source.status
WHEN MATCHED AND source.deleted THEN DELETE
WHEN NOT MATCHED THEN INSERT (id, status) VALUES (source.id, source.status);
`),
		).toEqual([
			{ operation: "update", table: "approval_request" },
			{ operation: "delete", table: "approval_request" },
			{ operation: "insert", table: "approval_request" },
		]);
	});

	it("preserves preceding MERGE operations before DO NOTHING", () => {
		expect(
			findProtectedApprovalSqlMutations(`
MERGE INTO approval_request AS target
USING source_requests AS source ON target.id = source.id
WHEN MATCHED THEN UPDATE SET status = source.status
WHEN MATCHED AND source.deleted THEN DELETE
WHEN NOT MATCHED THEN INSERT (id, status) VALUES (source.id, source.status)
WHEN NOT MATCHED AND source.ignored THEN DO NOTHING;
`),
		).toEqual([
			{ operation: "update", table: "approval_request" },
			{ operation: "delete", table: "approval_request" },
			{ operation: "insert", table: "approval_request" },
		]);
	});

	it("extracts every protected TRUNCATE target and COPY FROM target", () => {
		expect(
			findProtectedApprovalSqlMutations(`
TRUNCATE TABLE approval_request, public.approval_outbox CASCADE;
COPY "public"."approval_outbox_delivery" (id, outbox_id) FROM STDIN;
`),
		).toEqual([
			{ operation: "delete", table: "approval_request" },
			{ operation: "delete", table: "approval_outbox" },
			{ operation: "insert", table: "approval_outbox_delivery" },
		]);
	});

	it.each([
		"MERGE INTO approval_request",
		"MERGE INTO approval_request USING source_rows ON true WHEN MATCHED THEN UPDATE",
		"MERGE INTO approval_request USING source_rows ON true WHEN MATCHED THEN DO",
		"MERGE INTO approval_request USING source_rows ON true WHEN MATCHED THEN DO NOTHING DELETE",
		"TRUNCATE TABLE approval_request,",
		"COPY approval_outbox (id) FROM",
		"COPY approval_outbox (id) TO STDOUT",
	] as const)("ignores malformed or non-writing extended SQL: %s", (sqlText) => {
		expect(findProtectedApprovalSqlMutations(sqlText)).toEqual([]);
	});

	it("integrates MERGE, TRUNCATE, and COPY through TypeScript SQL forms", () => {
		const source = `import { db } from "@/db";
import { sql } from "drizzle-orm";
sql\`MERGE INTO approval_request AS target USING source_rows AS source ON target.id = source.id WHEN MATCHED THEN DELETE\`;
sql.raw("TRUNCATE TABLE approval_outbox");
db.execute("COPY approval_outbox_delivery (id) FROM STDIN");`;

		expect(
			analyzeApprovalWriteMutations(source, FILE_NAME).map(
				({ operation, table }) => ({ operation, table }),
			),
		).toEqual([
			{ operation: "delete", table: "approval_request" },
			{ operation: "delete", table: "approval_outbox" },
			{ operation: "insert", table: "approval_outbox_delivery" },
		]);
	});

	it("ignores operation-looking text in comments and PostgreSQL strings", () => {
		expect(
			findProtectedApprovalSqlMutations(`
				SELECT 'delete from approval_request';
				SELECT E'update approval_workflow set version = 2';
				SELECT $$ insert into approval_outbox values ('fake') $$;
				SELECT $body$ delete from approval_chain $body$;
				-- update approval_workflow_rollout set mode = 'complete'
				SELECT 1 /* insert into approval_chain values ('fake') */;
			`),
		).toEqual([]);
	});

	it("unwraps executable EXPLAIN ANALYZE without treating plain EXPLAIN as a write", () => {
		expect(
			findProtectedApprovalSqlMutations(
				"EXPLAIN ANALYZE DELETE FROM approval_request",
			),
		).toEqual([{ operation: "delete", table: "approval_request" }]);
		expect(
			findProtectedApprovalSqlMutations("EXPLAIN DELETE FROM approval_request"),
		).toEqual([]);
	});

	it("preserves repeated raw SQL mutations in deterministic source order", () => {
		expect(
			findProtectedApprovalSqlMutations(`
				delete from approval_outbox_delivery;
				update approval_workflow_command set status = 'claimed';
				delete from approval_outbox_delivery;
			`),
		).toEqual([
			{ operation: "delete", table: "approval_outbox_delivery" },
			{ operation: "update", table: "approval_workflow_command" },
			{ operation: "delete", table: "approval_outbox_delivery" },
		]);
	});

	it.each([
		"UPDATE approval_request",
		"UPDATE approval_request WHERE id = 'request-1'",
		"UPDATE approval_request SET",
		"UPDATE approval_request SET status = $1 WHERE",
		"INSERT INTO approval_outbox",
		"INSERT INTO approval_outbox (id)",
		"INSERT INTO approval_outbox nonsense",
		"INSERT INTO approval_outbox (id) VALUES",
		"INSERT INTO approval_outbox (id) VALUES ($1) ON CONFLICT (id) DO UPDATE",
		"DELETE FROM approval_request WHERE",
	] as const)("ignores malformed protected mutation SQL: %s", (sqlText) => {
		expect(findProtectedApprovalSqlMutations(sqlText)).toEqual([]);
	});

	it.each([
		[
			"aliased update",
			"UPDATE approval_request AS request SET status = 'approved'",
			[{ operation: "update", table: "approval_request" }],
		],
		[
			"default-values insert",
			"INSERT INTO approval_outbox DEFAULT VALUES",
			[{ operation: "insert", table: "approval_outbox" }],
		],
		[
			"select insert",
			"INSERT INTO approval_outbox (id) SELECT id FROM source_rows",
			[{ operation: "insert", table: "approval_outbox" }],
		],
		[
			"table insert",
			"INSERT INTO approval_outbox TABLE source_outbox_rows",
			[{ operation: "insert", table: "approval_outbox" }],
		],
		[
			"overriding-values insert",
			"INSERT INTO approval_outbox (id) OVERRIDING SYSTEM VALUE VALUES ('outbox-1')",
			[{ operation: "insert", table: "approval_outbox" }],
		],
		[
			"placeholder update",
			"UPDATE approval_request SET status = $1 WHERE id = $2",
			[{ operation: "update", table: "approval_request" }],
		],
		[
			"placeholder values insert",
			"INSERT INTO approval_outbox (id) VALUES ($1)",
			[{ operation: "insert", table: "approval_outbox" }],
		],
		[
			"placeholder delete predicate",
			"DELETE FROM approval_request WHERE id = $1",
			[{ operation: "delete", table: "approval_request" }],
		],
	] as const)("accepts a valid %s", (_name, sqlText, expected) => {
		expect(findProtectedApprovalSqlMutations(sqlText)).toEqual(expected);
	});

	it("fails closed when raw SQL command nesting exceeds its limit", () => {
		let sql = "delete from approval_request";
		for (let level = 0; level < 66; level += 1) {
			sql = `with cte_${level} as (${sql}) select 1`;
		}

		expect(() => findProtectedApprovalSqlMutations(sql)).toThrowError(
			ApprovalWriteBoundaryAnalysisLimitError,
		);
		try {
			findProtectedApprovalSqlMutations(sql);
		} catch (error) {
			expect(error).toMatchObject({
				code: "APPROVAL_WRITE_BOUNDARY_ANALYSIS_LIMIT",
				limit: "sql_command_depth",
			});
		}
	});

	it("fails closed before lexing an oversized raw SQL string", () => {
		expect(() =>
			findProtectedApprovalSqlMutations(`select '${"x".repeat(1_000_001)}'`),
		).toThrowError(
			expect.objectContaining({
				code: "APPROVAL_WRITE_BOUNDARY_ANALYSIS_LIMIT",
				limit: "sql_text_length",
			}),
		);
	});

	it.each([
		["statement count", "select 1;".repeat(1_025), "sql_statement_count"],
		["token count", "x ".repeat(100_001), "sql_token_count"],
	] as const)("fails closed at the raw SQL %s limit", (_name, sqlText, limit) => {
		let error: unknown;
		try {
			findProtectedApprovalSqlMutations(sqlText);
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(ApprovalWriteBoundaryAnalysisLimitError);
		expect(error).toMatchObject({
			code: "APPROVAL_WRITE_BOUNDARY_ANALYSIS_LIMIT",
			limit,
		});
	});
});

describe("approval write boundary TypeScript analyzer", () => {
	it("trusts transaction callback parameters and their aliases from a trusted database", () => {
		const source = `import { approvalRequest, db } from "@/db";
db.transaction(async (transaction) => {
	const tx = transaction;
	await tx.update(approvalRequest).set({ status: "approved" });
});`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 8,
				fileName: FILE_NAME,
				line: 4,
				operation: "update",
				table: "approval_request",
			},
		]);
	});

	it("trusts a transaction type derived from a trusted database transaction API", () => {
		const source = `import type { db } from "@/db";
import { approvalRequest } from "@/db/schema";
type Transaction = Pick<Parameters<Parameters<typeof db.transaction>[0]>[0], "update">;
function mutate(input: { tx: Transaction }) {
	input.tx.update(approvalRequest).set({ status: "approved" });
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 2,
				fileName: FILE_NAME,
				line: 5,
				operation: "update",
				table: "approval_request",
			},
		]);
	});

	it("does not trust callback parameters from an unrelated transaction method", () => {
		const source = `import { approvalRequest } from "@/db";
runner.transaction(async (tx) => {
	tx.delete(approvalRequest);
});`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([]);
	});

	it("finds the audited production transaction writes", () => {
		const fixtures = [
			"src/lib/absences/sick-vacation-override.ts",
			"src/lib/time-record/migration/backfill.ts",
			"src/lib/jobs/organization-cleanup.ts",
		] as const;
		const results = fixtures.map((relativePath) => {
			const fileName = join(process.cwd(), relativePath);
			return {
				relativePath,
				writes: analyzeApprovalWriteMutations(
					readFileSync(fileName, "utf8"),
					fileName,
				).filter(({ table }) => table === "approval_request"),
			};
		});

		expect(results).toEqual([
			{
				relativePath: fixtures[0],
				writes: [
					expect.objectContaining({
						operation: "update",
						table: "approval_request",
					}),
					expect.objectContaining({
						operation: "insert",
						table: "approval_request",
					}),
				],
			},
			{
				relativePath: fixtures[1],
				writes: [
					expect.objectContaining({
						operation: "update",
						table: "approval_request",
					}),
				],
			},
			{
				relativePath: fixtures[2],
				writes: [
					expect.objectContaining({
						operation: "delete",
						table: "approval_request",
					}),
				],
			},
		]);
	});

	it("analyzes executable JavaScript modules by filename", () => {
		const source = `import { sql } from "drizzle-orm";
import { approvalRequest, db } from "@/db";
db.delete(approvalRequest);
sql\`update approval_workflow set version = 2\`;`;
		const fileName = "/repo/apps/webapp/scripts/approval-writes.mjs";

		expect(analyzeApprovalWriteMutations(source, fileName)).toEqual([
			{
				column: 1,
				fileName,
				line: 3,
				operation: "delete",
				table: "approval_request",
			},
			{
				column: 5,
				fileName,
				line: 4,
				operation: "update",
				table: "approval_workflow",
			},
		]);
	});

	it("tracks trusted CommonJS require destructuring and namespaces", () => {
		const source = `const database = require("@/db");
const schema = require("@/db/schema");
const { sql: query } = require("drizzle-orm");
const { approvalRequest } = schema;
database.db.delete(approvalRequest);
query\`update approval_workflow set version = 2\`;`;
		const fileName = "/repo/apps/webapp/scripts/approval-writes.cjs";

		expect(
			analyzeApprovalWriteMutations(source, fileName).map(
				({ operation, table }) => ({ operation, table }),
			),
		).toEqual([
			{ operation: "delete", table: "approval_request" },
			{ operation: "update", table: "approval_workflow" },
		]);
	});

	it("tracks trusted dynamic import destructuring and namespaces", () => {
		const source = `const database = await import("@/db");
const { approvalRequest } = await import("@/db/schema");
const { sql } = await import("drizzle-orm");
database.db.delete(approvalRequest);
sql\`insert into approval_outbox default values\`;`;
		const fileName = "/repo/apps/webapp/scripts/approval-writes.mjs";

		expect(
			analyzeApprovalWriteMutations(source, fileName).map(
				({ operation, table }) => ({ operation, table }),
			),
		).toEqual([
			{ operation: "delete", table: "approval_request" },
			{ operation: "insert", table: "approval_outbox" },
		]);
	});

	it("does not trust CommonJS or dynamic imports from unrelated modules", () => {
		const commonJs = `const { db, approvalRequest } = require("unrelated-db");
db.delete(approvalRequest);`;
		const moduleSource = `const database = await import("unrelated-db");
const schema = await import("unrelated-schema");
database.db.delete(schema.approvalRequest);`;

		expect(
			analyzeApprovalWriteMutations(commonJs, "/repo/scripts/unrelated.cjs"),
		).toEqual([]);
		expect(
			analyzeApprovalWriteMutations(
				moduleSource,
				"/repo/scripts/unrelated.mjs",
			),
		).toEqual([]);
	});
	it("reports named, renamed, namespace, alias, wrapped, and bracket-call mutations", () => {
		const source = `import {
	approvalRequest,
	approvalOutbox as outbox,
	db,
} from "@/db";
import * as schema from "@/db/schema";
const target = outbox;
db.insert(approvalRequest).values(value);
db["update"]((schema.approvalWorkflowStage as unknown)).set(value);
db.delete(target);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				line: 8,
				operation: "insert",
				table: "approval_request",
			},
			{
				column: 1,
				fileName: FILE_NAME,
				line: 9,
				operation: "update",
				table: "approval_workflow_stage",
			},
			{
				column: 1,
				fileName: FILE_NAME,
				line: 10,
				operation: "delete",
				table: "approval_outbox",
			},
		]);
	});

	it("does not treat a schema namespace as a database namespace receiver", () => {
		const source = `import * as schema from "@/db/schema";
import * as database from "@/db";
schema.db.execute("delete from approval_request");
database.db.execute("delete from approval_request");`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				line: 4,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it("recognizes every real protected schema symbol from its defining module", () => {
		const source = `import { approvalRequest } from "@/db/schema/approval";
import { approvalChainInstance, approvalChainStageInstance } from "@/db/schema/approval-policy";
import {
	approvalWorkflowRollout,
	approvalWorkflow,
	approvalWorkflowStage,
	approvalStageAssignment,
	approvalWorkflowEvent,
	approvalWorkflowCommand,
	approvalRequesterProjection,
	approvalInboxProjection,
	approvalOutbox,
	approvalOutboxDelivery,
	approvalWorkflowMigrationIssue,
} from "@/db/schema/approval-workflow";
import { db } from "@/db";
db.insert(approvalRequest);
db.insert(approvalChainInstance);
db.insert(approvalChainStageInstance);
db.insert(approvalWorkflowRollout);
db.insert(approvalWorkflow);
db.insert(approvalWorkflowStage);
db.insert(approvalStageAssignment);
db.insert(approvalWorkflowEvent);
db.insert(approvalWorkflowCommand);
db.insert(approvalRequesterProjection);
db.insert(approvalInboxProjection);
db.insert(approvalOutbox);
db.insert(approvalOutboxDelivery);
db.insert(approvalWorkflowMigrationIssue);`;

		expect(
			analyzeApprovalWriteMutations(source, FILE_NAME).map(
				({ table }) => table,
			),
		).toEqual([
			"approval_request",
			"approval_chain_instance",
			"approval_chain_stage_instance",
			"approval_workflow_rollout",
			"approval_workflow",
			"approval_workflow_stage",
			"approval_stage_assignment",
			"approval_workflow_event",
			"approval_workflow_command",
			"approval_requester_projection",
			"approval_inbox_projection",
			"approval_outbox",
			"approval_outbox_delivery",
			"approval_workflow_migration_issue",
		]);
	});

	it("models the exact chain-service updateRows helper through an alias", () => {
		const source = `import { approvalChainStageInstance } from "@/db/schema/approval-policy";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
async function updateRows(dbService: ApprovalDbService, table: unknown, values: unknown, where: unknown) {}
const writeRows = updateRows;
declare const dbService: ApprovalDbService;
writeRows(dbService, approvalChainStageInstance, values, where);`;

		expect(
			analyzeApprovalWriteMutations(source, CHAIN_SERVICE_FILE_NAME),
		).toEqual([
			{
				column: 1,
				fileName: CHAIN_SERVICE_FILE_NAME,
				line: 6,
				operation: "update",
				table: "approval_chain_stage_instance",
			},
		]);
	});

	it("does not trust unrelated local or imported updateRows helpers", () => {
		const localSource = `import { approvalRequest } from "@/db";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
function updateRows(dbService: ApprovalDbService, table: unknown) {}
declare const dbService: ApprovalDbService;
updateRows(dbService, approvalRequest);`;
		const importedSource = `import { approvalRequest } from "@/db";
import { updateRows } from "@/lib/database/helpers";
import * as helpers from "@/lib/database/helpers";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
declare const dbService: ApprovalDbService;
updateRows(dbService, approvalRequest);
helpers.updateRows(dbService, approvalRequest);`;

		expect(analyzeApprovalWriteMutations(localSource, FILE_NAME)).toEqual([]);
		expect(analyzeApprovalWriteMutations(importedSource, FILE_NAME)).toEqual(
			[],
		);
	});

	it("propagates protected tables through same-file function declarations", () => {
		const source = `import { approvalRequest, db } from "@/db";
function remove(table: unknown) {
	db.delete(table);
}
remove(approvalRequest);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 2,
				fileName: FILE_NAME,
				line: 3,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it("propagates conservatively through local functions, aliases, forwarding, and call sites", () => {
		const source = `import { approvalOutbox, approvalWorkflow, db } from "@/db";
const insertRow = function (table: unknown) { db.insert(table); };
const updateRow = (table: unknown) => db.update(table);
const updateAlias = updateRow;
function forward(table: unknown) { updateAlias(table); }
insertRow(approvalOutbox);
insertRow(unrelatedTable);
forward(approvalWorkflow);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 47,
				fileName: FILE_NAME,
				line: 2,
				operation: "insert",
				table: "approval_outbox",
			},
			{
				column: 39,
				fileName: FILE_NAME,
				line: 3,
				operation: "update",
				table: "approval_workflow",
			},
		]);
	});

	it("does not trust imported helpers or unrelated local mutation methods", () => {
		const source = `import { approvalRequest } from "@/db";
import { remove } from "./helpers";
function local(table: unknown) { formatter.delete(table); }
remove(approvalRequest);
local(approvalRequest);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([]);
	});

	it("recognizes bound Drizzle mutation methods but not arbitrary bind calls", () => {
		const source = `import { approvalOutbox, approvalRequest, approvalWorkflow, db } from "@/db";
const remove = db.delete.bind(db);
const insert = db.insert.bind(db);
const update = db.update.bind(db);
const unrelated = formatter.delete.bind(formatter);
remove(approvalRequest);
insert(approvalOutbox);
update(approvalWorkflow);
unrelated(approvalRequest);`;

		expect(
			analyzeApprovalWriteMutations(source, FILE_NAME).map(
				({ operation, table }) => ({ operation, table }),
			),
		).toEqual([
			{ operation: "delete", table: "approval_request" },
			{ operation: "insert", table: "approval_outbox" },
			{ operation: "update", table: "approval_workflow" },
		]);
	});

	it("fails closed at the same-file helper call-analysis limit", () => {
		const source = [
			'import { approvalRequest, db } from "@/db";',
			"function remove(table) { db.delete(table); }",
			...Array.from({ length: 4_097 }, () => "remove(approvalRequest);"),
		].join("\n");
		let error: unknown;

		try {
			analyzeApprovalWriteMutations(source, FILE_NAME);
		} catch (caught) {
			error = caught;
		}

		expect(error).toMatchObject({
			cause: {
				code: "APPROVAL_WRITE_BOUNDARY_ANALYSIS_LIMIT",
				limit: "typescript_helper_call_count",
			},
		});
	});

	it("tracks database receivers and SQL tags through supported aliases", () => {
		const source = `import { db as database } from "@/db";
import { sql as drizzleSql } from "drizzle-orm";
import * as drizzle from "drizzle-orm";
const receiver = database;
const tag = drizzleSql;
const namespaceTag = drizzle.sql;
const raw = tag.raw;
receiver.execute(tag\`insert into approval_workflow_event (id) values ('event-1')\`);
namespaceTag\`update approval_workflow_command set status = 'claimed'\`;
raw("delete " + "from approval_inbox_projection");`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 22,
				fileName: FILE_NAME,
				line: 8,
				operation: "insert",
				table: "approval_workflow_event",
			},
			{
				column: 14,
				fileName: FILE_NAME,
				line: 9,
				operation: "update",
				table: "approval_workflow_command",
			},
			{
				column: 1,
				fileName: FILE_NAME,
				line: 10,
				operation: "delete",
				table: "approval_inbox_projection",
			},
		]);
	});

	it("tracks qualified NodePgDatabase types and aliased pg Pool construction", () => {
		const source = `import type * as nodePg from "drizzle-orm/node-postgres";
import * as pg from "pg";
declare const database: nodePg.NodePgDatabase;
const pool = new pg.Pool();
const client = pool;
database.execute("update approval_workflow set version = version + 1");
client["query"]("delete from approval_request");`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				line: 6,
				operation: "update",
				table: "approval_workflow",
			},
			{
				column: 1,
				fileName: FILE_NAME,
				line: 7,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it.each([
		[
			"named alias construction",
			`import { Client as PgClient } from "pg";
const client = new PgClient();
client.query("delete from approval_request");`,
			FILE_NAME,
		],
		[
			"namespace construction",
			`import * as pg from "pg";
const client = new pg.Client();
client.query("delete from approval_request");`,
			FILE_NAME,
		],
		[
			"typed declaration",
			`import type { Client as PgClient } from "pg";
declare const client: PgClient;
client.query("delete from approval_request");`,
			FILE_NAME,
		],
		[
			"qualified typed declaration",
			`import type * as pg from "pg";
declare const client: pg.Client;
client.query("delete from approval_request");`,
			FILE_NAME,
		],
		[
			"CommonJS named construction",
			`const { Client: PgClient } = require("pg");
const client = new PgClient();
client.query("delete from approval_request");`,
			"/repo/apps/webapp/scripts/client.cjs",
		],
		[
			"CommonJS namespace construction",
			`const pg = require("pg");
const client = new pg.Client();
client.query("delete from approval_request");`,
			"/repo/apps/webapp/scripts/client.cjs",
		],
		[
			"dynamic namespace construction",
			`const pg = await import("pg");
const client = new pg.Client();
client.query("delete from approval_request");`,
			"/repo/apps/webapp/scripts/client.mjs",
		],
	] as const)("tracks a trusted pg Client receiver from %s", (_name, source, fileName) => {
		expect(
			analyzeApprovalWriteMutations(source, fileName).map(
				({ operation, table }) => ({ operation, table }),
			),
		).toEqual([{ operation: "delete", table: "approval_request" }]);
	});

	it("does not trust pg Client names from unrelated sources", () => {
		const source = `import { Client } from "unrelated-pg";
import * as pg from "unrelated-pg-namespace";
function LocalClient() {}
const importedClient = new Client();
const namespaceClient = new pg.Client();
const localClient = new LocalClient();
importedClient.query("delete from approval_request");
namespaceClient.query("delete from approval_request");
localClient.query("delete from approval_request");`;
		const commonJs = `const { Client } = require("unrelated-pg");
const client = new Client();
client.query("delete from approval_request");`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([]);
		expect(
			analyzeApprovalWriteMutations(
				commonJs,
				"/repo/apps/webapp/scripts/client.cjs",
			),
		).toEqual([]);
	});

	it.each([
		[
			"named alias factory",
			`import { drizzle as createDb } from "drizzle-orm/node-postgres";
import { approvalRequest } from "@/db";
const database = createDb(client);
database.delete(approvalRequest);`,
			FILE_NAME,
		],
		[
			"namespace factory",
			`import * as nodePg from "drizzle-orm/node-postgres";
import { approvalRequest } from "@/db";
const database = nodePg.drizzle(client);
database.delete(approvalRequest);`,
			FILE_NAME,
		],
		[
			"CommonJS factory",
			`const { drizzle: createDb } = require("drizzle-orm/node-postgres");
const { approvalRequest } = require("@/db");
const database = createDb(client);
database.delete(approvalRequest);`,
			"/repo/apps/webapp/scripts/database.cjs",
		],
		[
			"dynamic factory",
			`const { drizzle: createDb } = await import("drizzle-orm/node-postgres");
const { approvalRequest } = await import("@/db");
const database = createDb(client);
database.delete(approvalRequest);`,
			"/repo/apps/webapp/scripts/database.mjs",
		],
	] as const)("tracks a locally constructed Drizzle receiver from a trusted %s", (_name, source, fileName) => {
		expect(
			analyzeApprovalWriteMutations(source, fileName).map(
				({ operation, table }) => ({ operation, table }),
			),
		).toEqual([{ operation: "delete", table: "approval_request" }]);
	});

	it("does not trust local or unrelated drizzle factories", () => {
		const source = `import { drizzle as importedDrizzle } from "unrelated-drizzle";
import * as unrelated from "unrelated-drizzle-namespace";
import { approvalRequest } from "@/db";
function drizzle() { return formatter; }
const localDatabase = drizzle(client);
const importedDatabase = importedDrizzle(client);
const namespaceDatabase = unrelated.drizzle(client);
localDatabase.delete(approvalRequest);
importedDatabase.delete(approvalRequest);
namespaceDatabase.delete(approvalRequest);`;
		const commonJs = `const { drizzle } = require("unrelated-drizzle");
const { approvalRequest } = require("@/db");
const database = drizzle(client);
database.delete(approvalRequest);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([]);
		expect(
			analyzeApprovalWriteMutations(
				commonJs,
				"/repo/apps/webapp/scripts/database.cjs",
			),
		).toEqual([]);
	});

	it("keeps trusted typed database provenance across an opaque initializer", () => {
		const source = `import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { approvalRequest } from "@/db/schema/approval";
const database: NodePgDatabase = makeDb();
database.delete(approvalRequest);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				line: 4,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it("tracks destructuring assignment aliases and every target of a chained assignment", () => {
		const source = `import * as schema from "@/db/schema";
import { db } from "@/db";
let outbox;
let first;
let second;
({ approvalOutbox: outbox } = schema);
first = second = schema.approvalRequest;
db.delete(outbox);
db.update(first);
db.delete(second);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				line: 8,
				operation: "delete",
				table: "approval_outbox",
			},
			{
				column: 1,
				fileName: FILE_NAME,
				line: 9,
				operation: "update",
				table: "approval_request",
			},
			{
				column: 1,
				fileName: FILE_NAME,
				line: 10,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it("tracks a shorthand destructuring assignment alias", () => {
		const source = `import * as schema from "@/db/schema";
import { db } from "@/db";
let approvalRequest;
({ approvalRequest } = schema);
db.delete(approvalRequest);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 1,
				fileName: FILE_NAME,
				line: 5,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it.each([
		[
			"try/catch",
			`try { table = approvalRequest; }
catch { table = otherTable; }`,
		],
		[
			"switch",
			`switch (choice) {
	case "protected": table = approvalRequest; break;
	default: table = otherTable;
}`,
		],
		["short-circuit expression", "condition && (table = otherTable);"],
		[
			"conditional expression",
			"condition ? (table = approvalRequest) : (table = otherTable);",
		],
	] as const)("preserves possible protected provenance across %s writes", (_name, writes) => {
		const startsProtected = _name === "short-circuit expression";
		const source = `import { approvalRequest, db } from "@/db";
let table = ${startsProtected ? "approvalRequest" : "otherTable"};
${writes}
db.delete(table);`;
		const result = analyzeApprovalWriteMutations(source, FILE_NAME);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			operation: "delete",
			table: "approval_request",
		});
	});

	it("tracks database-service type aliases and destructured db parameters", () => {
		const source = `import type { ApprovalDbService } from "@/lib/approvals/server/types";
type Service = ApprovalDbService;
function mutate({ db: connection }: Service) {
	connection.execute("insert into approval_workflow_command (id) values ('command-1')");
}
function unrelated({ db }: { db: { execute(value: string): unknown } }) {
	db.execute("delete from approval_request");
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 2,
				fileName: FILE_NAME,
				line: 4,
				operation: "insert",
				table: "approval_workflow_command",
			},
		]);
	});

	it("tracks a nested database receiver from an exact ApprovalDbService parameter", () => {
		const source = `import { approvalRequest } from "@/db/schema";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
function cancelLegacyApprovalRows(dbService: ApprovalDbService) {
	dbService.db.delete(approvalRequest);
}
function unrelated(service: { db: { delete(table: unknown): unknown } }) {
	service.db.delete(approvalRequest);
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 2,
				fileName: FILE_NAME,
				line: 4,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it("tracks a database receiver asserted as the exact imported database type", () => {
		const source = `import { db } from "@/db";
import { approvalRequest } from "@/db/schema";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
function mutate(context: { dbService: ApprovalDbService }) {
	const database = context.dbService.db as typeof db;
	database.delete(approvalRequest);
}`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 2,
				fileName: FILE_NAME,
				line: 6,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it.each([
		[
			"ImportTypeNode NodePgDatabase",
			`import { approvalRequest } from "@/db";
declare const database: import("drizzle-orm/node-postgres").NodePgDatabase;
database.delete(approvalRequest);`,
			"delete",
			"approval_request",
		],
		[
			"qualified pg.Pool",
			`import type * as pg from "pg";
declare const pool: pg.Pool;
pool.query("update approval_workflow set version = version + 1");`,
			"update",
			"approval_workflow",
		],
		[
			"qualified pg.PoolClient",
			`import type * as pg from "pg";
declare const client: pg.PoolClient;
client.query("delete from approval_request");`,
			"delete",
			"approval_request",
		],
	] as const)("tracks a trusted %s receiver declaration", (_name, source, operation, table) => {
		const result = analyzeApprovalWriteMutations(source, FILE_NAME);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ operation, table });
	});

	it("substitutes a protected table into direct SQL passed to a trusted client", () => {
		const source = `import type { PoolClient } from "pg";
import { approvalRequest } from "@/db";
declare const client: PoolClient;
client.query(\`
  delete from \${approvalRequest}
\`);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 3,
				fileName: FILE_NAME,
				line: 5,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it("substitutes protected table provenance into constant SQL tags", () => {
		const source = `import { approvalOutbox, db } from "@/db";
import { sql } from "drizzle-orm";
const action = "insert into";
db.execute(sql\`\${action} \${approvalOutbox} (id) values ('outbox-1')\`);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 18,
				fileName: FILE_NAME,
				line: 4,
				operation: "insert",
				table: "approval_outbox",
			},
		]);
	});

	it.each([
		[
			"assignment",
			`import { db, timeEntry } from "@/db";
import { sql } from "drizzle-orm";
declare const assignment: string;
db.execute(sql\`update \${timeEntry} set \${assignment} where id = 'entry-1'\`);`,
			"update",
		],
		[
			"insert column list",
			`import { db } from "@/db";
declare const columns: string;
db.execute(\`insert into time_entry (\${columns}) values ('value')\`);`,
			"insert",
		],
		[
			"correction semantic",
			`import { db } from "@/db";
declare const entryType: string;
db.execute(\`insert into time_entry (type) values ('\${entryType}')\`);`,
			"insert",
		],
	] as const)("fails closed when dynamic raw SQL controls a protected source %s", (_name, source, operation) => {
		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				operation,
				table: "time_entry",
				uncertainty: "dynamic_sql",
			}),
		]);
	});

	it.each([
		[
			"assignment",
			`import { db } from "@/db";
declare const assignment: string;
db.execute("update time_entry set " + assignment + " where id = 'entry-1'");`,
			"update",
		],
		[
			"column list alias",
			`import { db } from "@/db";
declare const columns: string;
const statement = "insert into time_entry (" + columns + ") values ('value')";
db.execute(statement);`,
			"insert",
		],
		[
			"correction semantic",
			`import { db } from "@/db";
declare const entryType: string;
db.execute("insert into time_entry (type) values ('" + entryType + "')");`,
			"insert",
		],
	] as const)("fails closed for concatenated protected source SQL %s", (_name, source, operation) => {
		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				operation,
				table: "time_entry",
				uncertainty: "dynamic_sql",
			}),
		]);
	});

	it("does not mark ordinary dynamic SQL values as unresolved structure", () => {
		const source = `import { db } from "@/db";
declare const workflowId: string;
declare const note: string;
db.execute(\`update work_period set approval_workflow_id = '\${workflowId}' where id = 'period-1'\`);
db.execute(\`update work_period set notes = '\${note}' where id = 'period-1'\`);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			expect.objectContaining({
				columns: ["approval_workflow_id"],
				operation: "update",
				table: "work_period",
			}),
		]);
		expect(
			analyzeApprovalWriteMutations(source, FILE_NAME)[0],
		).not.toHaveProperty("uncertainty");
	});

	it("does not report shadowed imports, unrelated tables, helpers, or receivers", () => {
		const source = `import { approvalRequest, db } from "@/db";
function shadowed(approvalRequest: unknown) {
	db.delete(approvalRequest);
}
formatter.insert(approvalRequest);
db.update(approvalRequests);
updateRows(otherService, approvalRequest, values, where);
function updateRows() {}
const approvalOutbox = unrelatedTable;
db.delete(approvalOutbox);`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([]);
	});

	it("returns deterministic source ordering for repeated tagged SQL mutations", () => {
		const source = `import { sql } from "drizzle-orm";
sql\`delete from approval_outbox_delivery; insert into approval_outbox_delivery (id) values ('one'); delete from approval_outbox_delivery\`;`;

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 5,
				fileName: FILE_NAME,
				line: 2,
				operation: "delete",
				table: "approval_outbox_delivery",
			},
			{
				column: 43,
				fileName: FILE_NAME,
				line: 2,
				operation: "insert",
				table: "approval_outbox_delivery",
			},
			{
				column: 101,
				fileName: FILE_NAME,
				line: 2,
				operation: "delete",
				table: "approval_outbox_delivery",
			},
		]);
	});

	it("returns mutation-specific multiline raw SQL locations without collapsing repeats", () => {
		const source = [
			'import { sql } from "drizzle-orm";',
			"sql`",
			"select 1;",
			"  update approval_workflow set version = 2;",
			"delete from approval_request;",
			"  update approval_workflow set version = 3;",
			"`;",
		].join("\n");

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 3,
				fileName: FILE_NAME,
				line: 4,
				operation: "update",
				table: "approval_workflow",
			},
			{
				column: 1,
				fileName: FILE_NAME,
				line: 5,
				operation: "delete",
				table: "approval_request",
			},
			{
				column: 3,
				fileName: FILE_NAME,
				line: 6,
				operation: "update",
				table: "approval_workflow",
			},
		]);
	});

	it("maps cooked template offsets back to exact raw source positions", () => {
		const source = [
			'import { sql } from "drizzle-orm";',
			"sql`select '\\u{1F600}';",
			"  update approval_workflow set version = 2;",
			"`;",
		].join("\n");

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 3,
				fileName: FILE_NAME,
				line: 3,
				operation: "update",
				table: "approval_workflow",
			},
		]);
	});

	it("maps escaped sql.raw template offsets to exact raw source positions", () => {
		const source = [
			'import { sql } from "drizzle-orm";',
			"sql.raw(`select '\\u{1F600}';",
			"  delete from approval_request;",
			"`);",
		].join("\n");

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toEqual([
			{
				column: 3,
				fileName: FILE_NAME,
				line: 3,
				operation: "delete",
				table: "approval_request",
			},
		]);
	});

	it("fails closed on malformed TypeScript", () => {
		expect(() =>
			analyzeApprovalWriteMutations(
				'import { db } from "@/db"; db.delete(',
				FILE_NAME,
			),
		).toThrowError(/analysis parse error/);
	});

	it("fails closed with location and a dedicated cause at constant-analysis limits", () => {
		const source = [
			'import { sql } from "drizzle-orm";',
			'const sql0 = "delete from approval_request";',
			...Array.from(
				{ length: 128 },
				(_, index) => `const sql${index + 1} = sql${index};`,
			),
			"sql.raw(sql128);",
		].join("\n");
		let error: unknown;

		try {
			analyzeApprovalWriteMutations(source, FILE_NAME);
		} catch (caught) {
			error = caught;
		}

		expect(error).toMatchObject({
			cause: {
				code: "APPROVAL_WRITE_BOUNDARY_ANALYSIS_LIMIT",
				limit: "constant_evaluator_depth",
			},
			message: expect.stringContaining(`${FILE_NAME}:131:1`),
		});
	});

	it.each([
		[
			"template variant count",
			`import { sql } from "drizzle-orm";
import { approvalRequest, approvalOutbox, approvalWorkflow, approvalWorkflowEvent } from "@/db";
let table = approvalRequest;
if (a) table = approvalOutbox;
if (b) table = approvalWorkflow;
if (c) table = approvalWorkflowEvent;
sql\`select \${table}, \${table}, \${table}, \${table}, \${table}\`;`,
			"template_variant_count",
		],
		[
			"aggregate expanded SQL length",
			[
				'import { sql } from "drizzle-orm";',
				'const text0 = "x";',
				...Array.from(
					{ length: 16 },
					(_, index) => `const text${index + 1} = text${index} + text${index};`,
				),
				"sql`select $" + "{text16}`;",
			].join("\n"),
			"template_expanded_sql_length",
		],
	] as const)("fails closed at the %s", (_name, source, limit) => {
		let error: unknown;
		try {
			analyzeApprovalWriteMutations(source, FILE_NAME);
		} catch (caught) {
			error = caught;
		}

		expect(error).toMatchObject({
			cause: {
				code: "APPROVAL_WRITE_BOUNDARY_ANALYSIS_LIMIT",
				limit,
			},
		});
	});

	it.each([
		20, 24,
	] as const)("rejects a %i-level doubled constant before constructing its expansion", (level) => {
		const source = [
			'import { sql } from "drizzle-orm";',
			'const text0 = "x";',
			...Array.from(
				{ length: level },
				(_, index) => `const text${index + 1} = text${index} + text${index};`,
			),
			`sql.raw("delete from approval_request where id = '" + text${level} + "'");`,
		].join("\n");
		let error: unknown;

		try {
			analyzeApprovalWriteMutations(source, FILE_NAME);
		} catch (caught) {
			error = caught;
		}

		expect(error).toMatchObject({
			cause: {
				code: "APPROVAL_WRITE_BOUNDARY_ANALYSIS_LIMIT",
				limit: "constant_evaluator_output_length",
			},
		});
	});

	it("fails closed after a small deterministic reaching-write budget", () => {
		const source = [
			'import { approvalRequest, db } from "@/db";',
			"let table = unrelatedTable;",
			...Array.from(
				{ length: 257 },
				(_, index) => `if (condition${index}) table = approvalRequest;`,
			),
			"db.delete(table);",
		].join("\n");
		let error: unknown;

		try {
			analyzeApprovalWriteMutations(source, FILE_NAME);
		} catch (caught) {
			error = caught;
		}

		expect(error).toMatchObject({
			cause: {
				code: "APPROVAL_WRITE_BOUNDARY_ANALYSIS_LIMIT",
				limit: "typescript_reaching_write_count",
			},
		});
	});

	it("handles thousands of prior writes and uses within a practical bound", {
		timeout: 5_000,
	}, () => {
		const source = [
			'import { approvalRequest, db } from "@/db";',
			"let table = unrelatedTable;",
			...Array.from(
				{ length: 3_000 },
				(_, index) =>
					`table = ${index === 2_999 ? "approvalRequest" : "unrelatedTable"};`,
			),
			...Array.from({ length: 500 }, () => "db.delete(table);"),
		].join("\n");

		expect(analyzeApprovalWriteMutations(source, FILE_NAME)).toHaveLength(500);
	});
});

function withApprovalWriteTree(
	files: Readonly<Record<string, string>>,
	run: (workspaceRoot: string) => void,
): void {
	const workspaceRoot = mkdtempSync(join(tmpdir(), "approval-write-boundary-"));
	try {
		for (const [relativePath, source] of Object.entries(files)) {
			const fileName = join(workspaceRoot, relativePath);
			mkdirSync(dirname(fileName), { recursive: true });
			writeFileSync(fileName, source);
		}
		run(workspaceRoot);
	} finally {
		rmSync(workspaceRoot, { force: true, recursive: true });
	}
}

const WORKFLOW_INSERT = `import { approvalWorkflow, db } from "@/db";
db.insert(approvalWorkflow).values({});`;

describe("approval write boundary production ownership", () => {
	it("fails closed when a configured root is a symlink", () => {
		withApprovalWriteTree(
			{ "real-src/unowned.ts": WORKFLOW_INSERT },
			(workspaceRoot) => {
				symlinkSync(
					join(workspaceRoot, "real-src"),
					join(workspaceRoot, "linked-src"),
					"dir",
				);

				expect(
					scanApprovalWriteBoundary({
						roots: ["linked-src"],
						workspaceRoot,
					}),
				).toEqual([
					{
						column: 0,
						detail:
							"Configured approval write boundary root is a symbolic link.",
						error: "root",
						kind: "error",
						line: 0,
						path: "linked-src",
					},
				]);
			},
		);
	});

	it("fails closed before parsing a source over the per-file byte limit", () => {
		withApprovalWriteTree({}, (workspaceRoot) => {
			const fileName = join(workspaceRoot, "src/oversized.ts");
			mkdirSync(dirname(fileName), { recursive: true });
			writeFileSync(fileName, "");
			truncateSync(fileName, 2 * 1024 * 1024 + 1);

			expect(
				scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
			).toEqual([
				{
					column: 0,
					detail:
						"Approval write boundary per-file byte limit exceeded: 2097152.",
					error: "analysis",
					kind: "error",
					line: 0,
					path: "src/oversized.ts",
				},
			]);
		});
	});

	it("fails closed before parsing when the total source byte limit is exceeded", () => {
		withApprovalWriteTree({}, (workspaceRoot) => {
			for (let index = 0; index < 17; index += 1) {
				const fileName = join(workspaceRoot, "src", `${index}.ts`);
				mkdirSync(dirname(fileName), { recursive: true });
				writeFileSync(fileName, "");
				truncateSync(fileName, 2 * 1024 * 1024);
			}

			expect(
				scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
			).toEqual([
				{
					column: 0,
					detail:
						"Approval write boundary total source byte limit exceeded: 33554432.",
					error: "traversal",
					kind: "error",
					line: 0,
					path: ".",
				},
			]);
		});
	});

	it("fails closed before parsing when the production file-count limit is exceeded", {
		timeout: 15_000,
	}, () => {
		withApprovalWriteTree({}, (workspaceRoot) => {
			const sourceRoot = join(workspaceRoot, "src");
			mkdirSync(sourceRoot, { recursive: true });
			for (let index = 0; index < 4_097; index += 1) {
				writeFileSync(join(sourceRoot, `${index}.ts`), "");
			}

			expect(
				scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
			).toEqual([
				{
					column: 0,
					detail:
						"Approval write boundary production file-count limit exceeded: 4096.",
					error: "traversal",
					kind: "error",
					line: 0,
					path: ".",
				},
			]);
		});
	});

	it("detects an exact constant-composed SQL mutation", () => {
		const source = `import { sql } from "drizzle-orm";
const operation = "del" + "ete";
const target = "approval_" + "request";
const statement = operation + " fr" + "om " + target + " where id = 'request-1'";
sql.raw(statement);`;

		withApprovalWriteTree(
			{ "scripts/composed.mjs": source },
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["scripts"], workspaceRoot }),
				).toEqual([
					{
						column: 1,
						kind: "mutation",
						line: 5,
						operation: "delete",
						path: "scripts/composed.mjs",
						table: "approval_request",
					},
				]);
			},
		);
	});

	it.each([
		"js",
		"mjs",
		"cjs",
		"ts",
		"mts",
		"cts",
	] as const)("scans an unowned executable .%s production script", (extension) => {
		withApprovalWriteTree(
			{ [`scripts/unowned.${extension}`]: WORKFLOW_INSERT },
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["scripts"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({
						kind: "mutation",
						operation: "insert",
						path: `scripts/unowned.${extension}`,
						table: "approval_workflow",
					}),
				]);
			},
		);
	});

	it("allows only an exact normalized path, table, and operation entry", () => {
		withApprovalWriteTree(
			{
				"src/lib/approvals/workflow/repository.ts": WORKFLOW_INSERT,
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({
						roots: ["src/../src"],
						workspaceRoot,
					}),
				).toEqual([]);
			},
		);
	});

	it("rejects a permitted table in the wrong file", () => {
		withApprovalWriteTree(
			{ "src/lib/approvals/workflow/other.ts": WORKFLOW_INSERT },
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					{
						column: 1,
						kind: "mutation",
						line: 2,
						operation: "insert",
						path: "src/lib/approvals/workflow/other.ts",
						table: "approval_workflow",
					},
				]);
			},
		);
	});

	it("rejects an extra operation in a permitted file", () => {
		withApprovalWriteTree(
			{
				"src/lib/approvals/outbox/writer.ts": `import { approvalOutbox, db } from "@/db";
db.delete(approvalOutbox);`,
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					{
						column: 1,
						kind: "mutation",
						line: 2,
						operation: "delete",
						path: "src/lib/approvals/outbox/writer.ts",
						table: "approval_outbox",
					},
				]);
			},
		);
	});

	it("excludes exact test, spec, migration, generated, and symlink categories", () => {
		withApprovalWriteTree(
			{
				"drizzle/0055_guard_fixture.ts": WORKFLOW_INSERT,
				"scripts/__tests__/guard-fixture.ts": WORKFLOW_INSERT,
				"scripts/__specs__/guard-fixture.ts": WORKFLOW_INSERT,
				"scripts/guard-fixture.spec.ts": WORKFLOW_INSERT,
				"scripts/guard-fixture.test.ts": WORKFLOW_INSERT,
				"scripts/guard-fixture.spec.mjs": WORKFLOW_INSERT,
				"scripts/guard-fixture.test.js": WORKFLOW_INSERT,
				"src/db/auth-schema.ts": WORKFLOW_INSERT,
				"src/db/migrations/guard-fixture.ts": WORKFLOW_INSERT,
				"src/production-tests/guard-fixture.ts": WORKFLOW_INSERT,
			},
			(workspaceRoot) => {
				symlinkSync(
					join(workspaceRoot, "src/production-tests"),
					join(workspaceRoot, "src/symlinked-production"),
					"dir",
				);
				symlinkSync(
					join(workspaceRoot, "src/production-tests/guard-fixture.ts"),
					join(workspaceRoot, "scripts/symlinked-fixture.ts"),
					"file",
				);

				const findings = scanApprovalWriteBoundary({
					roots: ["src", "scripts", "drizzle"],
					workspaceRoot,
				});
				expect(findings).toEqual([
					expect.objectContaining({
						kind: "mutation",
						path: "src/production-tests/guard-fixture.ts",
					}),
				]);
			},
		);
	});

	it("does not inherit permission from a similar directory prefix", () => {
		withApprovalWriteTree(
			{
				"src/lib/approvals/workflow/repository.ts/fixture.ts": WORKFLOW_INSERT,
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({
						kind: "mutation",
						path: "src/lib/approvals/workflow/repository.ts/fixture.ts",
					}),
				]);
			},
		);
	});

	it("reports normalized path, table, operation, line, and column", () => {
		withApprovalWriteTree(
			{ "scripts/unowned.ts": `\n\n${WORKFLOW_INSERT}` },
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["scripts"], workspaceRoot }),
				).toEqual([
					{
						column: 1,
						kind: "mutation",
						line: 4,
						operation: "insert",
						path: "scripts/unowned.ts",
						table: "approval_workflow",
					},
				]);
			},
		);
	});

	it.each([
		["parse", 'import { approvalRequest, db } from "@/db"; db.delete('],
		[
			"analysis limit",
			[
				'import { approvalRequest, db } from "@/db";',
				"let table = unrelatedTable;",
				...Array.from(
					{ length: 257 },
					(_, index) => `if (condition${index}) table = approvalRequest;`,
				),
				"db.delete(table);",
			].join("\n"),
		],
	] as const)("fails closed on an analyzer %s failure", (_name, source) => {
		withApprovalWriteTree({ "src/broken.ts": source }, (workspaceRoot) => {
			const findings = scanApprovalWriteBoundary({
				roots: ["src"],
				workspaceRoot,
			});
			expect(findings).toHaveLength(1);
			expect(findings[0]).toMatchObject({
				kind: "error",
				path: "src/broken.ts",
			});
			expect(findings[0]).toHaveProperty("detail", expect.any(String));
		});
	});

	it.each([
		[
			"schema symbol",
			'import { approvalWorkflow } from "@/db";\nconst broken = (',
		],
		["table name", 'const table = "approval_workflow";\nconst broken = ('],
	] as const)("does not prefilter a malformed plausible protected write by %s", (_name, source) => {
		withApprovalWriteTree({ "src/plausible.ts": source }, (workspaceRoot) => {
			expect(
				scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
			).toEqual([
				expect.objectContaining({
					kind: "error",
					path: "src/plausible.ts",
				}),
			]);
		});
	});

	it("fails closed when a production source cannot be read", () => {
		withApprovalWriteTree(
			{ "src/unreadable.ts": WORKFLOW_INSERT },
			(workspaceRoot) => {
				const fileName = join(workspaceRoot, "src/unreadable.ts");
				chmodSync(fileName, 0);
				try {
					expect(
						scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
					).toEqual([
						{
							column: 0,
							detail: "Approval write boundary source read failed: EACCES.",
							error: "read",
							kind: "error",
							line: 0,
							path: "src/unreadable.ts",
						},
					]);
				} finally {
					chmodSync(fileName, 0o600);
				}
			},
		);
	});

	it("fails closed on invalid and escaping roots", () => {
		withApprovalWriteTree({}, (workspaceRoot) => {
			expect(
				scanApprovalWriteBoundary({
					roots: ["missing", "../outside"],
					workspaceRoot,
				}),
			).toEqual([
				expect.objectContaining({ kind: "error", path: "../outside" }),
				expect.objectContaining({ kind: "error", path: "missing" }),
			]);
		});
	});

	it("exports the complete exact canonical owner map", () => {
		expect(CANONICAL_WRITE_OWNERS).toEqual({
			"scripts/approval-workflow-rollout.ts": {
				approval_workflow_rollout: ["insert", "update"],
			},
			"src/lib/approvals/outbox/writer.ts": {
				approval_outbox: ["insert"],
			},
			"src/lib/approvals/projection/writer.ts": {
				approval_inbox_projection: ["insert", "update", "delete"],
				approval_requester_projection: ["insert", "update"],
			},
			"src/lib/approvals/workflow/compatibility-writer.ts": {
				approval_chain_instance: ["insert", "update"],
				approval_chain_stage_instance: ["insert", "update"],
				approval_request: ["insert", "update", "delete"],
				approval_workflow_stage: ["update"],
			},
			"src/lib/approvals/workflow/repository.ts": {
				approval_stage_assignment: ["insert", "update"],
				approval_workflow: ["insert", "update"],
				approval_workflow_command: ["insert", "update"],
				approval_workflow_event: ["insert"],
				approval_workflow_stage: ["insert", "update"],
			},
		});
	});

	it("exports the complete exact temporary legacy exception map", () => {
		expect(TEMPORARY_LEGACY_WRITE_EXCEPTIONS).toEqual({
			"src/app/[locale]/(app)/absences/mutations.ts": {
				approval_chain_instance: ["update"],
				approval_chain_stage_instance: ["update"],
				approval_request: ["delete"],
			},
			"src/lib/absences/sick-vacation-override.ts": {
				approval_request: ["insert", "update"],
			},
			"src/lib/approvals/policies/chain-service.ts": {
				approval_chain_instance: ["insert", "update"],
				approval_chain_stage_instance: ["insert", "update"],
				approval_request: ["insert"],
			},
			"src/lib/approvals/server/absence-approvals.ts": {
				approval_request: ["insert"],
			},
			"src/lib/approvals/server/shared.ts": {
				approval_request: ["update"],
			},
			"src/lib/demo/delete-non-admin.ts": {
				approval_request: ["delete"],
			},
			"src/lib/demo/demo-data.service.ts": {
				approval_request: ["insert"],
			},
			"src/lib/jobs/organization-cleanup.ts": {
				approval_request: ["delete"],
			},
			"src/lib/teams/jobs/escalation-checker.ts": {
				approval_request: ["update"],
			},
			"src/lib/time-record/migration/backfill.ts": {
				approval_request: ["update"],
			},
		});
	});

	it("exports exact function-scoped source write capabilities", () => {
		const boundary = approvalWriteBoundary as typeof approvalWriteBoundary & {
			CANONICAL_SOURCE_WRITE_OWNERS: unknown;
			SOURCE_WRITE_EXCEPTIONS: unknown;
		};
		expect(boundary.CANONICAL_SOURCE_WRITE_OWNERS).toEqual({
			"src/app/[locale]/(app)/time-tracking/actions.canonical.ts": [
				{
					columns: [
						"approval_state",
						"duration_minutes",
						"employee_id",
						"end_at",
						"organization_id",
						"start_at",
					],
					functionName: "createForCompletedPeriodInTransaction",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record",
				},
				{
					columns: [
						"computation_metadata",
						"organization_id",
						"record_id",
						"record_kind",
						"work_category_id",
						"work_location_type",
					],
					functionName: "createForCompletedPeriodInTransaction",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record_work",
				},
				{
					columns: [
						"allocation_kind",
						"organization_id",
						"project_id",
						"record_id",
						"weight_percent",
					],
					functionName: "createForCompletedPeriodInTransaction",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record_allocation",
				},
			],
			"src/lib/approvals/server/time-correction-approvals.ts": [
				{
					columns: ["approval_workflow_id"],
					functionName: "bindTimeCorrectionWorkflowToWorkPeriod",
					operation: "update",
					table: "work_period",
				},
				{
					columns: ["is_superseded", "superseded_by_id"],
					functionName: "finalizeTimeCorrectionTerminalDetailedInTransaction",
					operation: "update",
					semantic: "correction_lifecycle",
					table: "time_entry",
				},
				{
					columns: [
						"is_superseded",
						"replaces_entry_id",
						"superseded_by_id",
						"type",
					],
					functionName: "insertTimeCorrectionSourceEntry",
					operation: "insert",
					semantic: "correction",
					table: "time_entry",
				},
				{
					columns: [
						"is_superseded",
						"replaces_entry_id",
						"superseded_by_id",
						"type",
					],
					functionName: "deleteCancelledTimeCorrectionsInTransaction",
					operation: "delete",
					semantic: "inactive_correction",
					table: "time_entry",
				},
				{
					columns: ["duration_minutes", "end_at", "start_at"],
					functionName: "finalizeTimeCorrectionTerminalDetailedInTransaction",
					operation: "update",
					semantic: "ordinary_finalization",
					table: "time_record",
				},
				{
					columns: ["duration_minutes", "end_at", "start_at"],
					functionName: "syncCanonicalWorkCorrection",
					operation: "update",
					semantic: "ordinary_finalization",
					table: "time_record",
				},
			],
			"src/lib/absences/sick-vacation-override.ts": [
				{
					columns: [
						"approval_state",
						"duration_minutes",
						"employee_id",
						"end_at",
						"organization_id",
						"start_at",
					],
					functionName: "createCanonicalAbsenceInTransaction",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record",
				},
				{
					columns: ["duration_minutes", "end_at", "start_at"],
					functionName: "updateCanonicalAbsenceRangeInTransaction",
					operation: "update",
					semantic: "ordinary_finalization",
					table: "time_record",
				},
				{
					columns: ["approval_state"],
					functionName: "rejectCanonicalAbsenceInTransaction",
					operation: "update",
					semantic: "ordinary_finalization",
					table: "time_record",
				},
			],
			"src/lib/approvals/server/absence-approvals.ts": [
				{
					columns: ["approval_state"],
					functionName: "syncCanonicalAbsenceApprovalStateAt",
					operation: "update",
					semantic: "ordinary_finalization",
					table: "time_record",
				},
			],
			"src/lib/approvals/server/time-correction-submission.ts": [
				{
					columns: [
						"is_superseded",
						"replaces_entry_id",
						"superseded_by_id",
						"type",
					],
					functionName: "submitCorrection",
					operation: "delete",
					semantic: "inactive_correction",
					table: "time_entry",
				},
			],
			"src/lib/approvals/server/work-period-submission.ts": [
				{
					columns: [
						"approval_status",
						"canonical_record_id",
						"clock_in_id",
						"clock_out_id",
						"duration_minutes",
						"end_time",
						"pending_changes",
						"start_time",
					],
					functionName: "insertOrdinaryWorkPeriodSourceInTransaction",
					operation: "insert",
					table: "work_period",
				},
				{
					columns: ["approval_workflow_id"],
					functionName: "bindSourceWorkflow",
					operation: "update",
					table: "work_period",
				},
			],
			"src/lib/approvals/server/work-period-approvals.ts": [
				{
					columns: ["approval_status", "pending_changes"],
					functionName: "finalizeOrdinaryWorkPeriodTerminal",
					operation: "update",
					table: "work_period",
				},
				{
					columns: ["approval_state"],
					functionName: "finalizeOrdinaryWorkPeriodTerminal",
					operation: "update",
					semantic: "ordinary_finalization",
					table: "time_record",
				},
			],
			"src/lib/time-tracking/policy-clock-out-terminal-break.ts": [
				{
					columns: ["type"],
					functionName: "applyPolicyClockOutTerminalBreakInTransaction",
					operation: "insert",
					semantic: "synthetic_time_entry",
					table: "time_entry",
				},
				{
					columns: ["clock_out_id", "duration_minutes", "end_time"],
					functionName: "applyPolicyClockOutTerminalBreakInTransaction",
					operation: "update",
					semantic: "policy_clock_out_terminal_break",
					table: "work_period",
				},
				{
					columns: ["duration_minutes", "end_at"],
					functionName: "applyPolicyClockOutTerminalBreakInTransaction",
					operation: "update",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record",
				},
				{
					columns: [
						"approval_state",
						"duration_minutes",
						"employee_id",
						"end_at",
						"organization_id",
						"start_at",
					],
					functionName: "applyPolicyClockOutTerminalBreakInTransaction",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record",
				},
				{
					columns: [
						"computation_metadata",
						"organization_id",
						"record_id",
						"record_kind",
						"work_category_id",
						"work_location_type",
					],
					functionName: "applyPolicyClockOutTerminalBreakInTransaction",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record_work",
				},
				{
					columns: [
						"allocation_kind",
						"cost_center_id",
						"created_at",
						"id",
						"organization_id",
						"project_id",
						"record_id",
						"weight_percent",
					],
					functionName: "applyPolicyClockOutTerminalBreakInTransaction",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record_allocation",
				},
				{
					columns: [
						"approval_status",
						"approval_workflow_id",
						"canonical_record_id",
						"clock_in_id",
						"clock_out_id",
						"duration_minutes",
						"end_time",
						"pending_changes",
						"start_time",
					],
					functionName: "applyPolicyClockOutTerminalBreakInTransaction",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "work_period",
				},
			],
			"src/lib/effect/services/time-entry.service.ts": [
				{
					columns: ["is_superseded", "replaces_entry_id", "type"],
					functionName: "applyCorrectionWritesInTransaction",
					operation: "insert",
					semantic: "correction",
					table: "time_entry",
				},
				{
					columns: ["is_superseded", "superseded_by_id"],
					functionName: "applyCorrectionWritesInTransaction",
					operation: "update",
					semantic: "correction_lifecycle",
					table: "time_entry",
				},
				{
					columns: [
						"clock_in_id",
						"clock_out_id",
						"duration_minutes",
						"end_time",
						"start_time",
					],
					functionName: "applyCorrectionWritesInTransaction",
					operation: "update",
					table: "work_period",
				},
				{
					columns: ["duration_minutes", "end_at", "start_at"],
					functionName: "applyCorrectionWritesInTransaction",
					operation: "update",
					semantic: "ordinary_finalization",
					table: "time_record",
				},
			],
			"src/lib/effect/services/time-record.service.ts": [
				{
					columns: [
						"approval_state",
						"duration_minutes",
						"employee_id",
						"end_at",
						"organization_id",
						"start_at",
					],
					functionName: "createTimeRecord",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record",
				},
			],
		});
		expect(boundary.SOURCE_WRITE_EXCEPTIONS).toEqual({
			"src/app/[locale]/(app)/absences/actions.canonical.ts": [
				{
					columns: [],
					functionName: "create",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record",
					uncertainty: "dynamic_payload",
				},
				{
					columns: ["duration_minutes", "end_at", "start_at"],
					functionName: "updateCanonicalAbsenceRangeInTransaction",
					operation: "update",
					semantic: "ordinary_finalization",
					table: "time_record",
				},
				{
					columns: ["approval_state"],
					functionName: "syncCanonicalAbsenceApprovalStateInTransaction",
					operation: "update",
					semantic: "ordinary_finalization",
					table: "time_record",
				},
			],
			"src/app/[locale]/(app)/absences/request-absence-effect.ts": [
				{
					columns: [],
					functionName: "createRecords",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record",
					uncertainty: "dynamic_payload",
				},
			],
			"src/app/[locale]/(app)/team/absences/actions.ts": [
				{
					columns: [],
					functionName: "recordAbsenceForEmployee",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record",
					uncertainty: "dynamic_payload",
				},
			],
			"src/app/[locale]/(app)/time-tracking/actions.ts": [
				{
					columns: ["is_superseded", "superseded_by_id"],
					functionName: "splitWorkPeriod",
					operation: "update",
					semantic: "correction_lifecycle",
					table: "time_entry",
				},
				{
					columns: ["clock_out_id", "duration_minutes", "end_time"],
					functionName: "splitWorkPeriod",
					operation: "update",
					table: "work_period",
				},
				{
					columns: [
						"clock_in_id",
						"clock_out_id",
						"duration_minutes",
						"end_time",
						"start_time",
					],
					functionName: "splitWorkPeriod",
					operation: "insert",
					table: "work_period",
				},
			],
			"src/app/[locale]/(app)/time-tracking/actions/clocking.ts": [
				{
					columns: [
						"approval_status",
						"clock_out_id",
						"duration_minutes",
						"end_time",
						"pending_changes",
					],
					functionName: "addBreakToActiveSession",
					operation: "update",
					table: "work_period",
				},
				{
					columns: ["clock_in_id", "start_time"],
					functionName: "addBreakToActiveSession",
					operation: "insert",
					table: "work_period",
				},
			],
			"src/app/[locale]/(app)/time-tracking/actions/entry-helpers.ts": [
				{
					columns: ["is_superseded", "replaces_entry_id", "type"],
					functionName: "createTimeEntry",
					operation: "insert",
					semantic: "correction_lifecycle",
					table: "time_entry",
				},
				{
					columns: ["is_superseded", "superseded_by_id"],
					functionName: "markTimeEntrySuperseded",
					operation: "update",
					semantic: "correction_lifecycle",
					table: "time_entry",
				},
			],
			"src/app/[locale]/(app)/time-tracking/actions/mutations.ts": [
				{
					columns: ["is_superseded", "superseded_by_id"],
					functionName: "splitWorkPeriod",
					operation: "update",
					semantic: "correction_lifecycle",
					table: "time_entry",
				},
				{
					columns: ["clock_out_id", "duration_minutes", "end_time"],
					functionName: "splitWorkPeriod",
					operation: "update",
					table: "work_period",
				},
				{
					columns: [
						"clock_in_id",
						"clock_out_id",
						"duration_minutes",
						"end_time",
						"start_time",
					],
					functionName: "splitWorkPeriod",
					operation: "insert",
					table: "work_period",
				},
			],
			"src/lib/approvals/server/time-correction-approvals.ts": [
				{
					columns: [
						"clock_in_id",
						"clock_out_id",
						"duration_minutes",
						"end_time",
						"start_time",
					],
					functionName: "finalizeTimeCorrectionTerminalDetailedInTransaction",
					operation: "update",
					table: "work_period",
				},
			],
			"src/lib/clockin/import-orchestrator.ts": [
				{
					columns: [],
					functionName: "insertTimeEntry",
					operation: "insert",
					table: "time_entry",
					uncertainty: "dynamic_payload",
				},
				{
					columns: [],
					functionName: "insertWorkPeriod",
					operation: "insert",
					table: "work_period",
					uncertainty: "dynamic_payload",
				},
			],
			"src/lib/clockodo/import-orchestrator.ts": [
				{
					columns: [],
					functionName: "importClockodoData",
					operation: "insert",
					table: "time_entry",
					uncertainty: "dynamic_payload",
				},
				{
					columns: [],
					functionName: "importClockodoData",
					operation: "insert",
					table: "work_period",
					uncertainty: "dynamic_payload",
				},
			],
			"src/lib/demo/demo-data.service.ts": [
				{
					columns: [
						"is_superseded",
						"replaces_entry_id",
						"superseded_by_id",
						"type",
					],
					functionName: "generateDemoPendingTimeCorrectionApprovals",
					operation: "delete",
					semantic: "inactive_correction",
					table: "time_entry",
				},
				{
					columns: ["type"],
					functionName: "generateDemoTimeEntries",
					operation: "insert",
					table: "time_entry",
					uncertainty: "dynamic_payload",
				},
				{
					columns: [
						"clock_in_id",
						"clock_out_id",
						"duration_minutes",
						"end_time",
						"start_time",
					],
					functionName: "generateDemoTimeEntries",
					operation: "insert",
					table: "work_period",
				},
			],
			"src/lib/effect/services/break-enforcement.service.ts": [
				{
					columns: ["type"],
					functionName: "createBreakTimeEntry",
					operation: "insert",
					table: "time_entry",
					uncertainty: "dynamic_payload",
				},
				{
					columns: ["clock_out_id", "duration_minutes", "end_time"],
					functionName: "enforceBreaksAfterClockOutInternal",
					operation: "update",
					table: "work_period",
				},
				{
					columns: [
						"clock_in_id",
						"clock_out_id",
						"duration_minutes",
						"end_time",
						"start_time",
					],
					functionName: "enforceBreaksAfterClockOutInternal",
					operation: "insert",
					table: "work_period",
				},
			],
			"src/lib/import-review/committers.ts": [
				{
					columns: ["type"],
					functionName: "commitWorkPeriod",
					operation: "insert",
					table: "time_entry",
					uncertainty: "dynamic_payload",
				},
				{
					columns: [
						"clock_in_id",
						"clock_out_id",
						"duration_minutes",
						"end_time",
						"start_time",
					],
					functionName: "commitWorkPeriod",
					operation: "insert",
					table: "work_period",
				},
			],
			"src/lib/time-record/migration/backfill.ts": [
				{
					columns: ["canonical_record_id"],
					functionName: "runCanonicalBackfill",
					operation: "update",
					table: "work_period",
				},
				{
					columns: [],
					functionName: "insertIfPresent",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record",
					uncertainty: "dynamic_payload",
				},
				{
					columns: [],
					functionName: "insertIfPresent",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record_work",
					uncertainty: "dynamic_payload",
				},
				{
					columns: [],
					functionName: "runCanonicalBackfill",
					operation: "insert",
					semantic: "policy_clock_out_terminal_break",
					table: "time_record_allocation",
					uncertainty: "dynamic_payload",
				},
			],
			"src/lib/time-tracking/clocking-service.ts": [
				{
					columns: [],
					functionName: "insertEntry",
					operation: "insert",
					table: "time_entry",
					uncertainty: "dynamic_payload",
				},
				{
					columns: [],
					functionName: "insertActivePeriod",
					operation: "insert",
					table: "work_period",
					uncertainty: "dynamic_payload",
				},
				{
					columns: [],
					functionName: "closeActivePeriod",
					operation: "update",
					table: "work_period",
					uncertainty: "dynamic_payload",
				},
			],
		});
	});

	it("allows a source write only for its exact declared function capability", () => {
		withApprovalWriteTree(
			{
				"src/lib/approvals/server/time-correction-approvals.ts":
					'import { db, workPeriod } from "@/db";\nexport function bindTimeCorrectionWorkflowToWorkPeriod() { return db.update(workPeriod).set({ approvalWorkflowId: "workflow-1" }); }\nexport function hiddenBinding() { return db.update(workPeriod).set({ approvalWorkflowId: "workflow-2" }); }',
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({
						columns: ["approval_workflow_id"],
						functionName: "hiddenBinding",
						kind: "mutation",
						table: "work_period",
					}),
				]);
			},
		);
	});

	it.each([
		["renamed owner", "finalizeOrdinaryWorkPeriodTerminalWrong"],
		["endpoint owner", "POST"],
	] as const)("rejects an ordinary finalization from a %s", (_label, functionName) => {
		const path =
			functionName === "POST"
				? "src/app/api/approvals/finalize/route.ts"
				: "src/lib/approvals/server/work-period-approvals.ts";
		withApprovalWriteTree(
			{
				[path]: `import { db, workPeriod } from "@/db";
export function ${functionName}() {
  return db.update(workPeriod).set({ approvalStatus: "approved", pendingChanges: null });
}`,
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({
						functionName,
						path,
						table: "work_period",
					}),
				]);
			},
		);
	});

	it("rejects a dynamic payload and a new bypass file while allowing the exact finalizer", () => {
		const ownerPath = "src/lib/approvals/server/work-period-approvals.ts";
		withApprovalWriteTree(
			{
				[ownerPath]: `import { db, workPeriod } from "@/db";
export function finalizeOrdinaryWorkPeriodTerminal() {
  return db.update(workPeriod).set({ approvalStatus: "approved", pendingChanges: null });
}
export function dynamicFinalizer(patch: object) {
  return db.update(workPeriod).set(patch);
}`,
				"src/lib/approvals/server/work-period-finalization-bypass.ts":
					'import { db, workPeriod } from "@/db"; export function bypass() { return db.update(workPeriod).set({ approvalWorkflowId: "workflow" }); }',
			},
			(workspaceRoot) => {
				const findings = scanApprovalWriteBoundary({
					roots: ["src"],
					workspaceRoot,
				});
				expect(findings).toEqual([
					expect.objectContaining({
						functionName: "dynamicFinalizer",
						path: ownerPath,
						uncertainty: "dynamic_payload",
					}),
					expect.objectContaining({
						functionName: "bypass",
						path: "src/lib/approvals/server/work-period-finalization-bypass.ts",
					}),
				]);
			},
		);
	});

	it("allows only exact canonical finalizer and terminal-split Drizzle owners", () => {
		const finalizerPath = "src/lib/approvals/server/work-period-approvals.ts";
		const splitPath =
			"src/lib/time-tracking/policy-clock-out-terminal-break.ts";
		withApprovalWriteTree(
			{
				[finalizerPath]: `import { db, timeRecord } from "@/db";
export function finalizeOrdinaryWorkPeriodTerminal() {
  return db.update(timeRecord).set({ approvalState: "approved" });
}
export function renamedFinalizer() {
  return db.update(timeRecord).set({ approvalState: "approved" });
}`,
				[splitPath]: `import { db, timeRecord, timeRecordWork, timeRecordAllocation } from "@/db";
export function applyPolicyClockOutTerminalBreakInTransaction(dynamic: object) {
  db.insert(timeRecord).values({ organizationId, employeeId, startAt, endAt, durationMinutes, approvalState: "approved" });
  db.insert(timeRecordWork).values({ recordId, organizationId, recordKind: "work", workCategoryId, workLocationType, computationMetadata });
  db.insert(timeRecordAllocation).values({ id, organizationId, recordId, allocationKind, projectId, costCenterId, weightPercent, createdAt });
  db.insert(timeRecordAllocation).values(dynamic);
}
export function wrongSplitOwner() {
  return db.insert(timeRecordWork).values({ recordId, organizationId, recordKind: "work", workCategoryId, workLocationType, computationMetadata });
}`,
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({
						functionName: "renamedFinalizer",
						path: finalizerPath,
						table: "time_record",
					}),
					expect.objectContaining({
						functionName: "applyPolicyClockOutTerminalBreakInTransaction",
						path: splitPath,
						table: "time_record_allocation",
						uncertainty: "dynamic_payload",
					}),
					expect.objectContaining({
						functionName: "wrongSplitOwner",
						path: splitPath,
						table: "time_record_work",
					}),
				]);
			},
		);
	});

	it("allows only exact injected creation and correction owners", () => {
		const canonicalPath =
			"src/app/[locale]/(app)/time-tracking/actions.canonical.ts";
		const correctionPath = "src/lib/effect/services/time-entry.service.ts";
		const recordPath = "src/lib/effect/services/time-record.service.ts";
		withApprovalWriteTree(
			{
				[canonicalPath]: `import { db, timeRecord } from "@/db";
export function createForCompletedPeriodInTransaction() {
  return db.insert(timeRecord).values({ organizationId, employeeId, startAt, endAt, durationMinutes, approvalState: "approved" });
}
export function wrongCompletedPeriodOwner() {
  return db.insert(timeRecord).values({ organizationId, employeeId, startAt, endAt, durationMinutes, approvalState: "approved" });
}`,
				[correctionPath]: `import { db, workPeriod } from "@/db";
export function applyCorrectionWritesInTransaction() {
  return db.update(workPeriod).set({ clockInId, clockOutId, startTime, endTime, durationMinutes });
}
export function dynamicCorrectionOwner(patch: object) {
  return db.update(workPeriod).set(patch);
}`,
				[recordPath]: `import { db, timeRecord } from "@/db";
export function createTimeRecord() {
  return db.insert(timeRecord).values({ organizationId, employeeId, startAt, endAt, durationMinutes, approvalState: "approved" });
}
export function renamedCreateTimeRecord() {
  return db.insert(timeRecord).values({ organizationId, employeeId, startAt, endAt, durationMinutes, approvalState: "approved" });
}`,
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({
						functionName: "wrongCompletedPeriodOwner",
						path: canonicalPath,
					}),
					expect.objectContaining({
						functionName: "dynamicCorrectionOwner",
						path: correctionPath,
						uncertainty: "dynamic_payload",
					}),
					expect.objectContaining({
						functionName: "renamedCreateTimeRecord",
						path: recordPath,
					}),
				]);
			},
		);
	});

	it("does not let a concrete canonical owner absorb an unresolved source write", () => {
		withApprovalWriteTree(
			{
				"src/lib/approvals/server/time-correction-approvals.ts":
					'import { db, workPeriod } from "@/db";\nexport function bindTimeCorrectionWorkflowToWorkPeriod(patch: object) { return db.update(workPeriod).set({ approvalWorkflowId: "workflow-1", ...patch }); }',
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({
						columns: ["approval_workflow_id"],
						functionName: "bindTimeCorrectionWorkflowToWorkPeriod",
						kind: "mutation",
						table: "work_period",
						uncertainty: "dynamic_payload",
					}),
				]);
			},
		);
	});

	it("allows only an exact uncertainty-bearing source exception", () => {
		const path =
			"src/app/[locale]/(app)/time-tracking/actions/entry-helpers.ts";
		const capabilities = SOURCE_WRITE_EXCEPTIONS[path] as unknown as Array<
			Record<string, unknown>
		>;
		const original = capabilities[0];
		const source =
			'import { db, timeEntry } from "@/db";\nexport function createTimeEntry(extra: object) { return db.insert(timeEntry).values({ type: "manual", replacesEntryId: "entry-1", isSuperseded: false, ...extra }); }';
		withApprovalWriteTree({ [path]: source }, (workspaceRoot) => {
			const scan = () =>
				scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot });
			try {
				expect(scan()).toEqual([
					expect.objectContaining({ uncertainty: "dynamic_payload" }),
				]);

				capabilities[0] = { ...original, uncertainty: "dynamic_sql" };
				expect(scan()).toEqual([
					expect.objectContaining({ uncertainty: "dynamic_payload" }),
				]);

				capabilities[0] = { ...original, uncertainty: "dynamic_payload" };
				expect(scan()).toEqual([]);
			} finally {
				capabilities[0] = original;
			}
		});
	});

	it("keeps Clockodo uncertainty exceptions scoped to their named helper", () => {
		const path = "src/lib/clockodo/import-orchestrator.ts";
		const source = `import { db, timeEntry } from "@/db";
export async function importClockodoData(values: object) {
  return db.transaction(async (tx) => tx.insert(timeEntry).values(values));
}
export async function hiddenImport(values: object) {
  return db.transaction(async (tx) => tx.insert(timeEntry).values(values));
}`;

		withApprovalWriteTree({ [path]: source }, (workspaceRoot) => {
			expect(
				scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
			).toEqual([
				expect.objectContaining({
					functionName: "hiddenImport",
					path,
					table: "time_entry",
					uncertainty: "dynamic_payload",
				}),
			]);
		});
	});

	it("retains only the complete analyzer-proven direct absence exceptions", () => {
		const analyzeOperations = (relativePath: string) => {
			const fileName = join(process.cwd(), relativePath);
			return analyzeApprovalWriteMutations(
				readFileSync(fileName, "utf8"),
				fileName,
			).map(({ operation, table }) => ({ operation, table }));
		};

		expect(
			analyzeOperations("src/lib/approvals/server/absence-approvals.ts"),
		).toEqual([
			{ operation: "update", table: "time_record" },
			{ operation: "insert", table: "approval_request" },
		]);
		expect(
			analyzeOperations("src/app/[locale]/(app)/absences/mutations.ts"),
		).toEqual([
			{ operation: "update", table: "approval_chain_stage_instance" },
			{ operation: "update", table: "approval_chain_instance" },
			{ operation: "delete", table: "approval_request" },
		]);
	});

	it("keeps ownerless canonical tables deny-all", () => {
		withApprovalWriteTree(
			{
				"src/unowned-delivery.ts":
					'import { approvalOutboxDelivery, db } from "@/db";\ndb.insert(approvalOutboxDelivery);',
				"src/unowned-migration-issue.ts":
					'import { approvalWorkflowMigrationIssue, db } from "@/db";\ndb.insert(approvalWorkflowMigrationIssue);',
			},
			(workspaceRoot) => {
				expect(
					scanApprovalWriteBoundary({ roots: ["src"], workspaceRoot }),
				).toEqual([
					expect.objectContaining({
						kind: "mutation",
						path: "src/unowned-delivery.ts",
						table: "approval_outbox_delivery",
					}),
					expect.objectContaining({
						kind: "mutation",
						path: "src/unowned-migration-issue.ts",
						table: "approval_workflow_migration_issue",
					}),
				]);
			},
		);
	});

	it("has no unowned protected writes in the current webapp inventory", () => {
		expect(
			scanApprovalWriteBoundary({
				roots: ["src", "scripts"],
				workspaceRoot: process.cwd(),
			}),
		).toEqual([]);
	}, 60_000);

	it("keeps every declared exact owner and exception backed by a production write", () => {
		const inventory = scanApprovalWriteInventory({
			roots: ["src", "scripts"],
			workspaceRoot: process.cwd(),
		});
		const actual = new Set(
			inventory
				.filter((finding) => finding.kind === "mutation")
				.map((finding) =>
					finding.table === "time_entry" ||
					finding.table === "work_period" ||
					finding.table === "time_record" ||
					finding.table === "time_record_work" ||
					finding.table === "time_record_allocation"
						? `${finding.path}\0${finding.table}\0${finding.operation}\0${finding.functionName ?? ""}\0${finding.columns?.join(",") ?? ""}\0${finding.semantic ?? ""}\0${finding.uncertainty ?? ""}`
						: `${finding.path}\0${finding.table}\0${finding.operation}`,
				),
		);
		const declaredApproval = [
			...Object.entries(CANONICAL_WRITE_OWNERS),
			...Object.entries(TEMPORARY_LEGACY_WRITE_EXCEPTIONS),
		].flatMap(([path, tables]) =>
			Object.entries(tables).flatMap(([table, operations]) =>
				operations.map((operation) => `${path}\0${table}\0${operation}`),
			),
		);
		const declaredSource = [
			...Object.entries(CANONICAL_SOURCE_WRITE_OWNERS),
			...Object.entries(SOURCE_WRITE_EXCEPTIONS),
		].flatMap(([path, capabilities]) =>
			capabilities.map(
				(capability) =>
					`${path}\0${capability.table}\0${capability.operation}\0${"functionName" in capability ? capability.functionName : ""}\0${capability.columns.join(",")}\0${"semantic" in capability ? capability.semantic : ""}\0${"uncertainty" in capability ? capability.uncertainty : ""}`,
			),
		);

		expect(inventory.filter((finding) => finding.kind === "error")).toEqual([]);
		expect([...actual].sort()).toEqual(
			[...declaredApproval, ...declaredSource].sort(),
		);
	}, 60_000);

	it("detects every required injected production mutation site", () => {
		const expected = [
			{
				path: "src/app/[locale]/(app)/time-tracking/actions.canonical.ts",
				functionName: "createForCompletedPeriodInTransaction",
				table: "time_record",
				operation: "insert",
			},
			{
				path: "src/app/[locale]/(app)/time-tracking/actions.canonical.ts",
				functionName: "createForCompletedPeriodInTransaction",
				table: "time_record_work",
				operation: "insert",
			},
			{
				path: "src/app/[locale]/(app)/time-tracking/actions.canonical.ts",
				functionName: "createForCompletedPeriodInTransaction",
				table: "time_record_allocation",
				operation: "insert",
			},
			{
				path: "src/lib/effect/services/time-entry.service.ts",
				functionName: "applyCorrectionWritesInTransaction",
				table: "work_period",
				operation: "update",
			},
			{
				path: "src/lib/effect/services/time-entry.service.ts",
				functionName: "applyCorrectionWritesInTransaction",
				table: "time_record",
				operation: "update",
			},
			{
				path: "src/lib/effect/services/time-record.service.ts",
				functionName: "createTimeRecord",
				table: "time_record",
				operation: "insert",
			},
		] as const;
		const byPath = new Map<
			string,
			ReturnType<typeof analyzeApprovalWriteMutations>
		>();

		for (const site of expected) {
			let mutations = byPath.get(site.path);
			if (!mutations) {
				const fileName = join(process.cwd(), site.path);
				mutations = analyzeApprovalWriteMutations(
					readFileSync(fileName, "utf8"),
					fileName,
				);
				byPath.set(site.path, mutations);
			}
			expect(mutations).toContainEqual(
				expect.objectContaining({
					functionName: site.functionName,
					operation: site.operation,
					table: site.table,
				}),
			);
		}
	});

	it("does not grant actions, handlers, inbox, bot, or routes ordinary owner capabilities", () => {
		const forbiddenOwners = [
			"src/app/[locale]/(app)/time-tracking/actions.ts",
			"src/app/[locale]/(app)/time-tracking/actions/approvals.ts",
			"src/app/[locale]/(app)/time-tracking/actions/corrections.ts",
			"src/app/api/approvals/route.ts",
			"src/app/api/time-entries/corrections/route.ts",
			"src/lib/approvals/handlers/time-correction.handler.ts",
			"src/lib/approvals/inbox/decision-service.ts",
			"src/lib/bot/commands/clock-out.ts",
			"src/lib/approvals/server/time-correction-cancellation.ts",
		];

		for (const path of forbiddenOwners) {
			expect(CANONICAL_WRITE_OWNERS).not.toHaveProperty(path);
			expect(TEMPORARY_LEGACY_WRITE_EXCEPTIONS).not.toHaveProperty(path);
			expect(CANONICAL_SOURCE_WRITE_OWNERS).not.toHaveProperty(path);
		}
		expect(
			TEMPORARY_LEGACY_WRITE_EXCEPTIONS["src/lib/demo/demo-data.service.ts"],
		).toEqual({
			approval_request: ["insert"],
		});
	});
});
