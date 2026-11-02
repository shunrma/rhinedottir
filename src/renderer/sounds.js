// Subtle interface sounds, made on the fly with Web Audio so there are no sound files.
// Kept quiet on purpose; they can be turned off in Settings.
const sfx = (() => {
  let ctx = null;
  let enabled = true;
  const VOLUME = 0.05;

  // One soft tone: a sine that glides from `from` to `to` Hz and fades out.
  function tone(from, to, length, delay = 0, gain = 1, type = "sine") {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + length);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(VOLUME * gain, t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  const sounds = {
    hover: () => tone(1800, 1700, 0.03, 0, 0.25),
    click: () => tone(900, 600, 0.06, 0, 0.7),
    start: () => {
      tone(440, 660, 0.18, 0, 0.8);
      tone(660, 990, 0.22, 0.07, 0.6);
    },
    success: () => {
      tone(660, 660, 0.18, 0, 0.7);
      tone(880, 880, 0.18, 0.09, 0.6);
      tone(1320, 1320, 0.3, 0.18, 0.5);
    },
    notify: () => {
      tone(1046, 1046, 0.14, 0, 0.5);
      tone(1568, 1568, 0.2, 0.08, 0.4);
    },
    error: () => tone(260, 180, 0.22, 0, 0.8, "triangle"),
  };

  return {
    setEnabled(on) {
      enabled = !!on;
    },
    play(name) {
      if (!enabled || !sounds[name]) return;
      try {
        ctx ||= new AudioContext();
        if (ctx.state === "suspended") ctx.resume();
        sounds[name]();
      } catch {
        // Sound is a nicety; never let it break the launcher.
      }
    },
  };
})();

// A soft click for every button, and a faint tick when hovering the main ones.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn && !btn.disabled && btn.id !== "startBtn") sfx.play("click");
});
document.addEventListener("mouseover", (e) => {
  const btn = e.target.closest(".start, .pack, .menu-btn, .menu button, .icon-btn, .links button");
  if (btn && !btn.disabled && !btn.contains(e.relatedTarget)) sfx.play("hover");
});
