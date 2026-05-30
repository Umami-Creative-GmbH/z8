"use client";

import type { StaticImageData } from "next/image";
import Image from "next/image";

type AuthBackgroundImageProps = {
	initialImage: StaticImageData;
};

export function AuthBackgroundImage({ initialImage }: AuthBackgroundImageProps) {
	return (
		<Image
			alt=""
			className="absolute inset-0 size-full object-cover"
			fill
			priority
			sizes="100vw"
			src={initialImage}
		/>
	);
}
