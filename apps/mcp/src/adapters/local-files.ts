import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';

import type { LocalFiles } from '../ports.js';

const ALLOWED_EXTENSIONS = new Set(['.json', '.fit']);
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Reads recordings from the local disk. Only .json and .fit files, and only inside
 * `recordingsDir` when it is set, so the model cannot be steered into reading other files.
 */
export function createLocalFiles(recordingsDir: string | null): LocalFiles {
  const root = recordingsDir === null ? null : resolve(recordingsDir);
  return {
    async read(path) {
      const full = resolve(root ?? '.', path);
      if (root !== null) {
        const inside = relative(root, full);
        if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('O arquivo precisa estar dentro de PULSE_KIT_RECORDINGS_DIR.');
      }
      if (!ALLOWED_EXTENSIONS.has(extname(full).toLowerCase())) throw new Error('Só arquivos .json (openPulse) e .fit são aceitos.');
      const info = await stat(full);
      if (info.size > MAX_BYTES) throw new Error('Arquivo maior que 50 MB.');
      return new Uint8Array(await readFile(full));
    },
  };
}
