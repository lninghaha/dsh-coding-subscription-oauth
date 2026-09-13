/** @vitest-environment jsdom */
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OpenCodeGoConnectionView, type GoSnapshot, type GoViewProps } from "../src/client/components/OpenCodeGoConnectionView.tsx";
afterEach(cleanup);
function snapshot(revision=2): GoSnapshot {
	return {credential:{selectedRef:"EXISTING_GO_KEY",configured:true,writable:false,requiresChoice:false,candidates:[{ref:"EXISTING_GO_KEY",configured:true,writable:false},{ref:"OPENCODE_GO_API_KEY",configured:false,writable:true}]},configuration:{revision,writable:true,ready:true,conflicts:[],models:[{id:"deepseek-v4.1-flash"}]},call:{active:true,lastCall:"no-call",updatedAt:null}};
}
function props(): GoViewProps {
	const status=snapshot();
	return {status,t:key=>key,onReload:vi.fn(async()=>status),onSaveCredential:vi.fn(async()=>status),onLoadModels:vi.fn(async()=>({models:[{id:"deepseek-v4.1-flash"},{id:"deepseek-v4-flash",reasoningEfforts:{high:"high"}},{id:"gpt-5.6-luna"}]})),onApply:vi.fn(async()=>status),onStartConversation:vi.fn()};
}
it("shows a compact connected summary and initializes the configured credential, respecting source permissions", async()=>{
	const input=props();render(createElement(OpenCodeGoConnectionView,input));
	expect(screen.queryByLabelText("apiKey")).toBeNull();
	fireEvent.click(screen.getByRole("button",{name:"edit"}));
	expect((screen.getByLabelText("credential") as HTMLSelectElement).value).toBe("EXISTING_GO_KEY");
	expect((screen.getByLabelText("apiKey") as HTMLInputElement).disabled).toBe(true);
	fireEvent.change(screen.getByLabelText("credential"),{target:{value:"OPENCODE_GO_API_KEY"}});
	expect((screen.getByLabelText("apiKey") as HTMLInputElement).disabled).toBe(false);
	expect((screen.getByRole("button",{name:"fetchModels"}) as HTMLButtonElement).disabled).toBe(true);
});
it("uses a fresh query revision for new edits and applies the enabled model set", async()=>{
	const input=props();const view=render(createElement(OpenCodeGoConnectionView,input));
	view.rerender(createElement(OpenCodeGoConnectionView,{...input,status:snapshot(9)}));
	fireEvent.click(screen.getByRole("button",{name:"edit"}));
	fireEvent.click(screen.getByRole("button",{name:"fetchModels"}));
	await waitFor(()=>expect(input.onLoadModels).toHaveBeenCalled());
	const flash=await screen.findByRole("checkbox",{name:/deepseek-v4-flash/i});
	fireEvent.click(flash);
	view.rerender(createElement(OpenCodeGoConnectionView,{...input,status:snapshot(10)}));
	fireEvent.click(screen.getByRole("button",{name:"apply"}));
	await waitFor(()=>expect(input.onApply).toHaveBeenCalledWith(expect.objectContaining({expectedRevision:9,credentialRef:"EXISTING_GO_KEY",models:expect.arrayContaining([{id:"deepseek-v4.1-flash"},expect.objectContaining({id:"deepseek-v4-flash"})])})));
});
it("requires explicit credential choice when multiple unbound sources exist",()=>{
	const input=props(), base=snapshot();
	render(createElement(OpenCodeGoConnectionView,{...input,status:{...base,credential:{...base.credential,requiresChoice:true},configuration:{...base.configuration,ready:false}}}));
	expect((screen.getByLabelText("credential") as HTMLSelectElement).value).toBe("");
	expect((screen.getByRole("button",{name:"apply"}) as HTMLButtonElement).disabled).toBe(true);
});
it("retains failed credential input and renders a later cancelled call instead of stale success",async()=>{
	const input={...props(),onSaveCredential:vi.fn(async()=>{throw new Error("storage blocked");})},base=snapshot();
	const view=render(createElement(OpenCodeGoConnectionView,{...input,status:{...base,configuration:{...base.configuration,ready:false}}}));
	fireEvent.change(screen.getByLabelText("credential"),{target:{value:"OPENCODE_GO_API_KEY"}});
	fireEvent.change(screen.getByLabelText("apiKey"),{target:{value:"fixture-only"}});
	fireEvent.click(screen.getByRole("button",{name:"saveKey"}));
	await screen.findByText("storage blocked");
	expect((screen.getByLabelText("apiKey") as HTMLInputElement).value).toBe("fixture-only");
	view.rerender(createElement(OpenCodeGoConnectionView,{...input,call:{active:true,lastCall:"failure",streamStatus:"cancelled",updatedAt:10}}));
	expect(screen.getByText("status.cancelled")).toBeTruthy();
});
it("keeps the model list inside the card instead of a floating datalist", async()=>{
	const input=props();
	render(createElement(OpenCodeGoConnectionView,{...input,status:{...snapshot(),configuration:{...snapshot().configuration,ready:false}}}));
	fireEvent.click(screen.getByRole("button",{name:"fetchModels"}));
	await screen.findByRole("group",{name:"model"});
	expect(document.querySelector("datalist")).toBeNull();
});
