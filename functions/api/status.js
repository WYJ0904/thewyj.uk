import { statusRouteResponse } from "../_lib/cloudflare-foundation.mjs";
import { proxyToLegacy } from "../_lib/legacy-api.mjs";

export async function onRequest(context) {
  return statusRouteResponse(context, proxyToLegacy);
}
