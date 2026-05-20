import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentsDir = import.meta.dirname;
const appDir = join(componentsDir, "../../app/[locale]/(app)/travel-expenses");

const rawCopyPatterns = [
	/feature="manage travel expenses"/,
	/>Review Pending Travel Expense Approvals</,
	/>Open the unified approvals inbox filtered to travel expenses\.</,
	/>\s*Open Inbox\s*</,
	/result\.error \|\| "Failed to load travel expense claims"/,
	/>Travel Expenses</,
	/>\s*Create and track your travel expense claims\s*</,
	/>\s*New Claim\s*</,
	/>No travel expense claims yet</,
	/>\s*Create your first claim to start the approval process\.\s*</,
	/>Type</,
	/>Status</,
	/>Amount</,
	/>Date Range</,
	/nextErrors\.tripStart = "Please provide a valid trip start date"/,
	/nextErrors\.tripEnd = "Please provide a valid trip end date"/,
	/toast\.error\("Please provide a valid trip start and end date"\)/,
	/nextErrors\.tripEnd = "Trip end date cannot be before trip start date"/,
	/nextErrors\.amount = "Amount must be a positive number"/,
	/result\.error \|\| "Failed to create travel expense draft"/,
	/toast\.success\("Travel expense draft created"\)/,
	/>Create Travel Expense Claim</,
	/>\s*Create a new draft claim for your recent travel expenses\.\s*</,
	/>Claim Type</,
	/placeholder="Select claim type"/,
	/>Receipt</,
	/>Mileage</,
	/>Per Diem</,
	/>\s*Receipt claims require at least one attachment\./,
	/>Trip Start</,
	/>Trip End</,
	/>Destination City</,
	/>Destination Country</,
	/>Currency</,
	/>ISO 4217 code, e\.g\. EUR or USD</,
	/>Notes</,
	/placeholder="Add optional context for your approver"/,
	/>\s*Cancel\s*</,
	/>\s*Create Draft\s*</,
	/toast\.error\("Travel expense claim is missing"\)/,
	/toast\.error\("Please provide a rejection reason"\)/,
	/`Failed to \$\{action\} claim`/,
	/`Claim \$\{action\}d successfully`/,
	/action === "approve" \? "Approve Claim" : "Reject Claim"/,
	/\? "Add an optional note for the claimant before approving\."/,
	/: "Provide a clear reason to help the claimant update and resubmit\."/,
	/>Note \(optional\)</,
	/>Reason \(required\)</,
	/>\s*Approve\s*</,
	/>\s*Reject\s*</,
];

describe("travel expenses i18n", () => {
	it("does not leave known travel expense UI copy as raw literals", () => {
		const files = [
			join(appDir, "page.tsx"),
			join(componentsDir, "travel-expense-management.tsx"),
			join(componentsDir, "travel-expense-list.tsx"),
			join(componentsDir, "travel-expense-claim-dialog.tsx"),
			join(componentsDir, "travel-expense-decision-dialog.tsx"),
		];

		for (const file of files) {
			const source = readFileSync(file, "utf8");
			for (const pattern of rawCopyPatterns) {
				expect(source, `${file} should not contain raw travel expense copy ${pattern}`).not.toMatch(
					pattern,
				);
			}
		}
	});
});
