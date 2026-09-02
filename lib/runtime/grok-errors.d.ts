/**
 * xAI / Grok Build error remapping shared by Hub and Subscription.
 * @module dsh-coding-oauth-core/grok-errors
 */
export declare function isXaiCapacityError(detail: string): boolean;
export declare function remapXaiCapacityFailure(failure: {
    message: string;
    code: string;
}): {
    message: string;
    code: string;
};
//# sourceMappingURL=grok-errors.d.ts.map