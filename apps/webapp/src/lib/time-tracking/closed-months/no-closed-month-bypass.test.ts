/**
 * #1224 (spec #1212): every completed work period has a canonical work record,
 * and half pairs left in a closed month stay as they are. Nothing may change a
 * closed month (Time Tracking ADR-0004): no migration and no production code
 * adds an exemption, a session flag or a way to switch the refusal off.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const app = process.cwd();

function files(directory: string, keep: (path: string) => boolean): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "node_modules" || entry.name === "__tests__" ? [] : files(path, keep);
		}
		return keep(path) ? [path] : [];
	});
}

const BYPASS = [
	/session_replication_role/i,
	/disable\s+trigger/i,
	/closed_month[\w]*(bypass|exempt|allow|unlock)/i,
	/(bypass|exempt|allow|unlock)[\w]*closed_month/i,
];

function bypassesIn(paths: string[]) {
	return paths.flatMap((path) => {
		const text = readFileSync(path, "utf8");
		return BYPASS.filter((pattern) => pattern.test(text)).map((pattern) => ({
			file: relative(app, path).replaceAll("\\", "/"),
			pattern: pattern.source,
		}));
	});
}

describe("no closed-month bypass", () => {
	it("exists in any migration", () => {
		expect(bypassesIn(files(join(app, "drizzle"), (path) => path.endsWith(".sql")))).toEqual([]);
	});

	it("exists in production code", () => {
		const production = files(
			join(app, "src"),
			(path) =>
				/\.(ts|tsx)$/.test(path) &&
				!/\.test\.(ts|tsx)$/.test(path) &&
				!path.includes(".test.fixture.") &&
				!path.startsWith(join(app, "src", "test")),
		);
		expect(production.length).toBeGreaterThan(100);
		expect(bypassesIn(production)).toEqual([]);
	});

	it("keeps the refusal unconditional: its guard reads no session setting", () => {
		const refusal = readFileSync(join(app, "drizzle", "0191_closed_month_refusal.sql"), "utf8");
		expect(refusal).toContain("No session flag can unlock it");
		expect(refusal).not.toContain("current_setting(");
	});
});
