// Path-only adaptation: projections and binary-copy checks consume this run's
// synthetic D1 output. Frozen test source and expected results stay unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const root = path.resolve(import.meta.dirname, '../..');
const base = process.env.FINANCE_REGRESSION_OUTPUT || path.join(root, 'docs/migration-evidence/finance-p04/cloud/regression');
const mappings = [
  [path.join(root, 'docs/migration-evidence/finance-p03/finish/device-resolution/cases'), path.join(base, 'device-resolution/cases')],
  [path.join(root, 'docs/migration-evidence/finance-p03/nonphone-entry/unified-bridge-device/d1-logical-snapshot.json'), process.env.FINANCE_D1_BRIDGE_INPUT || path.join(base, 'unified-bridge/d1-logical-snapshot.json')],
];
const originalRead = fs.readFile.bind(fs);
fs.readFile = (name, ...options) => {
  if (typeof name === 'string') {
    const absolute = path.resolve(name);
    for (const [from, to] of mappings) {
      if (absolute === from || absolute.startsWith(from + path.sep)) {
        return originalRead(to + absolute.slice(from.length), ...options);
      }
    }
  }
  return originalRead(name, ...options);
};
syncBuiltinESMExports();
