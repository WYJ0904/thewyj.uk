import { handleInboundSupportEmail } from "../../functions/_lib/email-inbound.mjs";

export default {
  async email(message, env, ctx) {
    return handleInboundSupportEmail(message, env, ctx);
  },
};
