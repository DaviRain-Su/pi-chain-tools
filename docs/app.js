const copyButton = document.getElementById("copy-button");
const commandElement = document.getElementById("install-command");

if (copyButton && commandElement) {
	copyButton.addEventListener("click", async () => {
		const value = commandElement.textContent?.trim() ?? "";
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			copyButton.textContent = "Copied";
			setTimeout(() => {
				copyButton.textContent = "Copy";
			}, 1400);
		} catch {
			copyButton.textContent = "Copy failed";
			setTimeout(() => {
				copyButton.textContent = "Copy";
			}, 1400);
		}
	});
}

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
