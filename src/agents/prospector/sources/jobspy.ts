import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { RawLead } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const SIDECAR_DIR = join(here, '..', '..', '..', '..', 'services', 'jobspy');
const VENV_PY_WIN = join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe');
const VENV_PY_NIX = join(SIDECAR_DIR, '.venv', 'bin', 'python');

/**
 * JobSpy sidecar — job-board hiring signals (playbook §9.3 A1 source 1).
 * Requires one-time setup: python -m venv services/jobspy/.venv && pip install python-jobspy.
 * Returns [] with a console note when the sidecar isn't set up — never blocks the run.
 */
export async function fetchJobspyLeads(): Promise<RawLead[]> {
  const python = existsSync(VENV_PY_WIN) ? VENV_PY_WIN : existsSync(VENV_PY_NIX) ? VENV_PY_NIX : 'python3';

  return new Promise((resolve) => {
    const leads: RawLead[] = [];
    const proc = spawn(python, [join(SIDECAR_DIR, 'scrape.py')], { timeout: 10 * 60_000 });

    let buffer = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as RawLead;
          if (obj.url && obj.text) leads.push({ ...obj, source: 'jobspy' });
        } catch {
          /* skip malformed line */
        }
      }
    });
    proc.stderr.on('data', (chunk: Buffer) => console.warn(`[jobspy] ${chunk.toString().trim().slice(0, 200)}`));
    proc.on('error', () => resolve([]));
    proc.on('close', () => resolve(leads));
  });
}
