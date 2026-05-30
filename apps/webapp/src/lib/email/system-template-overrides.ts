import { eq } from "drizzle-orm";
import { db } from "@/db";
import { type PlatformSystemEmailTemplateKey, platformSystemEmailTemplate } from "@/db/schema";

export interface PlatformSystemEmailTemplateOverride {
	isEnabled: boolean;
	subject: string;
	html: string;
	plainText: string | null;
}

export async function getPlatformSystemEmailTemplateOverride(
	templateKey: PlatformSystemEmailTemplateKey,
): Promise<PlatformSystemEmailTemplateOverride | null> {
	const template = await db.query.platformSystemEmailTemplate.findFirst({
		columns: {
			isEnabled: true,
			subject: true,
			html: true,
			plainText: true,
		},
		where: eq(platformSystemEmailTemplate.templateKey, templateKey),
	});

	return template ?? null;
}
