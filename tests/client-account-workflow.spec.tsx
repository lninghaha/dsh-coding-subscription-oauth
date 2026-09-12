/** @vitest-environment jsdom */
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderCard, type ProviderCardProps } from "../src/client/components/ProviderCard.tsx";
import { PROVIDERS } from "../src/client/constants.ts";
import { en } from "../src/client/locales.ts";

afterEach(cleanup);
const signedIn = { status: "signed-in" as const, provider: "kimi" as const, route: "kimi", displayName: "Kimi", loginMethods: ["browser" as const], recommendedLoginMethod: "browser" as const,
	models: ["model-a"], available: ["model-a", "model-b"], selected: ["model-a"], accounts: [{id:"account-a",expires:2_000_000_000_000}], activeAccountId:"account-a" };
function props(): ProviderCardProps {
	return { t: (key) => en[key], definition: PROVIDERS.find((item) => item.slug === "kimi")!, providerStatus: signedIn,
		busy:false,sourcesBusy:false,remote:false,codeInput:"",popupBlocked:false,expanded:true,source:undefined,showUsage:false,usage:undefined,usageError:undefined,usageLoading:false,
		onSignIn:vi.fn(),onSignOut:vi.fn(),onCancelLogin:vi.fn(),onSubmitCode:vi.fn(),onCodeChange:vi.fn(),onToggleExpanded:vi.fn(),onPreviewSource:vi.fn(),onSaveModels:vi.fn(async () => undefined),onSetDefaultAccount:vi.fn(),onRemoveAccount:vi.fn(async () => true),onRetryStatus:vi.fn() };
}
it("login initializes model choices; subsequent background refresh preserves edited choices", () => {
	const options=props();
	const view=render(createElement(ProviderCard,{...options,providerStatus:{...signedIn,status:"signed-out",available:[],selected:[],models:[]}}));
	view.rerender(createElement(ProviderCard,options));
	expect((screen.getByRole("checkbox",{name:"model-a"}) as HTMLInputElement).checked).toBe(true);
	fireEvent.click(screen.getByRole("checkbox",{name:"model-a"}));
	view.rerender(createElement(ProviderCard,{...options,providerStatus:{...signedIn,selected:["model-a","model-b"]}}));
	expect((screen.getByRole("checkbox",{name:"model-a"}) as HTMLInputElement).checked).toBe(false);
	expect((screen.getByRole("checkbox",{name:"model-b"}) as HTMLInputElement).checked).toBe(false);
});
it("failed selection save retains the draft and an explicit empty selection", async () => {
	const options=props();options.onSaveModels=vi.fn(async () => "storage failed");
	render(createElement(ProviderCard,options));
	fireEvent.click(screen.getByRole("button",{name:en.deselectAll}));
	fireEvent.click(screen.getByRole("button",{name:en.applyModelDraft}));
	await screen.findByText("storage failed");
	expect(options.onSaveModels).toHaveBeenCalledWith([],"selected");
	expect((screen.getByRole("checkbox",{name:"model-a"}) as HTMLInputElement).checked).toBe(false);
});
it("reauthorization passes the chosen account after explicit confirmation", async () => {
	const options=props();render(createElement(ProviderCard,options));
	fireEvent.click(screen.getByRole("button",{name:en.accountReauthorize}));
	expect(options.onSignIn).not.toHaveBeenCalled();
	fireEvent.click(screen.getAllByRole("button",{name:/Authorize again ·/})[0]!);
	await waitFor(() => expect(options.onSignIn).toHaveBeenCalledWith(expect.any(String),"account-a"));
});

it("preserves account management and the failed operation through a status refresh", () => {
 const options=props();const view=render(createElement(ProviderCard,options));
 view.rerender(createElement(ProviderCard,{...options,providerStatus:{...signedIn,status:"error",message:"storage read failed"}}));
 expect(screen.getByText("storage read failed")).toBeTruthy();
 expect(screen.getByRole("button",{name:en.accountReauthorize})).toBeTruthy();
 view.rerender(createElement(ProviderCard,{...options,providerStatus:{...signedIn,operationError:"authorization expired"}}));
 expect(screen.getByText("authorization expired")).toBeTruthy();
 expect(screen.getByRole("button",{name:en.accountReauthorize})).toBeTruthy();
});
