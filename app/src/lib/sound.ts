// A short two-note chime made with the Web Audio API (no sound file needed).
// Browsers only allow sound after the person has interacted with the page,
// so the audio context is unlocked on the first click / key press.

const KEY = 'crm.sound';
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setSoundEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

export function unlockSound() {
  const unlock = () => { context()?.resume().catch(() => undefined); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export function playChime() {
  if (!soundEnabled()) return;
  const c = context();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => undefined);
  const now = c.currentTime;
  [[880, 0], [1318.5, 0.14]].forEach(([freq, at]) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq!;
    gain.gain.setValueAtTime(0.0001, now + at!);
    gain.gain.exponentialRampToValueAtTime(0.18, now + at! + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at! + 0.45);
    osc.connect(gain).connect(c.destination);
    osc.start(now + at!);
    osc.stop(now + at! + 0.5);
  });
}
