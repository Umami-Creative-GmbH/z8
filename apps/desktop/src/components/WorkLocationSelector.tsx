import { useI18n } from "../lib/i18n";
import {
	IconBuilding,
	IconHome,
	IconMapPin,
	IconCompass,
} from "@tabler/icons-react";
import { WORK_LOCATION_OPTIONS, type WorkLocationType } from "../types";

// Match the webapp work-location indicator and clock selector.
const workLocationIcons = {
	office: IconBuilding,
	home: IconHome,
	remote: IconMapPin,
	other: IconCompass,
};

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
				{WORK_LOCATION_OPTIONS.map((option) => {
					const Icon = workLocationIcons[option.value];
					return (
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
							<Icon size={16} aria-hidden="true" />
							<span>{t(option.label)}</span>
						</label>
					);
				})}
			</div>
		</div>
	);
}
