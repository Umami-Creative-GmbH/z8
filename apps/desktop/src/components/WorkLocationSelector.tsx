import { useI18n } from "../lib/i18n";
import { IconMapPin } from "@tabler/icons-react";
import { WORK_LOCATION_OPTIONS, type WorkLocationType } from "../types";

interface WorkLocationSelectorProps {
	value: WorkLocationType;
	onChange: (value: WorkLocationType) => void;
	disabled?: boolean;
}

export function WorkLocationSelector({
	value,
	onChange,
	disabled,
}: WorkLocationSelectorProps) {
	const { t } = useI18n();
	return (
		<div className="work-location-selector" aria-label={t("Work location")}>
			<div className="work-location-label">
				<IconMapPin size={14} aria-hidden="true" />
				<span>{t("Work location")}</span>
			</div>
			<div
				className="work-location-options"
				role="radiogroup"
				aria-label={t("Work location")}
			>
				{WORK_LOCATION_OPTIONS.map((option) => (
					<label
						key={option.value}
						className={`work-location-option ${value === option.value ? "work-location-option-active" : ""} ${disabled ? "work-location-option-disabled" : ""}`}
					>
						<input
							type="radio"
							name="work-location"
							className="work-location-input"
							checked={value === option.value}
							disabled={disabled}
							onChange={() => onChange(option.value)}
						/>
						{t(option.label)}
					</label>
				))}
			</div>
		</div>
	);
}
