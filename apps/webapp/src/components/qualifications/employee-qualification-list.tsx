"use client";

import { DateTime } from "luxon";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import { getQualificationStatus } from "@/lib/qualifications/status";

interface EmployeeQualificationListProps {
	qualifications: EmployeeSkillWithDetails[];
	onRenew?: (qualification: EmployeeSkillWithDetails) => void;
}

function getStatusLabel(status: ReturnType<typeof getQualificationStatus>) {
	if (status === "expiringSoon") return "Expiring soon";
	if (status === "expired") return "Expired";
	return "Valid";
}

export function EmployeeQualificationList({ qualifications, onRenew }: EmployeeQualificationListProps) {
	if (qualifications.length === 0) {
		return <p className="text-sm text-muted-foreground">No qualifications assigned.</p>;
	}

	return (
		<div className="space-y-3" aria-label="Employee qualifications">
			{qualifications.map((qualification) => {
				const status = getQualificationStatus({
					expiresAt: qualification.expiresAt,
					warningDays: qualification.skill.expiryWarningDays ?? 30,
				});

				return (
					<div key={qualification.id} className="rounded-lg border p-3">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0 space-y-1">
								<p className="break-words font-medium">{qualification.skill.name}</p>
								{qualification.expiresAt ? (
									<p className="text-xs text-muted-foreground">
										Expires {DateTime.fromJSDate(qualification.expiresAt).toLocaleString(DateTime.DATE_MED)}
									</p>
								) : null}
								{qualification.issuer ? (
									<p className="text-xs text-muted-foreground">Issuer: {qualification.issuer}</p>
								) : null}
								{qualification.certificateNumber ? (
									<p className="text-xs text-muted-foreground">
										Certificate: {qualification.certificateNumber}
									</p>
								) : null}
							</div>
							<Badge variant={status === "expired" ? "destructive" : "secondary"}>
								{getStatusLabel(status)}
							</Badge>
						</div>
						{onRenew ? (
							<Button
								type="button"
								variant="link"
								className="mt-3 h-auto p-0 text-sm font-medium"
								onClick={() => onRenew(qualification)}
							>
								Submit renewal evidence
							</Button>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
