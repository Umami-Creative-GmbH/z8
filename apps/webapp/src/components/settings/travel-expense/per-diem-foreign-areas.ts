import { DOMESTIC_PER_DIEM_AREA } from "@/lib/travel-expenses/per-diem";

/**
 * Foreign rate areas of a per diem version or table (#611): countries ("FR")
 * and listed cities ("FR:paris"). The catalog summary and the adopted version
 * row both count through this, so they describe the same table alike (#689).
 */
export function foreignAreaCounts(rates: Record<string, unknown>): {
	countries: number;
	places: number;
} {
	const areas = Object.keys(rates).filter((area) => area !== DOMESTIC_PER_DIEM_AREA);
	const places = areas.filter((area) => area.includes(":")).length;
	return { countries: areas.length - places, places };
}
