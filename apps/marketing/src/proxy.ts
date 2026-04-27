import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale } from "@/i18n/locales";

const localeLikeSegment = /^[a-z]{2}$/;

export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (pathname === "/") {
		const url = request.nextUrl.clone();
		url.pathname = `/${defaultLocale}`;
		return NextResponse.redirect(url);
	}

	const [firstSegment, ...rest] = pathname.split("/").filter(Boolean);

	if (firstSegment && localeLikeSegment.test(firstSegment) && !isLocale(firstSegment)) {
		const url = request.nextUrl.clone();
		url.pathname = `/${defaultLocale}${rest.length > 0 ? `/${rest.join("/")}` : ""}`;
		return NextResponse.redirect(url);
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/((?!_next|.*\\..*).*)"],
};
