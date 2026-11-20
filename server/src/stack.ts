// Starting several components as one transaction: either all of them run, or
// none of the ones this start created is left behind.

export interface StackStep {
  name: string;
  /** Starts the component and resolves to the function that stops it. */
  start(): Promise<() => Promise<void>>;
}

export class StackStartError extends Error {
  readonly component: string;

  constructor(component: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.component = component;
  }
}

/**
 * Starts the steps in order. When one fails, stops the started ones in
 * reverse and throws. Resolves to a stop function that is safe to call again.
 * A component that fails to stop is reported and does not hold up the rest.
 */
export async function startStack(steps: StackStep[],
  onStopError: (component: string, error: unknown) => void = () => {}): Promise<() => Promise<void>> {
  const started: { name: string; stop: () => Promise<void> }[] = [];
  const stopAll = async () => {
    for (let entry = started.pop(); entry; entry = started.pop()) {
      try { await entry.stop(); } catch (error) { onStopError(entry.name, error); }
    }
  };
  for (const step of steps) {
    try {
      started.push({ name: step.name, stop: await step.start() });
    } catch (error) {
      await stopAll();
      throw new StackStartError(step.name, error);
    }
  }
  let stopping: Promise<void> | undefined;
  return () => stopping ??= stopAll();
}
