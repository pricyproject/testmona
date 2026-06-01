// Lightweight notification chime synthesized with the Web Audio API so we don't
// need to ship a binary audio asset. Browsers block audio until the user has
// interacted with the page, so playback can silently no-op on the first load;
// that's intentional and safe.

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  return audioCtx;
}

export function playNotificationSound() {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    // A gentle two-note rising chime.
    const notes = [
      { freq: 880, start: 0, dur: 0.14 },
      { freq: 1320, start: 0.11, dur: 0.2 },
    ];

    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Quick attack, smooth exponential decay to avoid clicks.
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.14, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    });
  } catch {
    // Audio unavailable or blocked — ignore.
  }
}
