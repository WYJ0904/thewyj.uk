import { __testing, proxyToLegacy } from "../_lib/legacy-api.mjs";
import { handleTask11Request } from "../_lib/task11-api.mjs";
import { handleTask12Request } from "../_lib/task12-api.mjs";
import { handleTask13Request } from "../_lib/task13-api.mjs";
import { handleTask14Request } from "../_lib/task14-api.mjs";

export async function onRequest(context) {
  return await handleTask12Request(context, proxyToLegacy)
    || await handleTask13Request(context, proxyToLegacy)
    || await handleTask14Request(context, proxyToLegacy)
    || await handleTask11Request(context, proxyToLegacy)
    || proxyToLegacy(context);
}
export { __testing };
