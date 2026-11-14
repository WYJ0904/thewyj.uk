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
  // Membership, money used for confirmation, and terminal state remain server
  // owned. Local evidence is a separate display annotation, never a new row.
  const ids = row => new Set([...(row.event_ids || []), row.event_id].filter(Boolean));
  const money = value => Number.isSafeInteger(value) && value > 0 ? value : null;
  const direction = value => ["income", "expense", "refund"].includes(value) ? value : "";
  const local = snapshot?.account_id === accountId && accountId
    ? [...(snapshot.reviews || []).filter(row => row.state === "pending"), ...(snapshot.transactions || []).filter(row => row.status !== "deleted")]
    : [];
  return records.filter(row => row.state === "pending").map(row => {
    const { local_evidence: _previous, ...server } = row;
    const aliases = ids(server);
    const matches = local.filter(item => server.source_package && item.source_package === server.source_package &&
      [...ids(item)].some(id => aliases.has(id)));
    const amounts = [...new Set(matches.map(item => money(item.amount_minor)).filter(value => value !== null))];
    const directions = [...new Set(matches.map(item => direction(item.direction)).filter(Boolean))];
    const localAmount = amounts.length === 1 ? amounts[0] : null;
    const localDirection = directions.length === 1 ? directions[0] : "";
    const currencies = [...new Set(matches.map(item => item.currency).filter(Boolean))];
    const currencyConflict = currencies.length > 1 || (server.currency && currencies.length === 1 && server.currency !== currencies[0]);
    const serverAmount = money(server.amount_minor), serverDirection = direction(server.direction);
    const conflict = amounts.length > 1 || directions.length > 1 || currencyConflict ||
      (serverAmount !== null && localAmount !== null && serverAmount !== localAmount) ||
      Boolean(serverDirection && localDirection && serverDirection !== localDirection);
    const pending = (serverAmount === null && localAmount !== null) || (!serverDirection && localDirection);
    if (!conflict && !pending) return server;
    return { ...server, local_evidence: { amount_minor: localAmount, direction: localDirection, ...(currencies.length ? { currency: currencies[0] } : {}),
      pending_sync: Boolean(pending), conflict: Boolean(conflict) } };
  });
}

/** Local recovery keeps its original identity and is never a canonical review. */
export function localNotificationRecovery(records, snapshot, accountId) {
  if (!snapshot || snapshot.account_id !== accountId) return [];
  const booked = new Set((snapshot.transactions || []).flatMap(row => [...(row.event_ids || []), row.event_id]).filter(Boolean));
  const ids = row => [...(row.event_ids || []), row.event_id].filter(Boolean);
  const observed = new Set(records.flatMap(ids));
  return (snapshot.reviews || []).filter(row => row.state === "pending" &&
    !ids(row).some(id => observed.has(id) || booked.has(id)));
}
