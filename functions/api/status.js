import { statusRouteResponse } from "../_lib/cloudflare-foundation.mjs";
import { onRequest as legacyProxy } from "./[[path]].js";

export async function onRequest(context) {
  return statusRouteResponse(context, legacyProxy);
}
