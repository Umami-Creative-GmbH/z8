import { DOMESTIC_PER_DIEM_AREA } from "@/lib/travel-expenses/per-diem";

/** Foreign rate areas ("FR", "FR:paris") of a per diem version (#611). */
export function foreignAreaCount(rates: Record<string, unknown>): number {
	return Object.keys(rates).filter((area) => area !== DOMESTIC_PER_DIEM_AREA).length;
}
