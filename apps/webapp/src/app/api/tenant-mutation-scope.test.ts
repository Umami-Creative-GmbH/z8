import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const API_ROOT = join(process.cwd(), "src/app/api");
const TENANT_TABLES = new Set([
	"calendarConnection",
	"discordBotConfig",
	"holiday",
	"holidayCategory",
	"holidayPreset",
	"icsFeed",
	"slackOAuthState",
	"slackWorkspaceConfig",
	"teamsTenantConfig",
	"telegramBotConfig",
]);

function routeFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return routeFiles(path);
		return entry.name === "route.ts" ? [path] : [];
	});
}

function enclosingStatement(node: ts.Node): ts.Statement | null {
	let current: ts.Node | undefined = node;
	while (current && !ts.isStatement(current)) current = current.parent;
	return current && ts.isStatement(current) ? current : null;
}

describe("tenant-owned API mutations", () => {
	it("include organizationId in every final tenant-table update predicate", () => {
		const violations: string[] = [];

		for (const file of routeFiles(API_ROOT)) {
			const sourceText = readFileSync(file, "utf8");
			const source = ts.createSourceFile(
				file,
				sourceText,
				ts.ScriptTarget.Latest,
				true,
			);

			function visit(node: ts.Node) {
				if (
					ts.isCallExpression(node) &&
					ts.isPropertyAccessExpression(node.expression) &&
					node.expression.name.text === "update" &&
					node.arguments.length > 0 &&
					ts.isIdentifier(node.arguments[0]) &&
					TENANT_TABLES.has(node.arguments[0].text)
				) {
					const table = node.arguments[0].text;
					const statement = enclosingStatement(node);
					const statementText =
						statement?.getText(source) ?? node.getText(source);
					if (!statementText.includes(`${table}.organizationId`)) {
						const position = source.getLineAndCharacterOfPosition(
							node.getStart(source),
						);
						violations.push(
							`${relative(process.cwd(), file)}:${position.line + 1} updates ${table} without organizationId`,
						);
					}
				}
				ts.forEachChild(node, visit);
			}

			visit(source);
		}

		expect(violations).toEqual([]);
	});
});
