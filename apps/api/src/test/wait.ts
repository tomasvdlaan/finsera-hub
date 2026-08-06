/**
 * Wait until something is true, rather than for a length of time.
 *
 * Every flaky test in this suite was the same shape: `await new Promise(r => setTimeout(r, 60))`
 * standing in for "let the async work finish". Sixty milliseconds is a guess about a machine,
 * and it is a guess that holds right up until the tests share a CPU with a build — which is
 * exactly when they run. The failures then land somewhere unrelated to the cause: a row that
 * had not been written yet reads as null, and the assertion blames the code under test.
 *
 * A poll against the actual condition is both faster in the normal case (it returns as soon as
 * the work is done, not after a fixed wait) and honest in the slow one. The timeout is generous
 * on purpose: it exists to turn a hang into a readable failure, not to bound normal work.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  { timeoutMs = 5_000, label = 'the condition' }: { timeoutMs?: number; label?: string } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Let work that is already scheduled run, without naming a duration.
 *
 * The counterpart to `waitFor`, for the assertions that check something did *not* happen: you
 * cannot wait for an absence, so the alternative is to give the pending continuations their
 * turns and then look. Draining the task queue is a statement about ordering rather than about
 * milliseconds, so unlike a sleep it does not get less true on a loaded machine.
 *
 * These assertions were never the flaky ones — a slow machine makes an unwanted call *less*
 * likely to have happened, so the failure they risk is a false pass, not a false failure. They
 * are converted for the same reason as the rest: a number in a test is a claim about hardware.
 */
export async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
