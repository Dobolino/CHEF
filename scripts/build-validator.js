import fs from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';

const schema = JSON.parse(await fs.readFile(new URL('../schemas/menu.v2.schema.json', import.meta.url), 'utf8'));
// Conditional required fields are declared in their parent definition.
const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, code: { source: true }, allowUnionTypes: true });
formats(ajv);
const validate = ajv.compile(schema);
await fs.mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
await fs.mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
const input = new URL('../.cache/validator.cjs', import.meta.url);
await fs.writeFile(input, standalone(ajv, validate));
await build({ entryPoints: [input.pathname], bundle: true, platform: 'browser', format: 'esm',
  outfile: new URL('../src/generated/validate-menu.js', import.meta.url).pathname,
  legalComments: 'eof', minify: true });
console.log('Offline schema validator generated.');
