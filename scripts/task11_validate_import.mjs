import { __testing, validateImportEnvelope } from "../functions/_lib/task11-import.mjs";

let source = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) source += chunk;
const envelope = JSON.parse(source || "{}");
validateImportEnvelope({ schema_version: envelope.schema_version, kind: envelope.kind, records: [] });

const db = {
  prepare(sql) {
    return {
      bind(...bindings) {
        return { sql, bindings };
      },
    };
  },
};

const validIndexes = [];
let invalidCount = 0;
for (const [index, record] of (Array.isArray(envelope.records) ? envelope.records : []).entries()) {
  try {
    __testing.statementFor(db, envelope.kind, record);
    validIndexes.push(index);
  } catch (_) {
    invalidCount += 1;
  }
}

process.stdout.write(JSON.stringify({ valid_indexes: validIndexes, invalid_count: invalidCount }));
