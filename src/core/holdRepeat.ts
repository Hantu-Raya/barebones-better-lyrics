const INITIAL_DELAY_MS = 400;
const START_INTERVAL_MS = 180;
const MIN_INTERVAL_MS = 45;
const DECAY = 0.82;

// Press-and-hold accelerated repeat for stepper buttons: one step on press, then auto-repeat
// after a short delay, ramping the rate up the longer the button is held. A quick tap stays a
// single step, and keyboard activation (Enter/Space) steps once per press.
export function attachHoldRepeat(button: HTMLElement, onStep: (event: MouseEvent) => void): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  button.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    onStep(event);

    let interval = START_INTERVAL_MS;
    const repeat = (): void => {
      if (!button.isConnected) {
        stop();
        return;
      }
      onStep(event);
      interval = Math.max(MIN_INTERVAL_MS, interval * DECAY);
      timer = setTimeout(repeat, interval);
    };
    timer = setTimeout(repeat, INITIAL_DELAY_MS);
  });

  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("lostpointercapture", stop);

  // Keyboard activation arrives as a click with detail 0; pointer-driven clicks are already
  // handled by the pointerdown path, so only act on keyboard ones here to avoid double steps.
  button.addEventListener("click", event => {
    if (event.detail === 0) onStep(event);
  });
}
