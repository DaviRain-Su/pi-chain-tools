function bindCopy(buttonId, commandId) {
	const button = document.getElementById(buttonId);
	const commandElement = document.getElementById(commandId);
	if (!button || !commandElement) return;

	button.addEventListener("click", async () => {
		const value = commandElement.textContent?.trim() ?? "";
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			button.textContent = "Copied";
			setTimeout(() => {
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

	revealItems.forEach((item, index) => {
		item.style.transitionDelay = `${Math.min(index * 50, 250)}ms`;
		observer.observe(item);
	});
}
