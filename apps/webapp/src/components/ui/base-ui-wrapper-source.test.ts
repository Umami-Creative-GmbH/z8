import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const wrappersThatShouldUseBaseUi = [
	"accordion.tsx",
	"alert-dialog.tsx",
	"avatar.tsx",
	"checkbox.tsx",
	"collapsible.tsx",
	"context-menu.tsx",
	"dialog.tsx",
	"dropdown-menu.tsx",
	"hover-card.tsx",
	"menubar.tsx",
	"navigation-menu.tsx",
	"popover.tsx",
	"progress.tsx",
	"radio-group.tsx",
	"scroll-area.tsx",
	"select.tsx",
	"separator.tsx",
	"sheet.tsx",
	"slider.tsx",
	"switch.tsx",
	"tabs.tsx",
	"toggle.tsx",
	"toggle-group.tsx",
	"tooltip.tsx",
];

const radixEraStaticHookPatterns = [
	{ name: "Radix CSS variable", pattern: /--radix-/ },
	{ name: "Radix open state selector", pattern: /data-\[state=open\]|data-state=open/ },
	{ name: "Radix checked state selector", pattern: /data-\[state=checked\]|data-state=checked/ },
	{ name: "Radix closed state selector", pattern: /data-\[state=closed\]|data-state=closed/ },
	{ name: "Radix open data-state alias", pattern: /["']data-state["']\s*:\s*[^\n;]*\bopen\b/ },
	{ name: "Radix closed data-state alias", pattern: /["']data-state["']\s*:\s*[^\n;]*\bclosed\b/ },
];

function collectActiveSourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		const stat = statSync(path);

		if (stat.isDirectory()) {
			return collectActiveSourceFiles(path);
		}

		if (!/\.(ts|tsx)$/.test(entry) || /\.(test|spec|types)\.(ts|tsx)$/.test(entry)) {
			return [];
		}

		return [path];
	});
}

function allowsRadixEraStateHooks(file: string) {
	return relative(process.cwd(), file) === "src/components/ui/drawer.tsx";
}

function sourceOrLocalReExportsUseBaseUi(file: string) {
	const source = readFileSync(file, "utf8");

	if (source.includes("@base-ui/react")) {
		return true;
	}

	return [...source.matchAll(/export\s+\{[^}]+\}\s+from\s+"(\.\/[^".]+)";/g)].some(
		([, importPath]) =>
			readFileSync(join(dirname(file), `${importPath}.tsx`), "utf8").includes("@base-ui/react"),
	);
}

describe("Base UI wrapper conventions", () => {
	it("uses Base UI for migrated primitive wrappers", () => {
		const missing = wrappersThatShouldUseBaseUi.filter((file) => {
			return !sourceOrLocalReExportsUseBaseUi(join(process.cwd(), "src/components/ui", file));
		});

		expect(missing).toEqual([]);
	});

	it("preserves separator orientation data attribute for styling hooks", () => {
		const source = readFileSync(join(process.cwd(), "src/components/ui/separator.tsx"), "utf8");

		expect(source).toContain("data-orientation={orientation}");
		expect(source).toContain('data-slot="separator"');
	});

	it("keeps the reusable Label wrapper out of the raw unlabeled JSX label shape", () => {
		const source = readFileSync(join(process.cwd(), "src/components/ui/label.tsx"), "utf8");

		expect(source).not.toMatch(/<label\b/);
		expect(source).toContain('data-slot="label"');
	});

	it("uses statically discoverable Base UI state selectors and CSS variables", () => {
		const matches = collectActiveSourceFiles(join(process.cwd(), "src")).flatMap((file) => {
			if (allowsRadixEraStateHooks(file)) {
				return [];
			}

			const source = readFileSync(file, "utf8");
			const filePath = relative(process.cwd(), file);

			return radixEraStaticHookPatterns.flatMap(({ name, pattern }) => {
				const match = source.match(pattern);

				return match ? [{ file: filePath, pattern: name, match: match[0] }] : [];
			});
		});

		expect(matches).toEqual([]);
	});
});
