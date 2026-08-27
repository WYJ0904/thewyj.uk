import { apiError } from "../_lib/cloudflare-foundation.mjs";
import { handleTask11Request } from "../_lib/task11-api.mjs";
import { handleTask12Request } from "../_lib/task12-api.mjs";
import { handleTask13Request } from "../_lib/task13-api.mjs";
import { handleTask14Request } from "../_lib/task14-api.mjs";
import { handleTask15Request } from "../_lib/task15-api.mjs";
import { handleTask16Request } from "../_lib/task16-api.mjs";

export async function onRequest(context) {
  return await handleTask12Request(context)
    || await handleTask13Request(context)
    || await handleTask14Request(context)
    || await handleTask11Request(context)
    || await handleTask15Request(context)
    || await handleTask16Request(context)
    || apiError("api_route_not_found", "接口不存在", 404, context.data?.requestId || "");
}
