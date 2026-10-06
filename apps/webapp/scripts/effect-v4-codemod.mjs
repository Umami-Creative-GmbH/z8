#!/usr/bin/env node
// Temporary helper for the Effect v3 → v4 migration (#625). Delete in #633.
//
// Usage (from apps/webapp):
//   node scripts/effect-v4-codemod.mjs [--dry] <file> [<file> ...]
//
// Rewrites the mechanical v3 → v4 changes in the given files:
// - `effect-v3` module specifiers → `effect`
// - `@/lib/effect-v3/<path>` → `@/lib/effect/<path>` when the v4 module exists
// - `Effect.gen(function* (_) {` → `Effect.gen(function* () {` and `yield* _(x)` → `yield* x`
//   (`_(x, f, g)` becomes `yield* x.pipe(f, g)`)
// - `Context.Tag("Id")<Self, Shape>()` → `Context.Service<Self, Shape>()("Id")`
// - `Context.GenericTag` → `Context.Service`
// - `Effect.catchAll(` → `Effect.catch(`, `Effect.catchAllCause(` → `Effect.catchCause(`
// - `Cause.failureOption(` → `Cause.findErrorOption(`
//
// It only reports the changes that need judgment (see REVIEW below). Read
// docs/refs/effect.md before porting a slice.
//
// Unwrapping a multi-line `yield* _(\n...\n)` removes the nesting level it added, but the
// joined lines can still exceed the line width. If a file was Biome-clean before the codemod,
// format it afterwards at the width it was clean at (most files use 100, some 80):
//   ./node_modules/.bin/biome format --write --line-width 100 --indent-style tab --line-ending crlf <file>
// Check first with `git show HEAD:<path> | biome format --stdin-file-path=x.ts ...`; never
// reformat files that were not Biome-clean.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const files = args.filter((arg) => arg !== "--dry");
const appRoot = path.resolve(
	path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")),
	"..",
);
const srcRoot = path.join(appRoot, "src");

const REVIEW = [
	[
		/\bEffect\.either\b/,
		"Effect.either → Effect.result: Left/Right become Failure/Success, .left/.right become .failure/.success",
	],
	[
		/\bCause\.defects\b/,
		"Cause.defects → Cause.findDefect (returns a Result with the first defect)",
	],
	[
		/\bRuntime\.(isFiberFailure|FiberFailureCauseId)\b/,
		"FiberFailure is gone: use runPromiseExit + Cause.findErrorOption / findDefect",
	],
	[
		/\bSchedule\.compose\b/,
		"Schedule.compose → Schedule.max([...]) keeps the v3 max-delay semantics",
	],
	[
		/\bEffect\.(runPromise|runSync)\(/,
		"v4 runPromise rejects with the original error, v3 with a FiberFailure: check instanceof / name checks in the surrounding catch",
	],
	[/@\/lib\/effect-v3\//, "still imports lib/effect-v3: that module has no v4 version yet"],
];

const MODULE_EXTENSIONS = [".ts", ".tsx", "/index.ts"];
const v4ModuleExists = (specifierPath) =>
	MODULE_EXTENSIONS.some((ext) => fs.existsSync(path.join(srcRoot, `${specifierPath}${ext}`)));

// Returns the index of the bracket that closes the one at `open`, skipping strings and comments.
function findClose(source, open, openChar, closeChar) {
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		const ch = source[i];
		if (ch === '"' || ch === "'" || ch === "`") {
			i = skipString(source, i);
			continue;
		}
		if (ch === "/" && source[i + 1] === "/") {
			i = source.indexOf("\n", i);
			if (i === -1) return -1;
			continue;
		}
		if (ch === "/" && source[i + 1] === "*") {
			i = source.indexOf("*/", i) + 1;
			continue;
		}
		if (openChar === "<" && ch === ">" && source[i - 1] === "=") continue;
		if (ch === openChar) depth++;
		else if (ch === closeChar) {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function skipString(source, start) {
	const quote = source[start];
	for (let i = start + 1; i < source.length; i++) {
		if (source[i] === "\\") {
			i++;
			continue;
		}
		if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
			i = findClose(source, i + 1, "{", "}");
			continue;
		}
		if (source[i] === quote) return i;
	}
	return source.length;
}

// Splits on top-level commas, skipping strings and comments (an apostrophe in a comment is not
// a quote).
function splitArgs(inner) {
	const parts = [];
	let depth = 0;
	let last = 0;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === '"' || ch === "'" || ch === "`") {
			i = skipString(inner, i);
			continue;
		}
		if (ch === "/" && inner[i + 1] === "/") {
			const end = inner.indexOf("\n", i);
			i = end === -1 ? inner.length : end;
			continue;
		}
		if (ch === "/" && inner[i + 1] === "*") {
			const end = inner.indexOf("*/", i + 2);
			i = end === -1 ? inner.length : end + 1;
			continue;
		}
		if ("([{".includes(ch)) depth++;
		else if (")]}".includes(ch)) depth--;
		else if (ch === "," && depth === 0) {
			parts.push(inner.slice(last, i));
			last = i + 1;
		}
	}
	parts.push(inner.slice(last));
	return parts.map((part) => part.trim()).filter(Boolean);
}

// Removes one leading tab from every line after the first, leaving string contents alone.
// Comments are dedented too, and quotes inside them are not strings.
function dedentOutsideStrings(code) {
	let out = "";
	let comment = null;
	for (let i = 0; i < code.length; i++) {
		const ch = code[i];
		if (comment === "line" && ch === "\n") comment = null;
		if (comment === "block" && ch === "*" && code[i + 1] === "/") comment = null;
		if (!comment && ch === "/" && (code[i + 1] === "/" || code[i + 1] === "*")) {
			comment = code[i + 1] === "/" ? "line" : "block";
			out += ch + code[i + 1];
			i++;
			continue;
		}
		if (!comment && (ch === '"' || ch === "'" || ch === "`")) {
			const end = skipString(code, i);
			out += code.slice(i, end + 1);
			i = end;
			continue;
		}
		out += ch;
		if (ch === "\n" && code[i + 1] === "\t") i++;
	}
	return out;
}

function unwrapAdapter(source) {
	let out = source;
	let from = 0;
	for (;;) {
		const at = out.indexOf("yield* _(", from);
		if (at === -1) break;
		const open = at + "yield* _".length;
		const close = findClose(out, open, "(", ")");
		if (close === -1) break;
		const inner = out.slice(open + 1, close);
		const parts = splitArgs(inner);
		// `yield* _(\n\t<expr>\n)` nested <expr> one level deeper: undo that level.
		if (parts.length === 1 && /^[ \t]*\r?\n/.test(inner)) {
			parts[0] = dedentOutsideStrings(parts[0]);
		}
		const replacement =
			parts.length <= 1
				? `yield* ${parts[0] ?? ""}`
				: `yield* ${parts[0]}.pipe(${parts.slice(1).join(", ")})`;
		out = out.slice(0, at) + replacement + out.slice(close + 1);
		from = at + "yield* ".length;
	}
	return out.replace(/function\*\s*\(\s*_\s*\)/g, "function* ()");
}

function rewriteContextTags(source) {
	let out = source;
	const pattern = /Context\.Tag\((["'][^"']+["'])\)</g;
	let match = pattern.exec(out);
	while (match) {
		const genericOpen = match.index + match[0].length - 1;
		const genericClose = findClose(out, genericOpen, "<", ">");
		if (genericClose === -1 || out.slice(genericClose + 1, genericClose + 3) !== "()") break;
		const generics = out.slice(genericOpen + 1, genericClose);
		const replacement = `Context.Service<${generics}>()(${match[1]})`;
		out = out.slice(0, match.index) + replacement + out.slice(genericClose + 3);
		pattern.lastIndex = match.index + replacement.length;
		match = pattern.exec(out);
	}
	return out.replace(/\bContext\.GenericTag\b/g, "Context.Service");
}

function rewriteModuleSpecifiers(source) {
	return source
		.replace(/(["'])effect-v3\1/g, "$1effect$1")
		.replace(/(["'])@\/lib\/effect-v3\/([^"']+)\1/g, (whole, quote, rest) =>
			v4ModuleExists(`lib/effect/${rest}`) ? `${quote}@/lib/effect/${rest}${quote}` : whole,
		);
}

let exitCode = 0;
for (const file of files) {
	const absolute = path.resolve(file);
	const original = fs.readFileSync(absolute, "utf8");
	let next = rewriteModuleSpecifiers(original);
	next = unwrapAdapter(next);
	next = rewriteContextTags(next);
	next = next
		.replace(/\bEffect\.catchAllCause\(/g, "Effect.catchCause(")
		.replace(/\bEffect\.catchAll\(/g, "Effect.catch(")
		.replace(/\bCause\.failureOption\(/g, "Cause.findErrorOption(");

	const relative = path.relative(appRoot, absolute).split(path.sep).join("/");
	if (next !== original && !dry) fs.writeFileSync(absolute, next);
	console.log(`${next === original ? "unchanged" : dry ? "would change" : "changed"}  ${relative}`);

	next.split(/\r?\n/).forEach((line, index) => {
		for (const [pattern, note] of REVIEW) {
			if (pattern.test(line)) {
				console.log(`  REVIEW ${relative}:${index + 1}  ${note}`);
				exitCode = 2;
			}
		}
	});
}
process.exitCode = exitCode;
