// Writes the OpenAPI spec to /output/design/openapi.json (submission deliverable).
// Usage: npm run docs
const fs = require('fs');
const path = require('path');
const { spec } = require('../src/openapi');

const dir = path.resolve(__dirname, '../../../output/design');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'openapi.json'), JSON.stringify(spec, null, 2) + '\n');
console.log(`Wrote ${path.join(dir, 'openapi.json')} (${Object.keys(spec.paths).length} paths)`);
