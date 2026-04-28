import type { ImportCommitJobData } from "./types";

export async function commitAcceptedRowsForEntity(_job: ImportCommitJobData): Promise<number> {
	throw new Error("Import review commit is not implemented");
}
