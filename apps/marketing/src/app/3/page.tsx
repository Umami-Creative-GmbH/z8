import Image from "next/image";
import Link from "next/link";

export default function Design3() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Courier New', Courier, monospace",
				backgroundColor: "#1a1a1a",
				color: "#d4d4d4",
			}}
		>
			{/* Amber scan line effect */}
			<div
				className="pointer-events-none fixed inset-0 z-0 opacity-[0.02]"
				style={{
					backgroundImage:
						"repeating-linear-gradient(0deg, #f59e0b 0px, transparent 1px, transparent 3px)",
				}}
			/>

			{/* Header */}
			<header
				className="relative z-10 flex items-center justify-between px-6 py-5"
				style={{ borderBottom: "1px solid #f59e0b20" }}
			>
				<div className="flex items-center gap-4">
					<div
						className="flex h-9 w-9 items-center justify-center text-xs font-bold"
						style={{
							backgroundColor: "#f59e0b",
							color: "#1a1a1a",
							clipPath: "polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)",
						}}
					>
						Z8
					</div>
					<span className="text-[10px] uppercase tracking-[0.5em] text-[#f59e0b]/40">
						sys://zeiterfassung
					</span>
				</div>
				<nav className="hidden items-center gap-8 text-[11px] uppercase tracking-[0.15em] md:flex">
					<a href="#features" className="text-[#888] transition-colors hover:text-[#f59e0b]">
						[module]
					</a>
					<a href="#specs" className="text-[#888] transition-colors hover:text-[#f59e0b]">
						[specs]
					</a>
					<a href="#contact" className="text-[#888] transition-colors hover:text-[#f59e0b]">
						[link]
					</a>
				</nav>
				<a
					href="#contact"
					className="px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors"
					style={{
						border: "1px solid #f59e0b",
						color: "#f59e0b",
					}}
				>
					&gt; Init Demo
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 px-6 pb-24 pt-24">
				{/* Status line */}
				<div
					className="animate-fade-in mb-12 flex items-center gap-3 text-[10px] uppercase tracking-[0.3em]"
					style={{ color: "#f59e0b50", animationDelay: "0.1s" }}
				>
					<span
						className="inline-block h-2 w-2 rounded-full"
						style={{ backgroundColor: "#22c55e" }}
					/>
					<span>system online</span>
					<span className="text-[#333]">|</span>
					<span>v8.0.0</span>
					<span className="text-[#333]">|</span>
					<span>uptime: 99.97%</span>
				</div>

				<h1 className="animate-fade-up mb-6" style={{ animationDelay: "0.2s" }}>
					<span
						className="block text-[clamp(2.5rem,9vw,7rem)] font-bold uppercase leading-[0.95] tracking-[-0.03em]"
						style={{ color: "#f59e0b" }}
					>
						Arbeitzeit.
					</span>
					<span className="block text-[clamp(2.5rem,9vw,7rem)] font-bold uppercase leading-[0.95] tracking-[-0.03em] text-[#333]">
						Erfasst.
					</span>
					<span className="block text-[clamp(2.5rem,9vw,7rem)] font-bold uppercase leading-[0.95] tracking-[-0.03em] text-[#333]">
						Gesichert.
					</span>
				</h1>

				<div
					className="animate-fade-up mt-16 grid gap-8 md:grid-cols-2"
					style={{ animationDelay: "0.4s" }}
				>
					<div>
						<p className="max-w-md text-sm leading-[1.9] text-[#666]">
							Industrietaugliche Arbeitszeitverwaltung. GoBD-konform. Revisionssicher. Gebaut
							f&uuml;r Unternehmen, die ihre Infrastruktur ernst nehmen.
						</p>
					</div>
					<div className="flex items-end justify-end">
						<div className="flex gap-4 text-[10px] uppercase tracking-[0.2em]">
							<div className="px-4 py-2" style={{ border: "1px solid #333" }}>
								<span className="text-[#555]">Plattformen</span>
								<br />
								<span style={{ color: "#f59e0b" }}>Web / Desktop / Mobile / Ext</span>
							</div>
							<div className="px-4 py-2" style={{ border: "1px solid #333" }}>
								<span className="text-[#555]">Compliance</span>
								<br />
								<span style={{ color: "#f59e0b" }}>GoBD / WORM / Audit</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Industrial image strip */}
			<section
				className="relative z-10 overflow-hidden"
				style={{ borderTop: "1px solid #f59e0b20", borderBottom: "1px solid #f59e0b20" }}
			>
				<div className="relative h-56">
					<Image
						src="https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=1920&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover opacity-30"
						style={{ filter: "sepia(100%) saturate(300%) hue-rotate(-10deg) brightness(0.7)" }}
					/>
					<div
						className="absolute inset-0"
						style={{
							background:
								"linear-gradient(90deg, #1a1a1a 0%, transparent 30%, transparent 70%, #1a1a1a 100%)",
						}}
					/>
					<div className="absolute inset-0 flex items-center px-6">
						<div className="flex w-full items-center gap-4">
							<span className="text-[10px] uppercase tracking-[0.4em] text-[#f59e0b]/40">
								// system.runtime
							</span>
							<div className="h-px flex-1 bg-[#f59e0b]/10" />
							<span className="text-[10px] uppercase tracking-[0.4em] text-[#f59e0b]/40">
								active_nodes: 847
							</span>
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section
				id="features"
				className="relative z-10 px-6 py-24"
				style={{ borderTop: "1px solid #f59e0b20" }}
			>
				<div className="mb-16 flex items-center gap-4">
					<span className="text-[10px] uppercase tracking-[0.4em] text-[#f59e0b]/50">
						// module.features
					</span>
					<div className="h-px flex-1 bg-[#f59e0b]/10" />
				</div>

				<div className="grid gap-[1px] bg-[#f59e0b]/10 md:grid-cols-2">
					{[
						{
							id: "CLK",
							title: "time.clock()",
							desc: "Stempeln per Klick. Web, Desktop-Widget, Mobile-App, Browser-Extension. Echtzeit-Sync \u00fcber alle Ger\u00e4te.",
							img: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=400&q=80&auto=format&fit=crop",
						},
						{
							id: "SEC",
							title: "audit.secure()",
							desc: "Blockchain-\u00e4hnliche Verkettung aller Zeiteintr\u00e4ge. Manipulationssicher. WORM-f\u00e4hig. Digital signiert.",
							img: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=400&q=80&auto=format&fit=crop",
						},
						{
							id: "EXP",
							title: "payroll.export()",
							desc: "DATEV, Lexware, Personio, SAP SuccessFactors, Sage. Automatisierter Lohnexport ohne Medienbruch.",
							img: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&q=80&auto=format&fit=crop",
						},
						{
							id: "IAM",
							title: "auth.enterprise()",
							desc: "SAML 2.0, OpenID Connect, SCIM Provisioning. Passkeys. Zwei-Faktor. Zero-Trust-ready.",
							img: "https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?w=400&q=80&auto=format&fit=crop",
						},
					].map((f) => (
						<div key={f.id} className="group relative overflow-hidden bg-[#1a1a1a] p-8 transition-colors hover:bg-[#1f1f1f]">
							{/* Subtle background image */}
							<div className="absolute right-0 top-0 h-full w-1/3 overflow-hidden opacity-0 transition-opacity duration-500 group-hover:opacity-[0.08]">
								<Image
									src={f.img}
									alt=""
									fill
									className="object-cover"
									style={{ filter: "sepia(100%) saturate(300%) hue-rotate(-10deg)" }}
								/>
							</div>
							<div className="relative z-10">
								<div className="mb-4 flex items-center gap-3">
									<span
										className="inline-block px-2 py-0.5 text-[10px] font-bold tracking-wider"
										style={{
											backgroundColor: "#f59e0b20",
											color: "#f59e0b",
										}}
									>
										{f.id}
									</span>
									<span className="text-sm font-bold text-[#f59e0b]/80">{f.title}</span>
								</div>
								<p className="text-[13px] leading-[1.8] text-[#666]">{f.desc}</p>
							</div>
						</div>
					))}
				</div>
			</section>

			{/* Specs */}
			<section
				id="specs"
				className="relative z-10 px-6 py-24"
				style={{ borderTop: "1px solid #f59e0b20" }}
			>
				<div className="mb-12 flex items-center gap-4">
					<span className="text-[10px] uppercase tracking-[0.4em] text-[#f59e0b]/50">
						// system.specs
					</span>
					<div className="h-px flex-1 bg-[#f59e0b]/10" />
				</div>

				<div className="grid gap-6 md:grid-cols-4">
					{[
						{ label: "Framework", val: "Next.js 16" },
						{ label: "Database", val: "PostgreSQL" },
						{ label: "Cache", val: "Valkey/Redis" },
						{ label: "Auth", val: "Better Auth" },
						{ label: "ORM", val: "Drizzle" },
						{ label: "Queue", val: "BullMQ" },
						{ label: "Storage", val: "S3-compat" },
						{ label: "Monitoring", val: "OpenTelemetry" },
					].map((s) => (
						<div key={s.label} className="px-4 py-3" style={{ border: "1px solid #282828" }}>
							<span className="block text-[9px] uppercase tracking-[0.3em] text-[#555]">
								{s.label}
							</span>
							<span className="text-sm" style={{ color: "#f59e0b" }}>
								{s.val}
							</span>
						</div>
					))}
				</div>
			</section>

			{/* Full-width server room image */}
			<section
				className="relative z-10 h-48 overflow-hidden"
				style={{ borderTop: "1px solid #f59e0b20" }}
			>
				<Image
					src="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1920&q=80&auto=format&fit=crop"
					alt=""
					fill
					className="object-cover opacity-25"
					style={{ filter: "sepia(100%) saturate(200%) hue-rotate(-10deg) brightness(0.8)" }}
				/>
				<div
					className="absolute inset-0"
					style={{
						background:
							"linear-gradient(90deg, #1a1a1a 0%, transparent 20%, transparent 80%, #1a1a1a 100%)",
					}}
				/>
				<div className="absolute inset-0 flex items-center justify-center">
					<span className="text-[10px] uppercase tracking-[0.5em] text-[#f59e0b]/30">
						// infrastructure.ready
					</span>
				</div>
			</section>

			{/* Contact */}
			<section
				id="contact"
				className="relative z-10 px-6 py-24"
				style={{ borderTop: "1px solid #f59e0b20" }}
			>
				<div className="mx-auto max-w-xl text-center">
					<span className="mb-6 block text-[10px] uppercase tracking-[0.4em] text-[#f59e0b]/50">
						// contact.init
					</span>
					<h2 className="mb-4 text-3xl font-bold uppercase tracking-tight text-[#f59e0b]">
						Deploy starten
					</h2>
					<p className="mb-10 text-sm leading-relaxed text-[#666]">
						Bereit f&uuml;r industrietaugliche Zeiterfassung? Wir richten Z8 f&uuml;r Ihr Team ein.
					</p>
					<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
						<a
							href="mailto:hello@z8.app"
							className="px-8 py-3 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors hover:bg-[#f59e0b]/90"
							style={{ backgroundColor: "#f59e0b", color: "#1a1a1a" }}
						>
							&gt; Demo anfordern
						</a>
						<a
							href="mailto:hello@z8.app"
							className="px-8 py-3 text-[11px] tracking-[0.2em] text-[#555] transition-colors hover:text-[#f59e0b]"
						>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-6 py-6" style={{ borderTop: "1px solid #f59e0b10" }}>
				<div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-[#333]">
					<span>&copy; 2025 Z8 // All rights reserved</span>
					<Link href="/" className="transition-colors hover:text-[#f59e0b]">
						&larr; index
					</Link>
				</div>
			</footer>
		</div>
	);
}
