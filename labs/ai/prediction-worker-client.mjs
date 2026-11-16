// Termination, rather than a queued cancel message, interrupts synchronous CSV
// parsing/sorting. Job IDs and worker identity also reject late queued replies.
export class PredictionWorkerClient {
  constructor(
    makeWorker = () =>
      new Worker(new URL("./prediction-worker.mjs", import.meta.url), {
        type: "module",
      }),
  ) {
    this.makeWorker = makeWorker;
    this.worker = null;
    this.pending = null;
    this.sequence = 0;
    this.start(); // Fetch only same-origin static code before any file is chosen.
  }
  start() {
    try {
      const worker = this.makeWorker();
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (worker !== this.worker || data.id !== this.pending?.id) return;
        const pending = this.pending;
        this.pending = null;
        if (data.error)
          pending.reject(
            Object.assign(new Error(data.error.message), data.error),
          );
        else pending.resolve(data.result);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        if (worker !== this.worker) return;
        this.stop(
          new Error(
            "The local analysis worker could not run. Reload the page and try again; no rows were accepted.",
          ),
        );
      };
      worker.onmessageerror = () => {
        if (worker === this.worker)
          this.stop(
            new Error(
              "The local worker result could not be read. No rows were accepted.",
            ),
          );
      };
    } catch {
      this.worker = null;
    }
  }
  stop(error = new Error("Analysis canceled.")) {
    this.worker?.terminate();
    this.worker = null;
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }
  run(bytes, exampleManifest = null) {
    if (this.pending) this.stop();
    if (!this.worker) this.start();
    if (!this.worker)
      return Promise.reject(
        new Error("Local Web Workers are unavailable. No rows were accepted."),
      );
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending = { id, resolve, reject };
      try {
        this.worker.postMessage({ id, bytes, exampleManifest }, [bytes]);
      } catch (error) {
        this.stop(error);
      }
    });
  }
}
