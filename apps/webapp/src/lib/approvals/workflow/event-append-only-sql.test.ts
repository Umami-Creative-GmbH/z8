import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
	ApprovalWorkflowEventAnalysisLimitError,
	evaluateConstantSql,
	findEventTableSqlMutations,
} from "./event-append-only-sql";

interface EvaluatorFixtureContext {
	checker: ts.TypeChecker;
	resultExpression: ts.Expression;
	sourceFiles: ReadonlyMap<string, ts.SourceFile>;
}

interface EvaluatorFixtureOptions {
	additionalFiles?: Readonly<Record<string, string>>;
	evaluationCount?: number;
	prepare?: (context: EvaluatorFixtureContext) => void;
}

function evaluateFixture(
	source: string,
	options: EvaluatorFixtureOptions = {},
): string | null {
	const fileName = "/constant-sql-fixture.ts";
	const sources = new Map<string, string>([
		[fileName, source],
		...Object.entries(options.additionalFiles ?? {}),
	]);
	const sourceFiles = new Map(
		[...sources].map(([candidate, contents]) => [
			candidate,
			ts.createSourceFile(
				candidate,
				contents,
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TS,
			),
		]),
	);
	const sourceFile = sourceFiles.get(fileName);
	if (!sourceFile) throw new Error("Fixture entry file was not created");
	const compilerOptions: ts.CompilerOptions = {
		noLib: true,
		target: ts.ScriptTarget.Latest,
	};
	const host: ts.CompilerHost = {
		fileExists: (candidate) => sources.has(candidate),
		getCanonicalFileName: (candidate) => candidate,
		getCurrentDirectory: () => "/",
		getDefaultLibFileName: () => "lib.d.ts",
		getNewLine: () => "\n",
		getSourceFile: (candidate) => sourceFiles.get(candidate),
		readFile: (candidate) => sources.get(candidate),
		useCaseSensitiveFileNames: () => true,
		writeFile: () => undefined,
	};
	const program = ts.createProgram([...sources.keys()], compilerOptions, host);
	const checker = program.getTypeChecker();
	let resultExpression: ts.Expression | undefined;
	const visit = (node: ts.Node): void => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "result"
		) {
			resultExpression = node.initializer;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	if (!resultExpression) throw new Error("Fixture must declare const result");
	options.prepare?.({ checker, resultExpression, sourceFiles });
	let result: string | null = null;
	for (let count = 0; count < (options.evaluationCount ?? 1); count += 1) {
		result = evaluateConstantSql(resultExpression, {
			checker,
			usePosition: resultExpression.getStart(sourceFile),
		});
	}
	return result;
}

function expectAnalysisLimit(
	action: () => unknown,
	limit: "constant_evaluator_depth" | "sql_command_depth",
): void {
	let error: unknown;
	try {
		action();
	} catch (caught) {
		error = caught;
	}
	expect(error).toBeInstanceOf(ApprovalWorkflowEventAnalysisLimitError);
	expect(error).toMatchObject({
		code: "APPROVAL_WORKFLOW_EVENT_ANALYSIS_LIMIT",
		message: `Approval workflow event analysis limit exceeded: ${limit}`,
	});
}

describe("findEventTableSqlMutations", () => {
	it.each([
		[
			"unqualified update",
			"UPDATE APPROVAL_WORKFLOW_EVENT SET version = 2",
			["raw_sql_update"],
		],
		[
			"update with ONLY and an unquoted schema",
			"update only audit.approval_workflow_event set version = 2",
			["raw_sql_update"],
		],
		[
			"delete with ONLY and a quoted schema",
			'DeLeTe\nFrOm /* target */ ONLY "audit" . "approval_workflow_event"',
			["raw_sql_delete"],
		],
		[
			"delete with comments between grammar tokens",
			"DELETE/* action */FROM-- target follows\npublic.approval_workflow_event",
			["raw_sql_delete"],
		],
	] as const)("recognizes %s", (_name, sqlText, expected) => {
		expect(findEventTableSqlMutations(sqlText)).toEqual(expected);
	});

	it.each([
		"update approval_workflow_stage set status = 'approved'",
		"delete from approval_workflow_events",
		"select * from approval_workflow_event",
	] as const)("ignores non-event-table mutation SQL: %s", (sqlText) => {
		expect(findEventTableSqlMutations(sqlText)).toEqual([]);
	});

	it.each([
		[
			"nested block comments",
			"select /* outer /* nested */ update approval_workflow_event set version = 2 */ 1",
		],
		["line comments", "select 1 -- delete from approval_workflow_event\n, 2"],
		[
			"ordinary strings with doubled quotes",
			"select 'quoted '' update approval_workflow_event set version = 2'",
		],
		[
			"uppercase escape strings with backslash escapes",
			String.raw`select E'escaped \' update approval_workflow_event set version = 2'`,
		],
		[
			"lowercase escape strings with backslash escapes",
			String.raw`select e'escaped \' delete from approval_workflow_event'`,
		],
		[
			"untagged dollar-quoted bodies",
			"select $$ update approval_workflow_event set version = 2 $$",
		],
		[
			"tagged dollar-quoted bodies",
			"select $function_body$ delete from approval_workflow_event $function_body$",
		],
	] as const)("ignores mutation text inside %s", (_name, sqlText) => {
		expect(findEventTableSqlMutations(sqlText)).toEqual([]);
	});

	it("treats doubled quotes as part of a quoted identifier", () => {
		expect(
			findEventTableSqlMutations(
				'UPDATE "aud""it"."approval_workflow_event" AS event_row SET version = 2',
			),
		).toEqual(["raw_sql_update"]);
	});

	it("tokenizes adjacent punctuation and preserves mutation source order", () => {
		expect(
			findEventTableSqlMutations(
				'DELETE FROM"approval_workflow_event";UPDATE public.approval_workflow_event AS event_row SET version=2',
			),
		).toEqual(["raw_sql_delete", "raw_sql_update"]);
	});

	it.each([
		'UPDATE "APPROVAL_WORKFLOW_EVENT" SET version = 2',
		'DELETE FROM audit."Approval_Workflow_Event"',
		'UPDATE "approval_workflow_""event" SET version = 2',
	] as const)("ignores a distinct quoted table identifier: %s", (sqlText) => {
		expect(findEventTableSqlMutations(sqlText)).toEqual([]);
	});

	it("recognizes an event table qualified by a Unicode schema", () => {
		expect(
			findEventTableSqlMutations(
				"UPDATE schéma.approval_workflow_event SET version = 2",
			),
		).toEqual(["raw_sql_update"]);
	});

	it("does not match an event-table identifier with a Unicode suffix", () => {
		expect(
			findEventTableSqlMutations(
				"UPDATE approval_workflow_eventé SET version = 2",
			),
		).toEqual([]);
	});

	it("ignores mutation text inside a Unicode-tagged dollar body", () => {
		expect(
			findEventTableSqlMutations(
				"SELECT $täg$ UPDATE approval_workflow_event SET version = 2 $täg$",
			),
		).toEqual([]);
	});

	it("recognizes an event table qualified by an emoji schema", () => {
		expect(
			findEventTableSqlMutations(
				"UPDATE 😀.approval_workflow_event SET version = 2",
			),
		).toEqual(["raw_sql_update"]);
	});

	it("ignores mutation text inside an emoji-tagged dollar body", () => {
		expect(
			findEventTableSqlMutations(
				"$😀$ SELECT 1; UPDATE approval_workflow_event SET version = 2 $😀$",
			),
		).toEqual([]);
	});

	it("does not treat NBSP as PostgreSQL whitespace", () => {
		expect(
			findEventTableSqlMutations(
				"UPDATE\u00a0approval_workflow_event SET version = 2",
			),
		).toEqual([]);
	});

	it("recognizes a plain Unicode quoted event-table identifier", () => {
		expect(
			findEventTableSqlMutations(
				'UPDATE U&"approval_workflow_event" SET version = 2',
			),
		).toEqual(["raw_sql_update"]);
	});

	it("decodes an escaped Unicode quoted event-table identifier", () => {
		expect(
			findEventTableSqlMutations(
				`DELETE FROM U&"approval_workflow_!0065vent" UESCAPE '!'`,
			),
		).toEqual(["raw_sql_delete"]);
	});

	it("keeps escaped Unicode quoted identifiers case-sensitive", () => {
		expect(
			findEventTableSqlMutations(
				String.raw`UPDATE U&"approval_workflow_\0045vent" SET version = 2`,
			),
		).toEqual([]);
	});

	it("combines four-digit surrogate pairs in Unicode quoted identifiers", () => {
		expect(
			findEventTableSqlMutations(
				String.raw`UPDATE U&"\D83D\DE00".approval_workflow_event SET version = 2`,
			),
		).toEqual(["raw_sql_update"]);
	});

	it("combines six-digit surrogate pairs in Unicode quoted identifiers", () => {
		expect(
			findEventTableSqlMutations(
				String.raw`UPDATE U&"\+00D83D\+00DE00".approval_workflow_event SET version = 2`,
			),
		).toEqual(["raw_sql_update"]);
	});

	it.each([
		`UPDATE U&"approval_workflow_00065vent" UESCAPE '0' SET version = 2`,
		`UPDATE U&"approval_workflow_+0065vent" UESCAPE '+' SET version = 2`,
		`UPDATE U&"approval_workflow_'0065vent" UESCAPE '''' SET version = 2`,
		`UPDATE U&"approval_workflow_""0065vent" UESCAPE '"' SET version = 2`,
		`UPDATE U&"approval_workflow_ 0065vent" UESCAPE ' ' SET version = 2`,
	] as const)("rejects a prohibited UESCAPE character: %s", (sqlText) => {
		expect(findEventTableSqlMutations(sqlText)).toEqual([]);
	});

	it.each([
		String.raw`UPDATE U&"broken\".approval_workflow_event SET version = 2`,
		String.raw`UPDATE U&"\D83D".approval_workflow_event SET version = 2`,
		String.raw`UPDATE U&"approval_workflow_\006Gvent" SET version = 2`,
	] as const)("rejects a malformed Unicode quoted identifier: %s", (sqlText) => {
		expect(findEventTableSqlMutations(sqlText)).toEqual([]);
	});

	it.each([
		[
			"CR-only",
			"SELECT 1; -- UPDATE approval_workflow_event SET version = 1\rDELETE FROM approval_workflow_event",
		],
		[
			"CRLF",
			"SELECT 1; -- UPDATE approval_workflow_event SET version = 1\r\nDELETE FROM approval_workflow_event",
		],
	] as const)("ends line comments at %s newlines", (_name, sqlText) => {
		expect(findEventTableSqlMutations(sqlText)).toEqual(["raw_sql_delete"]);
	});

	it.each([
		"SELECT delete FROM approval_workflow_event",
		"SELECT update approval_workflow_event FROM audit_log",
		"SELECT update approval_workflow_event SET version = 2",
		"UPDATE approval_workflow_event",
		"UPDATE audit_log AS approval_workflow_event SET value = 1",
	] as const)("ignores mutation-like non-command SQL: %s", (sqlText) => {
		expect(findEventTableSqlMutations(sqlText)).toEqual([]);
	});

	it("recognizes commands only at top-level statement starts", () => {
		expect(
			findEventTableSqlMutations(`
SELECT update approval_workflow_event FROM audit_log;
UPDATE approval_workflow_event AS event_row SET version = 2;
DELETE FROM approval_workflow_event WHERE version = 1;
`),
		).toEqual(["raw_sql_update", "raw_sql_delete"]);
	});

	it("recognizes writable CTE commands and the final WITH command", () => {
		expect(
			findEventTableSqlMutations(`
WITH changed AS MATERIALIZED (
	UPDATE approval_workflow_event SET version = 2 RETURNING id
), removed AS NOT MATERIALIZED (
	DELETE FROM ONLY audit.approval_workflow_event RETURNING id
), selected AS (
	SELECT update approval_workflow_event FROM audit_log
)
DELETE FROM approval_workflow_event WHERE id IN (SELECT id FROM changed);
`),
		).toEqual(["raw_sql_update", "raw_sql_delete", "raw_sql_delete"]);
	});

	it.each([
		[
			"direct ANALYZE",
			"EXPLAIN ANALYZE UPDATE approval_workflow_event SET version = 2",
			["raw_sql_update"],
		],
		[
			"parenthesized ANALYZE option",
			"EXPLAIN (VERBOSE true, ANALYZE true) DELETE FROM approval_workflow_event",
			["raw_sql_delete"],
		],
		[
			"plain EXPLAIN",
			"EXPLAIN UPDATE approval_workflow_event SET version = 2",
			[],
		],
		[
			"disabled ANALYZE option",
			"EXPLAIN (ANALYZE false) DELETE FROM approval_workflow_event",
			[],
		],
		[
			"numeric disabled ANALYZE option",
			"EXPLAIN (ANALYZE 0) UPDATE approval_workflow_event SET version = 2",
			[],
		],
	] as const)("classifies %s by whether EXPLAIN executes", (_name, sqlText, expected) => {
		expect(findEventTableSqlMutations(sqlText)).toEqual(expected);
	});

	it("parses SEARCH and CYCLE suffixes before the final WITH command", () => {
		expect(
			findEventTableSqlMutations(`
WITH RECURSIVE walk(id) AS (
	SELECT id FROM walk
)
SEARCH DEPTH FIRST BY id SET order_path
CYCLE id SET is_cycle USING cycle_path
UPDATE approval_workflow_event SET version = 2;
`),
		).toEqual(["raw_sql_update"]);
	});

	it("throws a stable error when SQL command nesting exceeds its limit", () => {
		let sql = "UPDATE approval_workflow_event SET version = 2";
		for (let level = 0; level < 66; level += 1) {
			sql = `WITH cte_${level} AS (${sql}) SELECT 1`;
		}

		expectAnalysisLimit(
			() => findEventTableSqlMutations(sql),
			"sql_command_depth",
		);
	});
});

describe("evaluateConstantSql", () => {
	it("evaluates a string literal", () => {
		expect(evaluateFixture('const result = "delete from events";')).toBe(
			"delete from events",
		);
	});

	it("evaluates a no-substitution template literal", () => {
		expect(evaluateFixture("const result = `update events`;")).toBe(
			"update events",
		);
	});

	it.each([
		'const result = (("sql"));',
		'const result = "sql" as string;',
		'const result = <string>"sql";',
		'const result = "sql"!;',
		'const result = "sql" satisfies string;',
	] as const)("evaluates transparent wrappers: %s", (source) => {
		expect(evaluateFixture(source)).toBe("sql");
	});

	it("concatenates binary plus operands when both are constant strings", () => {
		expect(
			evaluateFixture(
				'const result = "UPDATE " + `approval_workflow_event` + " SET version = 2";',
			),
		).toBe("UPDATE approval_workflow_event SET version = 2");
	});

	it("evaluates a template expression when every span is constant", () => {
		expect(
			evaluateFixture(
				`const result = \`delete \${"from"} \${"approval" + "_workflow_event"}\`;`,
			),
		).toBe("delete from approval_workflow_event");
	});

	it("resolves transitive const identifier aliases declared before use", () => {
		expect(
			evaluateFixture(`
const action = "update";
const target = "approval_workflow_event";
const statement = action + " " + target;
const alias = statement;
const result = alias;
`),
		).toBe("update approval_workflow_event");
	});

	it.each([
		[
			"let aliases",
			'let sql = "update approval_workflow_event"; const result = sql;',
		],
		[
			"var aliases",
			'var sql = "update approval_workflow_event"; const result = sql;',
		],
		[
			"aliases written after use",
			'const sql = "update approval_workflow_event"; const result = sql; sql = "select 1";',
		],
		[
			"compound alias writes",
			'const sql = "update approval_workflow_event"; sql += " returning id"; const result = sql;',
		],
		[
			"function calls",
			'const makeSql = () => "update approval_workflow_event"; const result = makeSql();',
		],
		[
			"dynamic template substitutions",
			`declare const table: string; const result = \`update \${table}\`;`,
		],
		["cyclic aliases", "const sql = sql; const result = sql;"],
		[
			"aliases declared after use",
			'const result = sql; const sql = "update approval_workflow_event";',
		],
		["non-string constants", 'const count = 1; const result = count + " row";'],
	] as const)("rejects %s", (_name, source) => {
		expect(evaluateFixture(source)).toBeNull();
	});

	it("rejects an identifier declared in another source file", () => {
		expect(
			evaluateFixture(
				`const padding = "make the use position exceed the other initializer";
const result = sql;`,
				{
					additionalFiles: {
						"/shared.ts": 'const sql = "update approval_workflow_event";',
					},
					prepare: ({ checker, resultExpression }) => {
						const symbol = checker.getSymbolAtLocation(resultExpression);
						expect(symbol?.declarations?.[0]?.getSourceFile().fileName).toBe(
							"/shared.ts",
						);
					},
				},
			),
		).toBeNull();
	});

	it("rejects a compiler symbol with multiple variable declarations", () => {
		expect(
			evaluateFixture(
				'var sql = "update approval_workflow_event"; var sql: string; const result = sql;',
				{
					prepare: ({ checker, resultExpression }) => {
						const symbol = checker.getSymbolAtLocation(resultExpression);
						expect(symbol?.declarations).toHaveLength(2);
						const declaration = symbol?.declarations?.[0];
						if (
							!declaration ||
							!ts.isVariableDeclaration(declaration) ||
							!ts.isVariableDeclarationList(declaration.parent)
						) {
							throw new Error("Expected a merged variable symbol");
						}
						declaration.parent.flags |= ts.NodeFlags.Const;
					},
				},
			),
		).toBeNull();
	});

	it("rejects a const declaration without an initializer", () => {
		expect(
			evaluateFixture("const sql: string; const result = sql;", {
				prepare: ({ checker, resultExpression }) => {
					const symbol = checker.getSymbolAtLocation(resultExpression);
					const declaration = symbol?.declarations?.[0];
					expect(
						declaration && ts.isVariableDeclaration(declaration)
							? declaration.initializer
							: "not a variable declaration",
					).toBeUndefined();
				},
			}),
		).toBeNull();
	});

	it("does not treat an element-access index as an assignment target", () => {
		expect(
			evaluateFixture(`
declare const cache: any;
const sql = "update approval_workflow_event set version = 2";
cache[sql] = true;
const result = sql;
`),
		).toBe("update approval_workflow_event set version = 2");
	});

	it("does not treat a computed destructuring key as an assignment target", () => {
		expect(
			evaluateFixture(`
declare const source: any;
let value: unknown;
const sql = "delete from approval_workflow_event";
({ [sql]: value } = source);
const result = sql;
`),
		).toBe("delete from approval_workflow_event");
	});

	it.each([
		`declare const source: any;
const sql = "delete from approval_workflow_event";
({ query: sql } = source);
const result = sql;`,
		`declare const source: any;
const sql = "update approval_workflow_event set version = 2";
[sql] = source;
const result = sql;`,
	] as const)("rejects real destructuring assignment-target writes", (source) => {
		expect(evaluateFixture(source)).toBeNull();
	});

	it("rejects an alias cycle after both declarations pass ordering checks", () => {
		let orderingChecks = 0;
		expect(
			evaluateFixture(
				"const first = second; const second = first; const result = first;",
				{
					prepare: ({ sourceFiles }) => {
						const sourceFile = sourceFiles.get("/constant-sql-fixture.ts");
						if (!sourceFile) throw new Error("Expected fixture source file");
						const visit = (node: ts.Node): void => {
							if (
								ts.isVariableDeclaration(node) &&
								ts.isIdentifier(node.name) &&
								(node.name.text === "first" || node.name.text === "second") &&
								node.initializer
							) {
								Object.defineProperty(node.initializer, "getEnd", {
									value: () => {
										orderingChecks += 1;
										if (orderingChecks > 8) {
											throw new Error(
												"Cycle detection did not terminate evaluation",
											);
										}
										return 0;
									},
								});
							}
							ts.forEachChild(node, visit);
						};
						visit(sourceFile);
					},
				},
			),
		).toBeNull();
	});

	it("throws a stable error for a 129-level const alias chain", () => {
		const aliases = [
			'const sql0 = "update approval_workflow_event set version = 2";',
			...Array.from(
				{ length: 128 },
				(_, index) => `const sql${index + 1} = sql${index};`,
			),
			"const result = sql128;",
		].join("\n");

		expectAnalysisLimit(
			() => evaluateFixture(aliases),
			"constant_evaluator_depth",
		);
	});

	it("rejects binary plus when the right operand is dynamic", () => {
		expect(
			evaluateFixture(`
declare const dynamicSql: string;
const result = "update " + dynamicSql;
`),
		).toBeNull();
	});

	it.each([
		"sql++",
		"++sql",
	] as const)("rejects prefix and postfix writes: %s", (write) => {
		expect(
			evaluateFixture(`
const sql = "update approval_workflow_event set version = 2";
${write};
const result = sql;
`),
		).toBeNull();
	});

	it.each([
		"for (sql in source) {}",
		"for (sql of source) {}",
	] as const)("rejects for-in/of assignment-target writes: %s", (loop) => {
		expect(
			evaluateFixture(`
declare const source: any;
const sql = "delete from approval_workflow_event";
${loop}
const result = sql;
`),
		).toBeNull();
	});

	it("builds the write-symbol index once per source file and checker", () => {
		let assignmentTargetLookups = 0;
		expect(
			evaluateFixture(
				`let written: string;
written = "value";
const sql = "update approval_workflow_event set version = 2";
const result = sql;`,
				{
					evaluationCount: 2,
					prepare: ({ checker }) => {
						const getSymbolAtLocation =
							checker.getSymbolAtLocation.bind(checker);
						Object.defineProperty(checker, "getSymbolAtLocation", {
							value: (node: ts.Node) => {
								if (ts.isIdentifier(node) && node.text === "written") {
									assignmentTargetLookups += 1;
								}
								return getSymbolAtLocation(node);
							},
						});
					},
				},
			),
		).toBe("update approval_workflow_event set version = 2");
		expect(assignmentTargetLookups).toBe(1);
	});
});
