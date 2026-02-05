import Image from "next/image";
import Link from "next/link";

export default function Design11() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
				backgroundColor: "#09090b",
				color: "#e4e4e7",
			}}
		>
			{/* Gradient glow background */}
			<div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
				<div
					className="absolute left-1/4 top-0 h-[600px] w-[600px] rounded-full opacity-15 blur-[150px]"
					style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)" }}
				/>
				<div
					className="absolute bottom-0 right-1/4 h-[500px] w-[500px] rounded-full opacity-10 blur-[130px]"
					style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}
				/>
			</div>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-6 py-5" style={{ borderBottom: "1px solid #ffffff08" }}>
				<div className="flex items-center gap-3">
					<div
						className="flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold"
						style={{
							background: "linear-gradient(135deg, #a855f7, #ec4899)",
						}}
					>
						Z8
					</div>
					<span className="text-[11px] text-[#71717a]">zeiterfassung</span>
				</div>
				<nav className="hidden items-center gap-8 text-[11px] text-[#52525b] md:flex">
					<a href="#features" className="transition-colors hover:text-[#a855f7]">features</a>
					<a href="#stack" className="transition-colors hover:text-[#a855f7]">stack</a>
					<a href="#contact" className="transition-colors hover:text-[#a855f7]">contact</a>
				</nav>
				<a
					href="#contact"
					className="rounded-lg px-4 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-80"
					style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)" }}
				>
					get started
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 px-6 pb-20 pt-28">
				<div className="mx-auto max-w-4xl">
					<div
						className="animate-fade-in mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px]"
						style={{
							border: "1px solid #a855f720",
							color: "#a855f7",
							animationDelay: "0.1s",
						}}
					>
						<span className="h-1.5 w-1.5 rounded-full bg-[#a855f7]" />
						v8.0 &mdash; jetzt verf&uuml;gbar
					</div>

					<h1
						className="animate-fade-up text-[clamp(3rem,8vw,6rem)] font-bold leading-[0.95] tracking-[-0.04em]"
						style={{ animationDelay: "0.2s" }}
					>
						<span className="block text-white">zeit.</span>
						<span
							className="block bg-clip-text text-transparent"
							style={{ backgroundImage: "linear-gradient(135deg, #a855f7, #ec4899, #f97316)" }}
						>
							tracking.
						</span>
						<span className="block text-[#3f3f46]">perfected.</span>
					</h1>

					<p
						className="animate-fade-up mt-8 max-w-lg text-[14px] leading-[1.8] text-[#71717a]"
						style={{ animationDelay: "0.4s" }}
					>
						GoBD-konforme Arbeitszeitverwaltung, die so modern ist wie Ihr Tech-Stack.
						Revisionssicher, blitzschnell, &uuml;berall verf&uuml;gbar.
					</p>

					<div
						className="animate-fade-up mt-10 flex gap-3"
						style={{ animationDelay: "0.5s" }}
					>
						<a
							href="#contact"
							className="rounded-lg px-6 py-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-80"
							style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)" }}
						>
							kostenlos starten
						</a>
						<a
							href="#features"
							className="rounded-lg px-6 py-3 text-[12px] text-[#71717a] transition-colors hover:text-white"
							style={{ border: "1px solid #27272a" }}
						>
							docs &rarr;
						</a>
					</div>
				</div>
			</section>

			{/* Terminal preview image */}
			<section className="relative z-10 mx-6 mb-24">
				<div
					className="animate-scale-in relative mx-auto max-w-4xl overflow-hidden rounded-xl"
					style={{
						border: "1px solid #27272a",
						animationDelay: "0.6s",
					}}
				>
					{/* Window chrome */}
					<div className="flex items-center gap-2 border-b border-[#27272a] bg-[#18181b] px-4 py-3">
						<div className="h-3 w-3 rounded-full bg-[#ef4444]/60" />
						<div className="h-3 w-3 rounded-full bg-[#eab308]/60" />
						<div className="h-3 w-3 rounded-full bg-[#22c55e]/60" />
						<span className="ml-3 text-[10px] text-[#52525b]">z8.app/dashboard</span>
					</div>
					<div className="relative h-[40vh]">
						<Image
							src="https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=1200&q=80&auto=format&fit=crop"
							alt="Dashboard"
							fill
							className="object-cover"
							style={{ filter: "brightness(0.8) saturate(1.2)" }}
						/>
						<div
							className="absolute inset-0"
							style={{
								background: "linear-gradient(180deg, rgba(9,9,11,0) 60%, rgba(9,9,11,0.5) 100%)",
							}}
						/>
					</div>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-6 pb-24">
				<div className="mx-auto max-w-4xl">
					<p className="mb-12 text-[11px] text-[#52525b]">
						<span style={{ color: "#a855f7" }}>#</span> features
					</p>

					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "clock()", desc: "Ein-/Ausstempeln per Web, Desktop, Mobile, Extension.", color: "#a855f7" },
							{ title: "audit()", desc: "GoBD-konform. Revisionssicher. WORM-f\u00e4hig.", color: "#ec4899" },
							{ title: "export()", desc: "DATEV, Lexware, Personio, SAP. Automatisiert.", color: "#f97316" },
							{ title: "teams()", desc: "Multi-Tenant. Rollen, Abteilungen, Berechtigungen.", color: "#06b6d4" },
							{ title: "auth()", desc: "SAML, OIDC, SCIM, Passkeys. Zero-Trust.", color: "#3b82f6" },
							{ title: "stats()", desc: "\u00dcberstunden, Trends, Dashboards. Live.", color: "#22c55e" },
						].map((f, i) => (
							<div
								key={i}
								className="group rounded-xl p-6 transition-colors"
								style={{ border: "1px solid #27272a", backgroundColor: "#09090b" }}
							>
								<span
									className="mb-3 block text-[12px] font-bold"
									style={{ color: f.color }}
								>
									{f.title}
								</span>
								<p className="text-[12px] leading-[1.7] text-[#71717a]">{f.desc}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image strip */}
			<section className="relative z-10 mx-6 mb-24">
				<div className="mx-auto grid max-w-4xl gap-3 md:grid-cols-3">
					<div className="relative h-48 overflow-hidden rounded-xl" style={{ border: "1px solid #27272a" }}>
						<Image src="https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover opacity-60" />
					</div>
					<div className="relative h-48 overflow-hidden rounded-xl" style={{ border: "1px solid #27272a" }}>
						<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover opacity-60" />
					</div>
					<div className="relative h-48 overflow-hidden rounded-xl" style={{ border: "1px solid #27272a" }}>
						<Image src="https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover opacity-60" />
					</div>
				</div>
			</section>

			{/* Stack */}
			<section id="stack" className="relative z-10 px-6 pb-24">
				<div className="mx-auto max-w-4xl">
					<p className="mb-8 text-[11px] text-[#52525b]">
						<span style={{ color: "#a855f7" }}>#</span> stack
					</p>
					<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
						{[
							{ label: "Runtime", val: "Next.js 16" },
							{ label: "Database", val: "PostgreSQL" },
							{ label: "Cache", val: "Valkey" },
							{ label: "Auth", val: "Better Auth" },
							{ label: "ORM", val: "Drizzle" },
							{ label: "Queue", val: "BullMQ" },
							{ label: "Storage", val: "S3" },
							{ label: "APM", val: "OpenTelemetry" },
						].map((s) => (
							<div
								key={s.label}
								className="rounded-lg px-4 py-3"
								style={{ border: "1px solid #27272a" }}
							>
								<span className="block text-[9px] uppercase tracking-wider text-[#52525b]">
									{s.label}
								</span>
								<span className="text-[12px]" style={{ color: "#a855f7" }}>
									{s.val}
								</span>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-6 py-24">
				<div
					className="mx-auto max-w-2xl overflow-hidden rounded-2xl p-12 text-center"
					style={{
						border: "1px solid #27272a",
						background: "linear-gradient(180deg, #18181b 0%, #09090b 100%)",
					}}
				>
					<h2 className="mb-4 text-3xl font-bold tracking-tight text-white">
						ready to ship?
					</h2>
					<p className="mb-8 text-[13px] leading-relaxed text-[#71717a]">
						Starten Sie kostenlos. Keine Kreditkarte. Kein Setup.
					</p>
					<a
						href="mailto:hello@z8.app"
						className="inline-block rounded-lg px-8 py-3.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-80"
						style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)" }}
					>
						get started free
					</a>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-6 py-6" style={{ borderTop: "1px solid #ffffff08" }}>
				<div className="flex items-center justify-between text-[10px] text-[#3f3f46]">
					<span>&copy; 2025 z8</span>
					<Link href="/" className="transition-colors hover:text-[#a855f7]">
						&larr; all designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
