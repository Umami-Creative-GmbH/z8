"use client";

import { useClockodoImportController } from "./clockodo-import-controller";
import { ClockodoImportStepRenderer } from "./clockodo-import-steps";

/** Imports run in the caller's active organization; the actions take it from the session. */
export function ClockodoImportWizard() {
	const controller = useClockodoImportController();
	return <ClockodoImportStepRenderer controller={controller} />;
}
