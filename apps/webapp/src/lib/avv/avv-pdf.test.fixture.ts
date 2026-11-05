import { createRequire } from "node:module";
import { dirname } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { EMPTY_ORGANIZATION_PROFILE } from "@/lib/organization/profile";

/** Read the public document, including embedded fonts' Unicode mappings. */
export async function avvPdfText(pdf: Uint8Array): Promise<string> {
	const task = getDocument({
		data: new Uint8Array(pdf),
		useSystemFonts: false,
		standardFontDataUrl: `${dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"))}/standard_fonts/`,
	});
	const document = await task.promise;
	try {
		const pages: string[] = [];
		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
			const page = await document.getPage(pageNumber);
			const content = await page.getTextContent();
			pages.push(
				content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
			);
		}
		return pages.join("\n");
	} finally {
		await task.destroy();
	}
}

export const minimalAvvProfile = {
	...EMPTY_ORGANIZATION_PROFILE,
	displayName: "Trading display name",
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

export const nonLatinAvvProfiles = [
	{
		...minimalAvvProfile,
		legalCompanyName: "ООО Пример Технологии",
		addressLine1: "улица Академика Королёва, дом 12",
		addressLine2: "офис 24",
		postalCode: "129515",
		city: "Москва",
		stateOrRegion: "Московская область",
		country: "RU",
	},
	{
		...minimalAvvProfile,
		legalCompanyName: "株式会社東京研究所",
		addressLine1: "千代田区丸の内一丁目１番１号",
		addressLine2: "研究棟２階",
		postalCode: "100-0005",
		city: "東京都",
		stateOrRegion: "関東地方",
		country: "JP",
	},
	{
		...minimalAvvProfile,
		legalCompanyName: "上海示例科技有限公司",
		addressLine1: "浦东新区世纪大道１００号",
		addressLine2: "第二座８楼",
		postalCode: "200120",
		city: "上海市",
		stateOrRegion: "上海",
		country: "CN",
	},
];

// At the saved profile's length limits, to exercise wrapping and page flow.
export const longAvvProfile = {
	...fullAvvProfile,
	legalCompanyName: `${"International engineering and workforce services ".repeat(6).slice(0, 285)} LegalEnd GmbH`,
	addressLine1: `${"Very long registered street and industrial campus ".repeat(6).slice(0, 287)} StreetEnd 42`,
	addressLine2: `${"Research building and administrative department ".repeat(7).slice(0, 288)} BuildingEnd`,
	city: `${"Greater metropolitan municipal district ".repeat(6).slice(0, 190)} CityEnd`,
	stateOrRegion: `${"Administrative state and regional jurisdiction ".repeat(5).slice(0, 188)} RegionEnd`,
};
