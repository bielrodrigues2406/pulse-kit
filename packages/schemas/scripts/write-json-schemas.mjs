// Writes JSON Schema files from the zod schemas, for readers outside TypeScript (physio-lab).
// Run after `pnpm build`; the files are committed so they can be read without building.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { indexMasterSchema, openPulseSessionSchema, polarExerciseSchema } from '../dist/index.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'json');
mkdirSync(outDir, { recursive: true });

const schemas = {
  'index-master.schema.json': indexMasterSchema,
  'openpulse-session.schema.json': openPulseSessionSchema,
  'polar-exercise.schema.json': polarExerciseSchema,
};

for (const [file, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  writeFileSync(join(outDir, file), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`json/${file}`);
}
