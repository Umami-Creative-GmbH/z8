import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A temporary copy of `migrationsFolder` whose journal stops at `maxPrefix` (e.g. 327 keeps
 * 0000–0327). Suites that pin one migration phase use it so later migrations do not change the
 * stages, ledger and schema they assert. Call `cleanup` after the suite.
 */
export async function migrationsFolderThrough(
	migrationsFolder: string,
	maxPrefix: number,
): Promise<{ folder: string; cleanup: () => Promise<void> }> {
	const tempDir = await mkdtemp(join(tmpdir(), `z8-migrations-${maxPrefix}-`));
	const folder = join(tempDir, "drizzle");
	await cp(migrationsFolder, folder, { recursive: true });
	const journalPath = join(folder, "meta", "_journal.json");
	const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
		entries: { tag: string }[];
	};
	journal.entries = journal.entries.filter(
		(entry) => Number.parseInt(entry.tag.slice(0, 4), 10) <= maxPrefix,
	);
	await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
	return { folder, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
}
