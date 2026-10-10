import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const config=readFileSync(new URL('../js/core/config.js',import.meta.url),'utf8');
const releases=[...config.matchAll(/export const ASSET_RELEASE = "([^"]+)";/g)];
assert.equal(releases.length,1,'Exactly one browser asset release is required');
export const ASSET_RELEASE=releases[0][1];
assert.match(ASSET_RELEASE,/^\d{8}-aeris-[a-z0-9-]+$/);
