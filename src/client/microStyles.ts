/** Injects global keyframes once for skeleton pulse and spinner animations. */

const STYLE_ID = "dsh-coding-oauth-micro-styles";

const CSS = `
@keyframes dsh-coding-oauth-skeleton-pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@keyframes dsh-coding-oauth-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes dsh-coding-oauth-fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

let injected = false;

export function ensureMicroStyles(): void {
	if (injected || typeof document === "undefined") return;
	if (document.getElementById(STYLE_ID) !== null) {
		injected = true;
		return;
	}
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.appendChild(style);
	injected = true;
}
