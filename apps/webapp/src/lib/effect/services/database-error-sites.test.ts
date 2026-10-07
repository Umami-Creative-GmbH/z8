import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(process.cwd(), "src");
const TRY_PROMISE_CALL = /\bEffect\.tryPromise\s*\(/g;
const FUNCTION_DECLARATION = /\bfunction\s+(\w+)\s*[<(]/g;
/**
 * Calls that are not database work but keep their DatabaseError: the worker-queue
 * BullMQ job counts have no fitting tagged error (#668).
 */
const NOT_DATABASE_WORK = ["queue.getJobCounts()"];

function collectSourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const filePath = join(directory, entry);
		if (statSync(filePath).isDirectory()) {
			return collectSourceFiles(filePath);
		}

		return /\.(?:ts|tsx)$/.test(entry) ? [filePath] : [];
	});
}

function isTestSource(relativePath: string): boolean {
	return (
		/\.(?:test|spec)\.tsx?$/.test(relativePath) ||
		/(?:^|\/)__tests__\//.test(relativePath) ||
		/(?:^|\/)test\//.test(relativePath)
	);
}

/** Returns the argument text of the call whose opening parenthesis ends at `start`. */
function callArguments(source: string, start: number): string {
	let depth = 1;
	for (let index = start; index < source.length; index += 1) {
		const character = source[index];
		if (character === "(") depth += 1;
		if (character === ")") {
			depth -= 1;
			if (depth === 0) return source.slice(start, index);
		}
	}
	return source.slice(start);
}

/** Same-file functions that build a DatabaseError, which a `catch` may delegate to. */
function databaseErrorFactories(source: string): string[] {
	const bracesAsParens = source.replaceAll("{", "(").replaceAll("}", ")");
	return [...source.matchAll(FUNCTION_DECLARATION)].flatMap((match) => {
		const bodyStart = source.indexOf("{", (match.index ?? 0) + match[0].length);
		const body = callArguments(bracesAsParens, bodyStart + 1);
		return /\bnew DatabaseError\(/.test(body) ? [match[1]] : [];
	});
}

function hardBuiltDatabaseErrorSites(): string[] {
	return collectSourceFiles(SOURCE_ROOT).flatMap((filePath) => {
		const relativePath = relative(SOURCE_ROOT, filePath).replaceAll("\\", "/");
		if (isTestSource(relativePath)) return [];

		const source = readFileSync(filePath, "utf8");
		const factories = databaseErrorFactories(source);
		return [...source.matchAll(TRY_PROMISE_CALL)].flatMap((match) => {
			const argumentsText = callArguments(source, (match.index ?? 0) + match[0].length);
			const buildsDatabaseError =
				/\bDatabaseError\b/.test(argumentsText) ||
				factories.some((name) => new RegExp(`\\b${name}\\b`).test(argumentsText));
			if (!buildsDatabaseError || NOT_DATABASE_WORK.some((call) => argumentsText.includes(call))) {
				return [];
			}
			const line = source.slice(0, match.index).split("\n").length;
			return [`${relativePath}:${line}`];
		});
	});
}

describe("DatabaseError construction", () => {
	it("routes every database tryPromise through DatabaseService.query", () => {
		const sites = hardBuiltDatabaseErrorSites().filter(
			(site) => !site.startsWith("lib/effect/services/database.service.ts:"),
		);

		expect(sites).toEqual([]);
	});
});
