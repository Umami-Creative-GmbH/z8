import type { ImportScanJobData } from "./types";

export async function scanClockodoImportPartition(
	_job: ImportScanJobData,
): Promise<{ stagedRows: number; issues: number }> {
	throw new Error("Clockodo import scan is not implemented");
}
