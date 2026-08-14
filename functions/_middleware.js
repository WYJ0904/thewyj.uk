import { cloudMiddleware } from "./_lib/cloudflare-foundation.mjs";

export const onRequest = cloudMiddleware;
