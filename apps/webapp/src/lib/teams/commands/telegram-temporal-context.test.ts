import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readCommandSource(name: string) {
	return readFileSync(fileURLToPath(new URL(`./${name}.ts`, import.meta.url)), "utf8");
}

function readTelegramFormatterSource() {
	return readFileSync(
		fileURLToPath(new URL("../../telegram/formatters.ts", import.meta.url)),
		"utf8",
	);
}

describe("Telegram command temporal contexts", () => {
	it.each([
		"clock-in",
		"clock-out",
		"status",
		"clockedin",
		"pending",
	])("formats %s command responses from the explicit temporal context", (name) => {
		const source = readCommandSource(name);

		expect(source).toContain("ctx.temporal");
		expect(source).not.toContain("DateTime.now()");
		expect(source).not.toContain("DateTime.fromISO(");
	});

	it("does not migrate availability commands owned by Task 4", () => {
		for (const name of ["whos-out", "coverage", "open-shifts", "compliance"]) {
			expect(readCommandSource(name)).not.toContain("command-temporal");
		}
	});

	it("formats Telegram approval audit endpoints with their captured offset", () => {
		expect(readTelegramFormatterSource()).toContain("formatCapturedOffsetInstant");
	});
});
