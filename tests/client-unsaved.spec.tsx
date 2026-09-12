/** @vitest-environment jsdom */
import {useRef} from "react";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {useUnsavedChanges} from "../src/client/unsaved.ts";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("blocks host navigation, escapeEvent and unload with a dirty draft, releases listeners on unmount",()=>{
 const leave=vi.fn();function Form(){const root=useRef<HTMLDivElement>(null);useUnsavedChanges(root,"discard");return <div role="dialog"><button type="button" onClick={leave}>close</button><div ref={root} data-unsaved="true"><input aria-label="draft"/></div></div>;}
 const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);const view=render(<Form/>);
 fireEvent.click(screen.getByRole("button",{name:"close"}));expect(leave).not.toHaveBeenCalled();
 const escapeEvent=new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true});document.dispatchEvent(escapeEvent);expect(escapeEvent.defaultPrevented).toBe(true);
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"close"}));expect(leave).toHaveBeenCalledOnce();
 view.unmount();const calls=confirm.mock.calls.length;document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));expect(confirm).toHaveBeenCalledTimes(calls);
});
