import { fileURLToPath } from 'node:url';
import { ProcessClient } from '@bear-forge/training';

/** Stage-2 backend uses the shared bounded transport and its own locked runtime. */
export class LearnerClient extends ProcessClient {
  constructor(seed = 7) {
    super(seed, fileURLToPath(new URL('../../.venv/bin/python', import.meta.url)),
      fileURLToPath(new URL('./douzero_service.py', import.meta.url)));
  }
}
