import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** One long-lived local learner; game state stays in the existing TS runner. */
export class ProcessClient {
  private readonly child;
  private sequence = 0;
  private stopped = false;
  private stderr = '';
  readonly timings: Record<string, number> = {};
  private readonly pending = new Map<number, {
    resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; started: number; command: string;
  }>();
  private readonly exited: Promise<void>;

  constructor(seed = 7, python = fileURLToPath(new URL('../.venv/bin/python', import.meta.url)), service = fileURLToPath(new URL('./learner.py', import.meta.url))) {
    this.child = spawn(python, ['-u', service, String(seed)],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-4096); });
    this.child.stdin.on('error', error => this.fail(error));
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', line => {
      try {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (!pending || typeof response.ok !== 'boolean') throw Error('Unexpected learner response');
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        this.timings[pending.command] = (this.timings[pending.command] ?? 0) + performance.now() - pending.started;
        if (response.ok) pending.resolve(response.value);
        else pending.reject(Error('Learner: ' + response.error));
      } catch (error) { this.fail(error instanceof Error ? error : Error(String(error))); this.child.kill(); }
    });
    this.exited = new Promise(resolve => {
      this.child.once('error', error => { this.fail(error); resolve(); });
      this.child.once('close', (code, signal) => {
        lines.close();
        this.fail(Error(`Learner exited (${code ?? signal}): ${this.stderr}`));
        resolve();
      });
    });
  }

  private fail(error: Error) {
    this.stopped = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  request<T = any>(message: Record<string, unknown>): Promise<T> {
    if (this.stopped) return Promise.reject(Error('Learner process is closed'));
    if (this.pending.size >= 32) return Promise.reject(Error('Learner request queue is full'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(Error('Learner request timed out'));
        this.child.kill('SIGKILL');
      }, 60000);
      this.pending.set(id, { resolve, reject, timer, started: performance.now(), command: String(message.command) });
      this.child.stdin.write(JSON.stringify({ ...message, id }) + '\n', error => {
        if (error) { this.fail(error); this.child.kill(); }
      });
    });
  }

  async close(): Promise<void> {
    try {
      if (!this.stopped) await this.request({ command: 'close' });
    } finally {
      this.child.stdin.end();
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 3000);
      try { await this.exited; } finally { clearTimeout(timer); }
    }
  }
}
