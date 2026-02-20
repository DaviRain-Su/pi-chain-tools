function bindCopy(buttonId, commandId) {
	const button = document.getElementById(buttonId);
	const commandElement = document.getElementById(commandId);
	if (!button || !commandElement) return;

	button.addEventListener("click", async () => {
		const value = commandElement.textContent?.trim() ?? "";
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			button.classList.add("is-copied");
			button.textContent = "✓ Copied";
			setTimeout(() => {
				button.classList.remove("is-copied");
				button.textContent = "Copy";
			}, 1400);
		} catch {
			button.textContent = "Copy failed";
			setTimeout(() => {
				button.textContent = "Copy";
			}, 1400);
		}
	});
}

bindCopy("copy-button", "install-command");
bindCopy("audit-copy", "audit-command");
bindCopy("demo-lint-copy", "demo-lint");
bindCopy("demo-schema-audit-copy", "demo-schema-audit");
bindCopy("demo-check-copy", "demo-check");
bindCopy("demo-test-copy", "demo-test");
bindCopy("demo-security-copy", "demo-security");

const STEP_HIGHLIGHT_CLASS = "step-highlight";
const STEP_HIGHLIGHT_DURATION_MS = 2200;

function scrollAndHighlight(targetSelector) {
	const section = document.querySelector(targetSelector);
	if (!section) return;
	section.scrollIntoView({ behavior: "smooth", block: "start" });
	section.classList.remove(STEP_HIGHLIGHT_CLASS);
	void section.offsetHeight;
	section.classList.add(STEP_HIGHLIGHT_CLASS);
	setTimeout(() => {
		section.classList.remove(STEP_HIGHLIGHT_CLASS);
	}, STEP_HIGHLIGHT_DURATION_MS);
}

const stepButtons = Array.from(document.querySelectorAll("[data-step-target]"));

for (const button of stepButtons) {
	button.addEventListener("click", () => {
		const targetSelector = button.getAttribute("data-step-target");
		if (!targetSelector) return;
		scrollAndHighlight(targetSelector);
	});
}

const topNavToggle = document.getElementById("top-nav-toggle");
const topNavLinks = document.getElementById("top-nav-links");
const navLinks = Array.from(document.querySelectorAll("[data-nav-link]"));
const progressBar = document.getElementById("scroll-progress-bar");

if (topNavToggle && topNavLinks) {
	topNavToggle.addEventListener("click", () => {
		const isOpen = topNavLinks.classList.toggle("is-open");
		topNavToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
	});

	for (const link of topNavLinks.querySelectorAll("a")) {
		link.addEventListener("click", () => {
			topNavLinks.classList.remove("is-open");
			topNavToggle.setAttribute("aria-expanded", "false");
		});
	}
}

function updateScrollProgress() {
	if (!progressBar) return;
	const doc = document.documentElement;
	const maxScroll = Math.max(doc.scrollHeight - window.innerHeight, 1);
	const progress = Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
	progressBar.style.transform = `scaleX(${progress})`;
}

function setActiveNavLink(sectionId) {
	for (const link of navLinks) {
		const href = link.getAttribute("href") || "";
		if (href === `#${sectionId}`) {
			link.classList.add("is-active");
		} else {
			link.classList.remove("is-active");
		}
	}
}

const sectionEls = navLinks
	.map((link) => {
		const href = link.getAttribute("href") || "";
		if (!href.startsWith("#")) return null;
		return document.querySelector(href);
	})
	.filter(Boolean);

if (sectionEls.length > 0) {
	const sectionObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				if (!entry.target.id) continue;
				setActiveNavLink(entry.target.id);
			}
		},
		{ threshold: 0.35 },
	);
	for (const section of sectionEls) {
		sectionObserver.observe(section);
	}
}

window.addEventListener("scroll", updateScrollProgress, { passive: true });
window.addEventListener("resize", updateScrollProgress);
updateScrollProgress();

const revealItems = Array.from(document.querySelectorAll(".reveal"));

if (revealItems.length > 0) {
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				entry.target.classList.add("is-visible");
			}
		},
		{
			threshold: 0.08,
		},
	);

	let index = 0;
	for (const item of revealItems) {
		item.style.transitionDelay = `${Math.min(index * 50, 250)}ms`;
		index += 1;
		observer.observe(item);
	}
}
