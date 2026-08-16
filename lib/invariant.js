/** dsh-coding-subscription-oauth invariant entry */

// src/invariant.ts
var PACKAGE_NAME = "dsh-coding-subscription-oauth";
var name = "grok-build-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
