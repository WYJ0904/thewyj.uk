import { __testing, proxyToLegacy } from "../_lib/legacy-api.mjs";
import { handleTask11Request } from "../_lib/task11-api.mjs";

export async function onRequest(context) {
  return await handleTask11Request(context, proxyToLegacy) || proxyToLegacy(context);
}
export { __testing };
