import { hasTask27, atomic } from './task27-store.mjs';
import { authorize } from './task27-security.mjs';

/** Interactive maintenance reuses Task27's session-bound, single-use proof.
 * Scheduled cleanup keeps the existing cron/binding authority and budget. */
export async function authorizeFileMaintenance(context, account) {
  if (!await hasTask27(context.env.WYJ_DB)) return;
  const { db, guards } = await authorize(context,account,context.request.headers.get('X-Aeris-Stepup'),'files_cleanup');
  await atomic(db,guards);
}
