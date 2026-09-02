/** Compatibility facade — implementation lives in `src/runtime/` (mirrored from Hub vendor core). */

export {
	JSON_BODY_LIMIT_BYTES,
	JsonRequestError,
	readJsonRequest,
	requestErrorStatus,
} from "./runtime/http-json.ts";
