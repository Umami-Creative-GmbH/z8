"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { EmployeeQualificationList } from "@/components/qualifications/employee-qualification-list";
import { RenewalSubmissionDialog } from "@/components/qualifications/renewal-submission-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";

interface MyQualificationsClientProps {
	qualifications: EmployeeSkillWithDetails[];
}

export function MyQualificationsClient({ qualifications }: MyQualificationsClientProps) {
	const { t } = useTranslate();
	const [selectedQualificationId, setSelectedQualificationId] = useState<string | null>(null);
	const selectedQualification =
		qualifications.find((qualification) => qualification.id === selectedQualificationId) ?? null;

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<Card>
				<CardHeader>
					<CardTitle>{t("myQualifications.title", "My Qualifications")}</CardTitle>
					<CardDescription>
						{t(
							"myQualifications.description",
							"View your licenses, trainings, certificates, and renewal status.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<EmployeeQualificationList
						qualifications={qualifications}
						onRenew={(qualification) => setSelectedQualificationId(qualification.id)}
					/>
					<RenewalSubmissionDialog
						qualification={selectedQualification}
						open={selectedQualification !== null}
						onOpenChange={(open) => {
							if (!open) setSelectedQualificationId(null);
						}}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
