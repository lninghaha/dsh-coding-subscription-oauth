/** 缓存选择和目录共享串行提交；失败不会阻止后续用户重试。 */
export declare class ModelCacheQueue {
    private pending;
    run<T>(action: () => Promise<T>): Promise<T>;
}
export declare function writeModelCache(file: string, document: object): Promise<void>;
//# sourceMappingURL=model-cache.d.ts.map