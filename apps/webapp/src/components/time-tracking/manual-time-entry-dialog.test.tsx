/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ManualTimeEntryDialog layout", () => {
	it("keeps the form body naturally sized and preserves footer action spacing", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/time-tracking/manual-time-entry-dialog.tsx"),
			"utf8",
		);

		expect(source).toContain('className="flex min-h-0 flex-col"');
		expect(source).not.toContain('className="flex min-h-0 flex-1 flex-col"');
		expect(source).toContain('<ActionPanelFooter className="gap-2">');
		expect(source).not.toContain('sm:gap-0');
	});
});
