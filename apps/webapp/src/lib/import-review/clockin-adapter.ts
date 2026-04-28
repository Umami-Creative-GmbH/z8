import type { ImportScanJobData } from "./types";

export async function scanClockinImportPartition(_job: ImportScanJobData): Promise<number> {
	throw new Error("Clockin import scan is not implemented");
}
