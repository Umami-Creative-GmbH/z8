import type { EnterpriseIdentitySetupResponse } from "@/app/[locale]/(app)/settings/enterprise/actions";

interface IdentitySetupWizardProps {
	initialSetup: EnterpriseIdentitySetupResponse;
	organizationId: string;
}

export function IdentitySetupWizard({ initialSetup, organizationId }: IdentitySetupWizardProps) {
	return (
		<section className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
			<div className="space-y-2">
				<h2 className="text-lg font-semibold">Setup wizard coming next</h2>
				<p className="text-sm text-muted-foreground">
					The enterprise identity setup shell is ready for organization {organizationId}.
				</p>
				<p className="text-sm text-muted-foreground">
					Current setup step: {initialSetup.state.currentStep}
				</p>
			</div>
		</section>
	);
}
