"use client";

import { useClockinImportController } from "./clockin-import-controller";
import { ClockinImportStepRenderer } from "./clockin-import-steps";

interface ClockinImportWizardProps {
	organizationId: string;
}

export function ClockinImportWizard({
	organizationId,
}: ClockinImportWizardProps) {
	const controller = useClockinImportController(organizationId);
	return <ClockinImportStepRenderer controller={controller} />;
}
