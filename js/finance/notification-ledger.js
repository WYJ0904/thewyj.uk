/** Transport projection only. The existing Finance store remains the page owner. */
export function mergeLocalNotificationLedger(transactions, snapshot, accountId) {
  if (!snapshot || snapshot.account_id !== accountId) return false;
  let changed = false;
  for (const row of snapshot.transactions || []) {
    if (!/^txn:[A-Za-z0-9._:-]{4,76}$/.test(row.id || "") ||
        !Number.isSafeInteger(row.amount_minor) || row.amount_minor <= 0 ||
        !["income", "expense", "refund"].includes(row.direction) ||
        !Number.isSafeInteger(row.occurred_at_ms) || row.occurred_at_ms <= 0) continue;
    const linked = Object.values(transactions).find(item => item.notification_event_ids?.includes(row.event_id) && !item.native_notification_pending);
    if (linked) {
      // An old cloud booking already cached by this Finance owner is conclusive
      // identity evidence. Recovery must not add a provisional duplicate.
      const provisional = Object.values(transactions).find(item => item.native_notification_event_id === row.event_id);
      if (provisional && provisional.id !== linked.id) { delete transactions[provisional.id]; changed = true; }
      continue;
    }
    const local = Object.values(transactions).find(item => item.native_notification_event_id === row.event_id);
    if (row.sync_state === "synced") {
      // A receipt resolves an existing provisional entry. Never resurrect a
      // deleted server transaction from a historical native acknowledgement.
      if (!local) continue;
      if (local.id !== row.id) { delete transactions[local.id]; changed = true; }
      if (!transactions[row.id] || transactions[row.id].native_notification_event_id) {
        const resolved = { ...local, id: row.id, native_notification_pending: false };
        delete resolved.native_notification_event_id;
        transactions[row.id] = resolved;
        changed = true;
      }
    } else if (!transactions[row.id] || transactions[row.id].native_notification_pending) {
      const next = { ...row, category_id: "", counterparty: "", note: "", revision: 0, sync_version: 0,
        native_notification_event_id: row.event_id, native_notification_pending: true };
      if (JSON.stringify(transactions[row.id]) !== JSON.stringify(next)) { transactions[row.id] = next; changed = true; }
    }
  }
  return changed;
}

export function mergeLocalNotificationReviews(records, snapshot, accountId) {
  if (!snapshot || snapshot.account_id !== accountId) return records;
  const booked = new Set((snapshot.transactions || []).map(row => row.event_id));
  const ids = row => [...(row.event_ids || []), row.event_id].filter(Boolean);
  const pending = records.filter(row => row.state === "pending" && !ids(row).some(id => booked.has(id)));
  const observed = new Set(records.flatMap(ids));
  return [...pending, ...(snapshot.reviews || []).filter(row => !ids(row).some(id => observed.has(id) || booked.has(id)))];
}
