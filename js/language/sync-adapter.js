import { sanitizeProfile } from "./quiz.js?v=20260904-task20-android-r1";

export function createLearningSyncAdapter(getApi) {
  const api = () => getApi() || null;
  const recordId = (kind, ...components) => api()?.makeRecordId(kind, components) || "";
  return Object.freeze({
    api,
    recordId,
    groupPrefix(kind, ...components) {
      const id = recordId(kind, ...components);
      return id ? `${id}|` : "";
    },
    timestamp(value) {
      const parsed = new Date(value || "");
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
    },
    record(dataType, kind, components, payload, updatedAt = "") {
      return {
        data_type: dataType,
        record_id: recordId(kind, ...components),
        payload,
        updated_at: this.timestamp(updatedAt),
        deleted: false,
      };
    },
    decodeProfile(value) {
      try {
        return sanitizeProfile(decodeURIComponent(value));
      } catch (_) {
        return sanitizeProfile(value);
      }
    },
  });
}
