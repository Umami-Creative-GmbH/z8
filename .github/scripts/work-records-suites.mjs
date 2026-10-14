import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// PostgreSQL suites that guard work records, the only writer of completed work (#1212).
// Patterns are repository paths in which `*` matches within one directory and `**/`
// spans directories; every other character, including `[locale]`, is literal.
// A pattern that matches nothing fails the job, so a renamed suite cannot drop out unnoticed.
const actions = "apps/webapp/src/app/[locale]/(app)/time-tracking/actions";
export const workRecordsSuitePatterns = [
  { pattern: "apps/webapp/src/lib/time-tracking/work-records/**/*.integration.test.ts" },
  { pattern: `${actions}/work-period-amendment*.integration.test.ts` },
  { pattern: `${actions}/work-billability-amendment*.integration.test.ts` },
  { pattern: `${actions}/work-period-split*.integration.test.ts` },
  { pattern: `${actions}/clocking.automatic-break*.integration.test.ts` },
  { pattern: `${actions}/clocking.policy-break-split*.integration.test.ts` },
  { pattern: `${actions}/correction-lifecycle*.integration.test.ts` },
  // Time-correction finalization.
  { pattern: "apps/webapp/src/lib/approvals/server/time-correction-approvals*.integration.test.ts" },
  // Automatic break enforcement divides by the owed break (#1220).
  { pattern: "apps/webapp/src/lib/effect/services/break-enforcement*.integration.test.ts" },
];

function patternExpression(pattern) {
  const source = pattern
    .split(/(\*\*\/|\*)/)
    .map(part => (part === "**/" ? "(?:[^/]+/)*" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`);
}

/** Returns the matching suites relative to apps/webapp, where the runner resolves them. */
export function selectWorkRecordsSuites(files) {
  const selected = new Set();
  for (const { pattern } of workRecordsSuitePatterns) {
    const expression = patternExpression(pattern);
    const matches = files.filter(file => expression.test(file));
    if (!matches.length) throw new Error(`No PostgreSQL suite matches ${pattern}`);
    for (const file of matches) selected.add(file.slice("apps/webapp/".length));
  }
  return [...selected].sort();
}

/** Tracked web-app source files as repository paths, from any working directory. */
export function trackedWebAppFiles() {
  return execFileSync("git", ["ls-files", "-z", "--full-name", ":/apps/webapp/src"], { encoding: "utf8" }).split("\0").filter(Boolean);
}

// CLI: prints the selected suites of this checkout, one per line.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${selectWorkRecordsSuites(trackedWebAppFiles()).join("\n")}\n`);
}
