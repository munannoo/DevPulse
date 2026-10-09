type Job = { start: () => void; cancel: () => void };
export class RequestQueue {
  private active = false;
  private pending: Job[] = [];
  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) { return Promise.reject(new Error('Request cancelled.')); }
    if (this.pending.length >= 32) { return Promise.reject(new Error('Gemma queue is full.')); }
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        cancel: () => {
          this.pending = this.pending.filter(item => item !== job);
          reject(new Error('Request cancelled.'));
        },
        start: () => {
          signal.removeEventListener('abort', job.cancel);
          this.active = true;
          task().then(resolve, reject).finally(() => {
            this.active = false;
            this.pending.shift()?.start();
          });
        },
      };
      signal.addEventListener('abort', job.cancel, { once: true });
      if (this.active) { this.pending.push(job); } else { job.start(); }
    });
  }
}
export const requestQueue = new RequestQueue();
