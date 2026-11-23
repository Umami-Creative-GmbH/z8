"use client";
import {
	IconBus,
	IconCar,
	IconCaravan,
	IconMoped,
	IconMotorbike,
	IconTractor,
	IconTruck,
	IconTruckDelivery,
	type TablerIcon,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import {
	isLicenceClass,
	LICENCE_CLASS_INFO,
	type LicenceClass,
	type LicenceClassGroup,
} from "@/lib/organization/driving-licence/check-types";
import { cn } from "@/lib/utils";

/**
 * One look for licence classes everywhere (#2003): a vehicle icon, the class code and a plain
 * name, so "CE" reads as "truck with trailer" for people who don't know the codes.
 */

const VEHICLE_ICON: Record<LicenceClass, TablerIcon> = {
	AM: IconMoped,
	A1: IconMotorbike,
	A2: IconMotorbike,
	A: IconMotorbike,
	B: IconCar,
	BE: IconCar,
	C1: IconTruckDelivery,
	C1E: IconTruckDelivery,
	C: IconTruck,
	CE: IconTruck,
	D1: IconBus,
	D1E: IconBus,
	D: IconBus,
	DE: IconBus,
	L: IconTractor,
	T: IconTractor,
};

/** The class's vehicle, with a trailer next to it for the E classes. Decorative. */
export function LicenceClassIcon({
	code,
	className,
	size = "md",
}: {
	code: string;
	className?: string;
	size?: "sm" | "md" | "lg";
}) {
	if (!isLicenceClass(code)) return null;
	const Vehicle = VEHICLE_ICON[code];
	const iconSize = size === "lg" ? "size-7" : size === "md" ? "size-5" : "size-4";
	const trailerSize = size === "lg" ? "size-5" : size === "md" ? "size-3.5" : "size-3";
	return (
		<span aria-hidden="true" className={cn("inline-flex shrink-0 items-end", className)}>
			<Vehicle className={iconSize} stroke={1.75} />
			{LICENCE_CLASS_INFO[code].trailer ? (
				<IconCaravan className={cn(trailerSize, "-ml-0.5 opacity-80")} stroke={1.75} />
			) : null}
		</span>
	);
}

/** Plain names of the classes and their vehicle groups. */
export function useLicenceClassNames() {
	const { t } = useTranslate();
	const classes: Record<LicenceClass, string> = {
		AM: t("drivingLicence.class.name.AM", "Moped"),
		A1: t("drivingLicence.class.name.A1", "Light motorcycle"),
		A2: t("drivingLicence.class.name.A2", "Mid-size motorcycle"),
		A: t("drivingLicence.class.name.A", "Motorcycle"),
		B: t("drivingLicence.class.name.B", "Car"),
		BE: t("drivingLicence.class.name.BE", "Car with trailer"),
		C1: t("drivingLicence.class.name.C1", "Light truck"),
		C1E: t("drivingLicence.class.name.C1E", "Light truck with trailer"),
		C: t("drivingLicence.class.name.C", "Truck"),
		CE: t("drivingLicence.class.name.CE", "Truck with trailer"),
		D1: t("drivingLicence.class.name.D1", "Minibus"),
		D1E: t("drivingLicence.class.name.D1E", "Minibus with trailer"),
		D: t("drivingLicence.class.name.D", "Bus"),
		DE: t("drivingLicence.class.name.DE", "Bus with trailer"),
		L: t("drivingLicence.class.name.L", "Slow tractor"),
		T: t("drivingLicence.class.name.T", "Tractor"),
	};
	const groups: Record<LicenceClassGroup, string> = {
		motorcycle: t("drivingLicence.class.group.motorcycle", "Mopeds and motorcycles"),
		car: t("drivingLicence.class.group.car", "Cars"),
		truck: t("drivingLicence.class.group.truck", "Trucks"),
		bus: t("drivingLicence.class.group.bus", "Buses"),
		tractor: t("drivingLicence.class.group.tractor", "Tractors"),
	};
	return {
		className: (code: string) => (isLicenceClass(code) ? classes[code] : code),
		groupName: (group: LicenceClassGroup) => groups[group],
	};
}

/** Icon, code and name in one line, for tables and lists. */
export function LicenceClassLabel({
	code,
	showName = true,
	className,
}: {
	code: string;
	showName?: boolean;
	className?: string;
}) {
	const { className: nameOf } = useLicenceClassNames();
	return (
		<span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
			<LicenceClassIcon code={code} size="sm" className="text-muted-foreground" />
			<span className="font-medium" translate="no">
				{code}
			</span>
			{showName ? " " : null}
			{showName ? <span className="truncate text-muted-foreground">{nameOf(code)}</span> : null}
		</span>
	);
}

/**
 * A compact class chip. `declared` chips are dashed and muted: the employee's own statement,
 * never to be read as permission to drive.
 */
export function LicenceClassChip({
	code,
	tone = "declared",
}: {
	code: string;
	tone?: "declared" | "authorized";
}) {
	const { className: nameOf } = useLicenceClassNames();
	return (
		<span
			title={nameOf(code)}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
				tone === "declared"
					? "border-dashed bg-muted/40 text-muted-foreground"
					: "border-success/40 bg-success/10 text-success",
			)}
		>
			<LicenceClassIcon code={code} size="sm" />
			<span className="font-medium" translate="no">
				{code}
			</span>
			<span className="sr-only"> {nameOf(code)}</span>
		</span>
	);
}
