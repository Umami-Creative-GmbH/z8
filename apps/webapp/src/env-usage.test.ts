import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL(".", import.meta.url));
const ALLOWED_DIRECT_ENV_READERS = new Set(["env.ts", "instrumentation.ts"]);
const RUNTIME_FILE_EXTENSIONS = [".ts", ".tsx"] as const;

function collectRuntimeFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const absolutePath = join(directory, entry);
		const stats = statSync(absolutePath);

		if (stats.isDirectory()) {
			return collectRuntimeFiles(absolutePath);
		}

		if (
			!isRuntimeSourceFile(absolutePath) ||
			ALLOWED_DIRECT_ENV_READERS.has(relative(SRC_ROOT, absolutePath))
		) {
			return [];
		}

		return [absolutePath];
	});
}

function isRuntimeSourceFile(filePath: string): boolean {
	return (
		RUNTIME_FILE_EXTENSIONS.some((extension) => filePath.endsWith(extension)) &&
		!filePath.includes(".test.")
	);
}

function resolveLocalImport(
	fromFile: string,
	specifier: string,
	sourceFiles: Set<string>,
): string | null {
	if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;

	const basePath = specifier.startsWith("@/")
		? join(SRC_ROOT, specifier.slice(2))
		: join(fromFile, "..", specifier);
	const candidates = RUNTIME_FILE_EXTENSIONS.flatMap((extension) => [
		`${basePath}${extension}`,
		join(basePath, `index${extension}`),
	]);

	return candidates.find((candidate) => sourceFiles.has(candidate)) ?? null;
}

function getRuntimeImports(filePath: string, sourceFiles: Set<string>): string[] {
	const source = readFileSync(filePath, "utf8");
	const importPattern =
		/import\s+(?!type\b)[\s\S]*?from\s+["']([^"']+)["']|import\s*["']([^"']+)["']/g;
	const imports: string[] = [];
	let match: RegExpExecArray | null;

	while ((match = importPattern.exec(source)) !== null) {
		const specifier = match[1] ?? match[2];
		const resolvedImport = resolveLocalImport(filePath, specifier, sourceFiles);
		if (resolvedImport) imports.push(resolvedImport);
	}

	return imports;
}

function isClientEntry(filePath: string): boolean {
	return /^\s*["']use client["']/.test(readFileSync(filePath, "utf8"));
}

function isServerBoundary(filePath: string): boolean {
	const source = readFileSync(filePath, "utf8");
	return (
		/^\s*["']use server["']/.test(source) ||
		source.includes('import "server-only"') ||
		filePath.endsWith(".server.ts") ||
		filePath.endsWith(".server.tsx")
	);
}

function collectClientReachableFiles(runtimeFiles: string[]): Set<string> {
	const sourceFiles = new Set(runtimeFiles);
	const reachableFiles = new Set<string>();
	const pendingFiles = runtimeFiles.filter(isClientEntry);

	while (pendingFiles.length > 0) {
		const filePath = pendingFiles.pop();
		if (!filePath || reachableFiles.has(filePath)) continue;

		reachableFiles.add(filePath);
		if (isServerBoundary(filePath)) continue;

		pendingFiles.push(...getRuntimeImports(filePath, sourceFiles));
	}

	return reachableFiles;
}

describe("environment variable usage", () => {
	it("reads env vars from @/env outside env and instrumentation setup", () => {
		const offenders = collectRuntimeFiles(SRC_ROOT).flatMap((filePath) => {
			const source = readFileSync(filePath, "utf8");
			const sourceWithoutNodeEnv = source.replaceAll("process.env.NODE_ENV", "");

			if (!sourceWithoutNodeEnv.includes("process.env")) {
				return [];
			}

			return [relative(SRC_ROOT, filePath)];
		});

		expect(offenders).toEqual([]);
	});

	it("does not import the server env wrapper from Tolgee shared runtime code", () => {
		const source = readFileSync(join(SRC_ROOT, "tolgee/shared.ts"), "utf8");

		expect(source).not.toContain('from "@/env"');
	});

	it("does not read server env vars from client-reachable modules", () => {
		const runtimeFiles = collectRuntimeFiles(SRC_ROOT);
		const offenders = Array.from(collectClientReachableFiles(runtimeFiles)).flatMap((filePath) => {
			if (isServerBoundary(filePath)) return [];

			const source = readFileSync(filePath, "utf8");
			if (!source.includes('from "@/env"') && !source.includes("from '@/env'")) return [];

			const serverEnvKeys = Array.from(source.matchAll(/\benv\.([A-Z0-9_]+)/g))
				.map((match) => match[1])
				.filter((key) => !key.startsWith("NEXT_PUBLIC_"));

			return serverEnvKeys.map((key) => `${relative(SRC_ROOT, filePath)}:${key}`);
		});

		expect(offenders).toEqual([]);
	});
});
