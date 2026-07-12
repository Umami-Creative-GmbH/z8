import type { WorkPolicyWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Badge } from "@/components/ui/badge";

export function WorkPolicyBreakRulesCell({ policy }: { policy: WorkPolicyWithDetails }) {
	if (!policy.regulationEnabled || !policy.regulation) {
		return <div className="text-center text-muted-foreground">-</div>;
	}
	return (
		<div className="text-center">
			<Badge variant="outline">{policy.regulation.breakRules?.length || 0}</Badge>
		</div>
	);
}
