/** @vitest-environment jsdom */
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GrokBuildSettings } from "../src/client/GrokBuildSettings.tsx";
import { en } from "../src/client/locales.ts";
import { LOGIN_PATH, STATUS_PATH } from "../src/client/constants.ts";
const mocks=vi.hoisted(() => ({request:vi.fn()}));
vi.mock("../src/client/api.ts", async () => ({...await vi.importActual<typeof import("../src/client/api.ts")>("../src/client/api.ts"),jsonRequest:mocks.request}));
vi.mock("../src/client/components/AccountsTab.tsx", () => ({AccountsTab:({onSignIn}:{onSignIn:(provider:string,method:string)=>void}) => createElement("button",{onClick:()=>onSignIn("kimi","browser")},"connect fixture")}));
afterEach(() => {cleanup();vi.restoreAllMocks();});
it("successful status refresh does not swallow a failed login operation",async () => {
	vi.spyOn(window,"open").mockReturnValue(null);
	mocks.request.mockImplementation(async (path:string) => {
		if(path===LOGIN_PATH)throw new Error("authorization rejected fixture");
		if(path===STATUS_PATH)return {uiOwner:"standalone",accessMode:"loopback",providers:{grok:{status:"signed-out"},codex:{status:"signed-out"},kimi:{status:"signed-out"},claude:{status:"signed-out"}}};
		return {sources:[]};
	});
	render(createElement(GrokBuildSettings,{t:(key)=>en[key]}));
	await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith(STATUS_PATH));
	fireEvent.click(screen.getByRole("button",{name:"connect fixture"}));
	await screen.findByText("authorization rejected fixture");
	await waitFor(()=>expect(mocks.request.mock.calls.filter(([path])=>path===STATUS_PATH).length).toBeGreaterThan(1));
	expect(screen.getByText("authorization rejected fixture")).toBeTruthy();
});
