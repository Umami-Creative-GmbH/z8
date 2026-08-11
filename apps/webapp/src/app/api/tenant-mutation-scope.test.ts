import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript/unstable/ast";
import { describe, expect, it, vi } from "vitest";
import * as nativeSourceAnalysis from "@/lib/typescript/native-source-analysis";

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

describe("tenant-owned API mutations", () => {
	it("include organizationId in every final tenant-table update predicate", () => {
		const files = routeFiles(API_ROOT).sort();
		const sources = new Map(
			files.map((file) => [file, readFileSync(file, "utf8")]),
		);
		const withNativeProgram = vi.spyOn(
			nativeSourceAnalysis,
			"withNativeProgram",
		);
		const withNativeSource = vi.spyOn(nativeSourceAnalysis, "withNativeSource");
		let violations: string[] | undefined;
		let nativeProgramCallCount = 0;
		let nativeSourceCallCount = 0;

		try {
			violations = nativeSourceAnalysis.withNativeProgram(
				sources,
				files[0],
				({ program }) => {
					const fileViolations: string[] = [];

					function enclosingStatement(node: ts.Node): ts.Statement | null {
						let current: ts.Node | undefined = node;
						while (current && !ts.isStatement(current))
							current = current.parent;
						return current && ts.isStatement(current) ? current : null;
					}

					for (const file of files) {
						const normalizedPath = file.replaceAll("\\", "/");
						const sourceFile = program.getSourceFile(normalizedPath);
						if (!sourceFile) {
							throw new Error(
								`Native source file not found: ${normalizedPath}`,
							);
						}

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
									statement?.getText(sourceFile) ?? node.getText(sourceFile);
								if (!statementText.includes(`${table}.organizationId`)) {
									const position = sourceFile.getLineAndCharacterOfPosition(
										node.getStart(sourceFile),
									);
									fileViolations.push(
										`${relative(process.cwd(), file)}:${position.line + 1} updates ${table} without organizationId`,
									);
								}
							}
							node.forEachChild(visit);
						}

						visit(sourceFile);
					}

					return fileViolations;
				},
			);
		} finally {
			nativeProgramCallCount = withNativeProgram.mock.calls.length;
			nativeSourceCallCount = withNativeSource.mock.calls.length;
			try {
				withNativeProgram.mockRestore();
			} finally {
				withNativeSource.mockRestore();
			}
		}

		expect(violations).toEqual([]);
		expect(nativeProgramCallCount).toBe(1);
		expect(nativeSourceCallCount).toBe(0);
	});
});
