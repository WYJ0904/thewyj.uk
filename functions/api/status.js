import { statusRouteResponse } from "../_lib/cloudflare-foundation.mjs";

export async function onRequest(context) {
  return statusRouteResponse(context);
}
