"use client";

import { useClockinImportController } from "./clockin-import-controller";
import { ClockinImportStepRenderer } from "./clockin-import-steps";

/** Imports run in the caller's active organization; the actions take it from the session. */
export function ClockinImportWizard() {
	const controller = useClockinImportController();
	return <ClockinImportStepRenderer controller={controller} />;
}
