import { type PathLike, readFileSync } from "node:fs";

// Preserve source tokens while making checkout line endings irrelevant to guards.
export function readTestText(path: PathLike, encoding: "utf8"): string {
	return readFileSync(path, encoding).replace(/\r\n/g, "\n");
}
