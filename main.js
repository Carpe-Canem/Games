/* Carpe Canem: intro, loop and the howl.
   States on <html data-intro>: playing (on load: the full clip + the voice, the rest of the page hidden)
   > done (the page is drawn, the short clip loops, muted).
   Browsers do not let a page make sound before the visitor clicks or presses a key. If the voice is blocked,
   a "Click anywhere for sound" button shows, and the first click starts the voice in step with the clip.
   The videos have no sound. The sung note is made here with Web Audio; tweak it in VOICE below. */

/* ======================= VOICE SETTINGS: edit these to change the opera note =======================
   After editing, save and reload the page, then press the speaker button in the hero to hear it again. */
var VOICE = {
  sample: null,        // a real recording instead of the synth, e.g. 'assets/howl-note.mp3' (null = use the synth)

  // timing (seconds)
  delay: 0.0,         // wait after the clip starts before the voice comes in
  endEarly: .7,      // seconds before the full clip ends that the note is silent (bigger = shorter note).
                       // 1.15 = 2 s shorter than the first version, which rang 0.85 s past the end of the clip
  attack: 0.9,         // swell-in time
  release: 1.0,        // fade-out time at the end of the note

  // pitch
  note: 205,           // Hz. 196 = G3 (baritone), 220 = A3, 262 = C4, 330 = E4, 392 = G4 (high tenor)
  scoop: 0.94,         // starts this fraction below the note and slides up (1 = no slide, 0.89 = two semitones)
  scoopTime: 0.35,     // how long the slide up takes
  detune: 6,           // cents between the two voices; more = thicker/choral, 0 = thin

  // vibrato
  vibratoRate: 6,    // wobbles per second (opera is about 5-7)
  vibratoDepth: 0.012, // how wide, as a fraction of the note (0.012 = about 1/5 of a semitone)
  vibratoDelay: 1.6,   // seconds for the vibrato to grow in

  // vowel colour: [centre Hz, sharpness Q, loudness]. These shape "ah".
  // For "oh" try 500/9/1, 850/10/0.5, 2600/12/0.3, 3000/8/0.3; for "ee" try 300/9/1, 2300/10/0.5, 3000/12/0.4, 3400/8/0.3
  formants: [[800, 9, 1.0], [1150, 10, 0.55], [2900, 12, 0.3], [3200, 8, 0.35]],

  // levels
  volume: 0.8,         // overall loudness, 0 to 1
  breath: 0.015,       // breathy noise under the note (0 = none)
  reverbMix: 0.55,     // how much hall echo
  reverbLength: 2.8    // how long the hall rings, in seconds
};
/* ================================================================================================= */

(function () {
  var root = document.documentElement;
  var loop = document.getElementById('loop');
  var film = document.getElementById('film');
  var pauseBtn = document.getElementById('pause');
  var howlBtn = document.getElementById('howl');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ctx = null, voice = null, endTimer = null;

  function setState(s) { root.setAttribute('data-intro', s); }
  var hint = document.getElementById('sound-hint');
  var introDur = 5.88;

  /* ---------- the voice ---------- */
  function reverb(c) {
    var len = Math.round(c.sampleRate * VOICE.reverbLength), buf = c.createBuffer(2, len, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    var conv = c.createConvolver(); conv.buffer = buf; return conv;
  }

  function startVoice(durationSec, delay) {
    stopVoice(true);
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || durationSec <= 0.3) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    var t0 = ctx.currentTime + (delay == null ? VOICE.delay : delay), tEnd = t0 + durationSec;

    var master = ctx.createGain(); master.gain.value = 0.0001;
    var wet = ctx.createGain(); wet.gain.value = VOICE.reverbMix;
    var dry = ctx.createGain(); dry.gain.value = 0.7;
    var rev = reverb(ctx);
    master.connect(dry); master.connect(rev); rev.connect(wet);
    dry.connect(ctx.destination); wet.connect(ctx.destination);

    if (VOICE.sample) {
      fetch(VOICE.sample).then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { return ctx.decodeAudioData(b); })
        .then(function (buf) {
          var s = ctx.createBufferSource(); s.buffer = buf; s.connect(master);
          master.gain.setValueAtTime(VOICE.volume, ctx.currentTime);
          master.gain.setValueAtTime(VOICE.volume, tEnd - Math.min(VOICE.release, durationSec / 2));
          master.gain.exponentialRampToValueAtTime(0.0001, tEnd);
          s.start(t0); voice = { nodes: [s], gain: master };
        }).catch(function () {});
      return;
    }

    // swell in, hold, release
    var attack = Math.min(VOICE.attack, durationSec / 2), release = Math.min(VOICE.release, durationSec / 2);
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(VOICE.volume, t0 + attack);
    master.gain.setValueAtTime(VOICE.volume, tEnd - release);
    master.gain.exponentialRampToValueAtTime(0.0001, tEnd);

    // the note: scooped up from just below, two detuned saws for body
    var f = VOICE.note, nodes = [];
    var mix = ctx.createGain(); mix.gain.value = 0.5;
    var vib = ctx.createOscillator(), vibDepth = ctx.createGain();
    vib.frequency.value = VOICE.vibratoRate; vibDepth.gain.setValueAtTime(0, t0);
    vibDepth.gain.linearRampToValueAtTime(f * VOICE.vibratoDepth, t0 + VOICE.vibratoDelay);
    vib.connect(vibDepth); vib.start(t0); vib.stop(tEnd + 0.2); nodes.push(vib);
    [-VOICE.detune, VOICE.detune].forEach(function (cents) {
      var o = ctx.createOscillator(); o.type = 'sawtooth';
      o.detune.value = cents;
      o.frequency.setValueAtTime(f * VOICE.scoop, t0);
      o.frequency.exponentialRampToValueAtTime(f, t0 + VOICE.scoopTime);
      vibDepth.connect(o.frequency);
      o.connect(mix); o.start(t0); o.stop(tEnd + 0.2); nodes.push(o);
    });

    // the vowel
    VOICE.formants.forEach(function (p) {
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p[0]; bp.Q.value = p[1];
      var g = ctx.createGain(); g.gain.value = p[2] * 2.2;
      mix.connect(bp); bp.connect(g); g.connect(master);
    });

    // breath
    if (VOICE.breath > 0) {
      var nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), nd = nb.getChannelData(0);
      for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      var ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
      var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 1;
      var ng = ctx.createGain(); ng.gain.value = VOICE.breath;
      ns.connect(nf); nf.connect(ng); ng.connect(master); ns.start(t0); ns.stop(tEnd + 0.2); nodes.push(ns);
    }

    voice = { nodes: nodes, gain: master };
  }

  function stopVoice(instant) {
    if (!voice || !ctx) { voice = null; return; }
    var v = voice; voice = null;
    try {
      v.gain.gain.cancelScheduledValues(ctx.currentTime);
      v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), ctx.currentTime);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (instant ? 0.05 : 0.4));
    } catch (e) {}
    setTimeout(function () { v.nodes.forEach(function (n) { try { n.stop(); } catch (e) {} }); }, 600);
  }

  /* ---------- the background loop ---------- */
  function setPaused(paused) {
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pauseBtn.setAttribute('aria-label', paused ? 'Play the video' : 'Pause the video');
  }
  function startLoop() {
    if (reduced) { loop.pause(); setPaused(true); return; }
    var p = loop.play(); if (p && p.catch) p.catch(function () {});
    setPaused(false);
  }

  /* ---------- the intro: the full clip once, with the voice, then straight back to the loop ---------- */
  function finishIntro() {
    if (root.getAttribute('data-intro') === 'done') return;
    clearTimeout(endTimer);
    film.removeEventListener('ended', finishIntro);
    stopVoice(false);
    film.pause();
    root.classList.remove('needs-sound');
    setState('done');
    howlBtn.setAttribute('aria-label', 'Hear the howl'); howlBtn.classList.remove('is-skip');
    startLoop();
  }

  function playIntro() {
    loop.pause();
    setState('playing');
    howlBtn.setAttribute('aria-label', 'Skip the intro'); howlBtn.classList.add('is-skip');
    film.currentTime = 0;
    introDur = (film.duration && isFinite(film.duration)) ? film.duration : 5.88;
    startVoice(introDur - VOICE.delay - VOICE.endEarly);
    checkSound();
    var p = film.play(); if (p && p.catch) p.catch(finishIntro);
    film.addEventListener('ended', finishIntro);
    clearTimeout(endTimer);
    endTimer = setTimeout(finishIntro, (introDur + 1.5) * 1000);   // safety net if 'ended' never fires
  }

  /* sound blocked until the visitor interacts: show the hint, and start the voice on the first click or key */
  function checkSound() {
    setTimeout(function () {
      var blocked = !ctx || ctx.state !== 'running';
      root.classList.toggle('needs-sound', blocked && root.getAttribute('data-intro') === 'playing');
    }, 150);
  }
  function unlockSound(e) {
    if (root.getAttribute('data-intro') !== 'playing' || !root.classList.contains('needs-sound')) return;
    if (e && e.target && e.target.closest && e.target.closest('#howl')) return;   // the skip button just skips
    root.classList.remove('needs-sound');
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    ctx.resume().then(function () {
      // pick the note up where the clip is now, with a short swell
      var left = introDur - film.currentTime - VOICE.endEarly;
      if (left > 0.5) startVoice(left, 0);
    });
  }

  /* ---------- wiring ---------- */
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, unlockSound, true);
  });

  howlBtn.addEventListener('click', function () {
    var st = root.getAttribute('data-intro');
    if (st === 'done') playIntro(); else if (st === 'playing') finishIntro();
  });
  pauseBtn.addEventListener('click', function () {
    if (pauseBtn.getAttribute('aria-pressed') === 'true') startLoop();
    else { loop.pause(); setPaused(true); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.getAttribute('data-intro') === 'playing') finishIntro();
  });

  if (root.getAttribute('data-intro') === 'done') startLoop();
  else if (film.readyState >= 1) playIntro();
  else {
    film.addEventListener('loadedmetadata', function () {
      if (root.getAttribute('data-intro') === 'playing') { clearTimeout(endTimer); playIntro(); }
    }, { once: true });
    endTimer = setTimeout(finishIntro, 4000);   // the clip never loaded: draw the page anyway
  }
})();
