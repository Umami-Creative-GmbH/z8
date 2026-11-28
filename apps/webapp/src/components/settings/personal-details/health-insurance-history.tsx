"use client";

import { useTranslate } from "@tolgee/react";
import type {
	HealthInsuranceView,
	PersonalDetailsHistory,
} from "@/lib/organization/personal-details/types";
import { PersonalDetailsHistoryList, useFormatDay } from "./history-list";
import { healthInsuranceKindLabel } from "./personal-details-copy";

/** The health insurance in force: kind, insurer and, for a picked statutory insurer, its Betriebsnummer. */
export function CurrentHealthInsurance({
	healthInsurance,
}: {
	healthInsurance: PersonalDetailsHistory<HealthInsuranceView>;
}) {
	const { t } = useTranslate();
	const formatDay = useFormatDay();
	const current = healthInsurance.current;
	if (!current?.value) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("settings.personalDetails.healthInsurance.none", "No health insurance on file.")}
			</p>
		);
	}
	return (
		<dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
			<div className="min-w-0">
				<dt className="text-muted-foreground">
					{t("settings.personalDetails.healthInsurance.kind", "Insurance")}
				</dt>
				<dd className="font-medium">{healthInsuranceKindLabel(t, current.value.kind)}</dd>
			</div>
			<div className="min-w-0">
				<dt className="text-muted-foreground">
					{t("settings.personalDetails.healthInsurance.insurer", "Insurer")}
				</dt>
				<dd className="break-words font-medium">{current.value.insurerName}</dd>
			</div>
			<div className="min-w-0">
				<dt className="text-muted-foreground">
					{t("settings.personalDetails.healthInsurance.betriebsnummer", "Betriebsnummer")}
				</dt>
				<dd className="font-mono font-medium tabular-nums" translate="no">
					{current.value.betriebsnummer ?? "—"}
				</dd>
			</div>
			<div className="min-w-0">
				<dt className="text-muted-foreground">
					{t("settings.personalDetails.validFrom", "Valid from")}
				</dt>
				<dd className="font-medium tabular-nums">{formatDay(current.validFrom)}</dd>
			</div>
		</dl>
	);
}

/** Every health insurance entry, latest valid-from first. */
export function HealthInsuranceHistoryList({
	healthInsurance,
	on,
}: {
	healthInsurance: PersonalDetailsHistory<HealthInsuranceView>;
	on: string;
}) {
	const { t } = useTranslate();
	return (
		<PersonalDetailsHistoryList
			history={healthInsurance}
			on={on}
			describe={(value) => (
				<>
					{healthInsuranceKindLabel(t, value.kind)} · {value.insurerName}
					{value.betriebsnummer ? (
						<>
							{" "}
							·{" "}
							<span className="font-mono tabular-nums" translate="no">
								{value.betriebsnummer}
							</span>
						</>
					) : null}
				</>
			)}
		/>
	);
}
