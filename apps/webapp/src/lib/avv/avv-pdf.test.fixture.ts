import { EMPTY_ORGANIZATION_PROFILE } from "@/lib/organization/profile";

export const minimalAvvProfile = {
	...EMPTY_ORGANIZATION_PROFILE,
	displayName: "Umami",
	legalCompanyName: "Umami Creative Legal GmbH",
	addressLine1: "Example Street 7",
	postalCode: "10115",
	city: "Berlin",
	country: "DE",
};

export const fullAvvProfile = {
	...minimalAvvProfile,
	addressLine2: "Building B, Floor 2",
	stateOrRegion: "Berlin region",
	vatId: "DE123456789",
};

// At the saved profile's length limits, to exercise wrapping and page flow.
export const longAvvProfile = {
	...fullAvvProfile,
	legalCompanyName: `${"International engineering and workforce services ".repeat(6).slice(0, 285)} LegalEnd GmbH`,
	addressLine1: `${"Very long registered street and industrial campus ".repeat(6).slice(0, 287)} StreetEnd 42`,
	addressLine2: `${"Research building and administrative department ".repeat(7).slice(0, 288)} BuildingEnd`,
	city: `${"Greater metropolitan municipal district ".repeat(6).slice(0, 190)} CityEnd`,
	stateOrRegion: `${"Administrative state and regional jurisdiction ".repeat(5).slice(0, 188)} RegionEnd`,
};
