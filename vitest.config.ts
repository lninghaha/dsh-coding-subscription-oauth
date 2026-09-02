import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.spec.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: ["src/web-origin.ts", "src/gateway-routes.ts"],
			// Advisory floors for security-critical modules (aggregate over include).
			// Measured green baseline ~78% statements / ~76% branches / ~78% lines.
			thresholds: {
				statements: 70,
				branches: 70,
				functions: 90,
				lines: 70,
			},
		},
	},
});
