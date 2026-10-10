#!/usr/bin/env node
// Publish /to-tickets output to GitHub: create each ticket blockers-first,
// attach it as a native sub-issue of the spec, add native blocked_by edges,
// then read every link back from the API and compare with the manifest.
//
// Usage: node scripts/publish-tickets.mjs <manifest.json> [--dry-run]
//
// Manifest (body paths are relative to the manifest file):
// {
//   "spec": 805,
//   "repo": "Umami-Creative-GmbH/z8",            // optional
//   "labels": ["enhancement", "ready-for-agent"],
//   "tickets": [
//     { "title": "...", "body": "01.md", "blockedBy": [] },
//     { "title": "...", "body": "02.md", "blockedBy": [1] }
//   ]
// }
//
// Tickets are numbered by position from 1. `blockedBy` lists earlier
// positions. In a body, `{T<n>}` becomes `#<issue number>` of ticket n, so
// a ticket can only reference tickets listed before it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const manifestPath = args.find((arg) => !arg.startsWith("--"));
if (!manifestPath) {
	console.error("Usage: node scripts/publish-tickets.mjs <manifest.json> [--dry-run]");
	process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const baseDir = dirname(resolve(manifestPath));
const repo = manifest.repo ?? "Umami-Creative-GmbH/z8";
const labels = manifest.labels ?? ["ready-for-agent"];
const { spec, tickets } = manifest;

if (!Number.isInteger(spec) || !Array.isArray(tickets) || tickets.length === 0) {
	console.error("Manifest needs an integer `spec` and a non-empty `tickets` array.");
	process.exit(2);
}

// Validate everything before the first write.
const validate = (ticket, index) => {
	const position = index + 1;
	if (!ticket.title) throw new Error(`Ticket ${position} has no title`);
	for (const blocker of ticket.blockedBy ?? []) {
		if (!Number.isInteger(blocker) || blocker < 1 || blocker >= position) {
			throw new Error(
				`Ticket ${position} is blocked by ${blocker}, which is not an earlier ticket`,
			);
		}
	}
	const body = readFileSync(join(baseDir, ticket.body), "utf8");
	for (const [, ref] of body.matchAll(/\{T(\d+)\}/g)) {
		if (Number(ref) >= position) {
			throw new Error(`Ticket ${position} references {T${ref}}, which is not an earlier ticket`);
		}
	}
	return body;
};

let bodies;
try {
	bodies = tickets.map(validate);
} catch (error) {
	console.error(error.message);
	process.exit(2);
}

if (dryRun) {
	tickets.forEach((ticket, index) => {
		const blockers = (ticket.blockedBy ?? []).join(", ") || "none";
		console.log(`${index + 1}. ${ticket.title} (blocked by ${blockers})`);
	});
	console.log(`Dry run OK: ${tickets.length} tickets under #${spec} in ${repo}.`);
	process.exit(0);
}

const gh = (...ghArgs) => execFileSync("gh", ghArgs, { encoding: "utf8" }).trim();
const tmp = mkdtempSync(join(tmpdir(), "publish-tickets-"));
const issueNumbers = [];
const databaseIds = [];

try {
	tickets.forEach((ticket, index) => {
		const position = index + 1;
		const body = bodies[index].replace(
			/\{T(\d+)\}/g,
			(_, ref) => `#${issueNumbers[Number(ref) - 1]}`,
		);
		const bodyFile = join(tmp, `${position}.md`);
		writeFileSync(bodyFile, body);

		const url = gh(
			"issue",
			"create",
			"--repo",
			repo,
			"--title",
			ticket.title,
			"--body-file",
			bodyFile,
			...labels.flatMap((label) => ["--label", label]),
		);
		const issueNumber = Number(url.split("/").at(-1));
		issueNumbers.push(issueNumber);
		databaseIds.push(gh("api", `repos/${repo}/issues/${issueNumber}`, "--jq", ".id"));
		console.log(`created ${position} -> #${issueNumber} (${url})`);

		gh(
			"api",
			"--method",
			"POST",
			`repos/${repo}/issues/${spec}/sub_issues`,
			"-F",
			`sub_issue_id=${databaseIds[index]}`,
			"--silent",
		);
		for (const blocker of ticket.blockedBy ?? []) {
			gh(
				"api",
				"--method",
				"POST",
				`repos/${repo}/issues/${issueNumber}/dependencies/blocked_by`,
				"-F",
				`issue_id=${databaseIds[blocker - 1]}`,
				"--silent",
			);
		}
	});
} catch (error) {
	console.error(`\nStopped: ${error.message}`);
	console.error(
		`Created so far: ${issueNumbers.map((n, i) => `${i + 1} -> #${n}`).join(", ") || "none"}`,
	);
	console.error("Finish the remaining tickets and links by hand; do not re-run this manifest.");
	process.exit(1);
}

// Read every relationship back; ticket creation is complete only once it matches.
const subIssues = new Set(
	gh("api", "--paginate", `repos/${repo}/issues/${spec}/sub_issues`, "--jq", ".[].number")
		.split(/\s+/)
		.filter(Boolean)
		.map(Number),
);
let mismatches = 0;
console.log(`\n| # | Ticket | Blocked by |\n|---|---|---|`);
tickets.forEach((ticket, index) => {
	const issueNumber = issueNumbers[index];
	const expected = (ticket.blockedBy ?? [])
		.map((blocker) => issueNumbers[blocker - 1])
		.sort((a, b) => a - b);
	const actual = gh(
		"api",
		`repos/${repo}/issues/${issueNumber}/dependencies/blocked_by`,
		"--jq",
		".[].number",
	)
		.split(/\s+/)
		.filter(Boolean)
		.map(Number)
		.sort((a, b) => a - b);
	if (!subIssues.has(issueNumber)) {
		console.error(`#${issueNumber} is not a sub-issue of #${spec}`);
		mismatches++;
	}
	if (expected.join(",") !== actual.join(",")) {
		console.error(`#${issueNumber} blocked_by is [${actual}], expected [${expected}]`);
		mismatches++;
	}
	console.log(
		`| #${issueNumber} | ${ticket.title} | ${expected.map((n) => `#${n}`).join(", ") || "none"} |`,
	);
});

if (mismatches > 0) {
	console.error(
		`\n${mismatches} relationship mismatch(es); fix them before reporting the tickets as published.`,
	);
	process.exit(1);
}
console.log(`\nVerified: ${tickets.length} sub-issues of #${spec} with their blocked_by edges.`);
