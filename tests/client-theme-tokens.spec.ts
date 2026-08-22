/** Theme-token contracts for Settings UI (light + dark readable contrast). */

import { describe, expect, it } from "vitest";
import { badgeStyle, primaryButtonStyle, statusToneColor, stepNumberActiveStyle } from "../src/client/styles.ts";

describe("Settings theme token contracts", () => {
	it("primary CTAs use DSH primary fill + foreground pairing (not hardcoded white)", () => {
		expect(String(primaryButtonStyle.background)).toContain("--dsw-alias-button-primary-fill");
		expect(String(primaryButtonStyle.color)).toContain("--dsw-alias-label-primary-foreground");
		expect(String(primaryButtonStyle.color)).not.toMatch(/#fff/i);
		expect(String(primaryButtonStyle.background)).not.toContain("--dsw-alias-brand-primary");
	});

	it("active step markers use the same primary fill/foreground pairing", () => {
		expect(String(stepNumberActiveStyle.background)).toContain("--dsw-alias-button-primary-fill");
		expect(String(stepNumberActiveStyle.color)).toContain("--dsw-alias-label-primary-foreground");
		expect(String(stepNumberActiveStyle.color)).not.toMatch(/#fff/i);
	});

	it("uses the real DSH warn token spelling and readable neutral labels", () => {
		expect(statusToneColor("warning")).toContain("--dsw-alias-state-warn-primary");
		expect(statusToneColor("warning")).not.toContain("state-warning");
		expect(statusToneColor("neutral")).toContain("--dsw-alias-label-tertiary");
		expect(statusToneColor("neutral")).not.toContain("label-dimmed");
		expect(String(badgeStyle("neutral").color)).toContain("label-tertiary");
	});
});
