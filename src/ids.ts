/** pi-ai provider id used by login, refresh, and the credential store. */
export const XAI_PI_PROVIDER = 'xai'

/** Harness LLM route. Distinct from the catalog `xai` API-key route. */
export const GROK_BUILD_ROUTE = 'grok-build'

/** Basename of the OAuth document inside the Harness home. */
export const GROK_BUILD_AUTH_FILENAME = '.grok-build-auth.json'

/** Basename of the model catalog cache inside the Harness home. */
export const GROK_BUILD_MODELS_CACHE_FILENAME = '.grok-build-models.json'

/** Fallback model when no live catalog listing is available. */
export const DEFAULT_GROK_BUILD_MODEL = 'grok-4.5'

/** Provider idle ceiling used by the composite route. */
export const GROK_BUILD_STREAM_IDLE_TIMEOUT_MS = 300_000
