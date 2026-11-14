import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Who may create an employee row (spec #1664 decision 10, #1671). Every path
 * that gives a user an approved membership joins through
 * `lib/employee-lifecycle/joining`; the other writers are exempt on purpose,
 * each with its reason. A new file that inserts into `employee` fails here:
 * join the member instead, or add an exemption that says why it cannot.
 */
const ALLOWED_WRITERS: Array<{ path: string; reason: string }> = [
	{
		path: "src/lib/employee-lifecycle/joining/",
		reason:
			"Joining owns what follows an approved membership: a new employee, a reactivation, or nothing (spec #1664).",
	},
	{
		path: "src/lib/employee-lifecycle/commands.ts",
		reason:
			"Rehire brings a former employee back on a new employment period; it is not joining (spec #1664, out of scope).",
	},
	{
		path: "src/lib/scim/",
		reason:
			"SCIM provisioning stays a second writer on purpose: the identity provider owns those employees (Organization ADR 0012).",
	},
	{
		path: "src/lib/demo/",
		reason: "Demo seeding writes a sample organization's employees without real memberships.",
	},
	{
		path: "scripts/performance-fixture.ts",
		reason: "Seeds a disposable performance-test database, never a tenant's data.",
	},
];

const APP_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SCANNED_DIRECTORIES = ["src", "scripts"];
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs)$/;
/** Tests and their fixtures seed test databases; they are not writers. */
const TEST_FILE =
	/(\.|-)(test|spec)(\.|-)|\.test-utils\.|[/\\]__tests__[/\\]|[/\\]test[/\\]|\.test\.fixture\./;

/** The names a file binds the `employee` table to: `employee` or an alias of it. */
function employeeTableNames(source: string): string[] {
	const names = ["employee"];
	for (const match of source.matchAll(/\bemployee\s+as\s+(\w+)\b/g)) {
		if (match[1]) names.push(match[1]);
	}
	return names;
}

/** The lines of a source file that insert into `employee`, by Drizzle, raw SQL or the auth adapter. */
function employeeInserts(source: string): string[] {
	const tables = employeeTableNames(source).join("|");
	const patterns = [
		// Drizzle: `.insert(employee)`, `.insert(schema.employee)` or an alias.
		new RegExp(String.raw`\.insert\(\s*(?:\w+\.)?(?:${tables})\s*\)`),
		// Raw SQL: `insert into employee (...)`, not `employee_*` tables.
		/\binsert\s+into\s+(?:public\.)?"?employee"?(?![\w"])/i,
		// The Better Auth adapter (SCIM): a create for the employee model.
		/\bcreate\w*\(\s*(?:\w+\s*,\s*)?(?:\{\s*model:\s*)?(?:"employee"|\w+\.employee\b)/,
	];
	return source.split(/\r?\n/).filter((line) => patterns.some((pattern) => pattern.test(line)));
}

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) {
			return entry === "node_modules" || entry === ".next" ? [] : sourceFiles(path);
		}
		return SOURCE_FILE.test(entry) && !TEST_FILE.test(path) ? [path] : [];
	});
}

const appPath = (path: string) => relative(APP_ROOT, path).split(sep).join("/");
const isAllowed = (path: string) =>
	ALLOWED_WRITERS.some((writer) =>
		writer.path.endsWith("/") ? path.startsWith(writer.path) : path === writer.path,
	);

describe("who creates employee rows (#1671)", () => {
	it("finds inserts into employee in every form the app writes them", () => {
		expect(employeeInserts("await tx.insert(employee).values({ userId });")).toHaveLength(1);
		expect(employeeInserts("db.insert( schema.employee ).values(row)")).toHaveLength(1);
		expect(
			employeeInserts(
				'import { employee as employeeTable } from "@/db/schema";\ntx.insert(employeeTable).values(row);',
			),
		).toHaveLength(1);
		expect(employeeInserts("sql`INSERT INTO employee (id) values (1)`")).toHaveLength(1);
		expect(employeeInserts('`insert into "employee" (id) values ($1)`')).toHaveLength(1);
		expect(
			employeeInserts("createUUIDRecord(database, SCIM_MODELS.employee, { userId })"),
		).toHaveLength(1);
		expect(employeeInserts('adapter.create({ model: "employee", data })')).toHaveLength(1);

		expect(employeeInserts("tx.insert(employeeManagers).values(row)")).toEqual([]);
		expect(employeeInserts("insert into employee_departure (id) values ($1)")).toEqual([]);
		expect(employeeInserts("tx.update(employee).set({ isActive: true })")).toEqual([]);
	});

	it("allows inserts into employee only from joining, rehire, SCIM and demo seeding", () => {
		const writers = SCANNED_DIRECTORIES.flatMap((directory) =>
			sourceFiles(join(APP_ROOT, directory)),
		)
			.filter((path) => employeeInserts(readFileSync(path, "utf8")).length > 0)
			.map(appPath);

		// The sweep sees the writers it allows, so a broken detector cannot pass silently.
		expect(writers).toEqual(
			expect.arrayContaining([
				"src/lib/employee-lifecycle/joining/joining.ts",
				"src/lib/scim/transaction-store.ts",
				"src/lib/demo/employee-generator.ts",
			]),
		);
		expect(writers.filter((path) => !isAllowed(path))).toEqual([]);
	});

	it("keeps every exemption pointing at code that exists, with its reason", () => {
		for (const writer of ALLOWED_WRITERS) {
			expect(existsSync(join(APP_ROOT, writer.path)), writer.path).toBe(true);
			expect(writer.reason.length, writer.path).toBeGreaterThan(20);
		}
	});
});
