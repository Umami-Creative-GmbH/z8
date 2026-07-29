"use client";

import { useClockodoImportController } from "./clockodo-import-controller";
import { ClockodoImportStepRenderer } from "./clockodo-import-steps";

interface ClockodoImportWizardProps {
	organizationId: string;
}

export function ClockodoImportWizard({
	organizationId,
}: ClockodoImportWizardProps) {
	const controller = useClockodoImportController(organizationId);
	return <ClockodoImportStepRenderer controller={controller} />;
}
