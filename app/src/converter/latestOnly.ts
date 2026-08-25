/**
 * CLAUDE.md 性能設計:「キューは最新だけ残す」。
 *
 * pandoc.wasm は走り出したら中断できないので、待機枠を1件だけ持って上書きする。
 * 溜めると入力に対して際限なく遅れていって破綻する。
 */
export class LatestOnly<T, R> {
  private running = false;
  private pending: T | null = null;
  private hasPending = false;

  constructor(
    private readonly run: (value: T) => Promise<R>,
    private readonly onSettled: (result: R | null, error: Error | null) => void,
  ) {}

  /** 走っていれば待機枠を上書きするだけ。走っていなければ回し始める */
  submit(value: T): void {
    this.pending = value;
    this.hasPending = true;
    if (!this.running) void this.drain();
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.hasPending) {
        const value = this.pending as T;
        this.hasPending = false;
        this.pending = null;
        try {
          this.onSettled(await this.run(value), null);
        } catch (e) {
          this.onSettled(null, e instanceof Error ? e : new Error(String(e)));
        }
      }
    } finally {
      this.running = false;
    }
  }
}
