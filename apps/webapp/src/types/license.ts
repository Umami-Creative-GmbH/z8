export type LicenseInfo = {
	name: string;
	version: string;
	license: string;
	repository?: string | { type?: string; url?: string; directory?: string };
	author?: string | { name?: string; email?: string };
	homepage?: string;
};

export type LicenseReport = LicenseInfo[];
