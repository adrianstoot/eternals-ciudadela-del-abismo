import { assetUrl } from '../assetUrl.js';

// A single audio bus owns gain, pause and source cleanup.
export class SynthAudio {
  constructor() {
    this.ctx = null; this.master = null; this.volume = .55; this.muted = false;
    this.paused = true; this.sources = new Set(); this.ambience = null;
    this.buffers = new Map(); this.assetInfo = {}; this.sampleCounts = {}; this.ambientStarts = 0;
    this.assetsReady = false; this.loadPromise = null;
  }
  loadAssets() {
    if (this.loadPromise) return this.loadPromise;
    const ctx = this._ensure();
    if (!ctx) return Promise.reject(new Error('Este navegador no permite audio Web Audio.'));
    const assets = {
      sword1: 'sword-combo-1.mp3', sword2: 'sword-combo-2.mp3', sword3: 'sword-combo-3.mp3',
      magic: 'magic-attack.mp3', atmosphere: 'dark-atmosphere-loop.mp3',
    };
    this.loadPromise = Promise.all(Object.entries(assets).map(async ([id, file]) => {
      const response = await fetch(assetUrl(`audio/eternals/${file}`));
      if (!response.ok) throw new Error(`No se pudo cargar el sonido ${file}`);
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      const samples = buffer.getChannelData(0);
      let peak = 0, first = 0;
      for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
      if (id !== 'atmosphere') {
        const threshold = Math.max(.0015, peak * .015);
        while (first < samples.length && Math.abs(samples[first]) < threshold) first++;
        first = Math.max(0, first - Math.round(buffer.sampleRate * .008));
      }
      this.buffers.set(id, buffer);
      this.assetInfo[id] = { file, duration: buffer.duration, offset: first / buffer.sampleRate, peak };
    })).then(() => { this.assetsReady = true; });
    return this.loadPromise;
  }
  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC(); this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume * .42;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -18; limiter.knee.value = 12; limiter.ratio.value = 5;
      this.master.connect(limiter); limiter.connect(this.ctx.destination);
      this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const values = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < values.length; i++) values[i] = Math.random() * 2 - 1;
    }
    return this.ctx;
  }
  unlock() {
    const ctx = this._ensure(); if (!ctx || this.paused) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!this.ambience && this.buffers.has('atmosphere')) {
      const source = ctx.createBufferSource(); source.buffer = this.buffers.get('atmosphere'); source.loop = true;
      source.loopStart = 0; source.loopEnd = source.buffer.duration;
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(.65, ctx.currentTime + 1.2);
      source.connect(gain).connect(this.master); source.start();
      this.ambience = { source, gain }; this.ambientStarts++;
    }
  }
  prepare() {
    const ctx = this._ensure();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  }
  playUi(kind = 'hover', activate = false) {
    if (this.muted) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || (!this.uiCtx && !activate)) return;
    if (!this.uiCtx) this.uiCtx = new AC();
    const ctx = this.uiCtx;
    const play = () => {
      if (this.muted || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (kind === 'hover' && now - (this.lastUiHover || -1) < .12) return;
      if (kind === 'hover') this.lastUiHover = now;
      const tone = (frequency, delay, volume, length) => {
        const oscillator = ctx.createOscillator(), gain = ctx.createGain();
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, now + delay);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * .88, now + delay + length);
        gain.gain.setValueAtTime(.0001, now + delay);
        gain.gain.linearRampToValueAtTime(volume * this.volume, now + delay + .01);
        gain.gain.exponentialRampToValueAtTime(.0001, now + delay + length);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(now + delay); oscillator.stop(now + delay + length + .01);
      };
      if (kind === 'click') { tone(740, 0, .11, .13); tone(1100, .055, .055, .18); }
      else tone(960, 0, .045, .09);
    };
    if (ctx.state === 'running') play();
    else if (activate) ctx.resume().then(play).catch(() => {});
  }
  setPaused(paused) { this.paused = paused; if (paused) this.ctx?.suspend().catch(() => {}); else this.unlock(); }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, value)); this._syncVolume(); }
  toggleMute() { this.muted = !this.muted; this._syncVolume(); return this.muted; }
  _syncVolume() {
    if (!this.master) return;
    const now = this.ctx.currentTime, gain = this.master.gain;
    gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(this.muted ? 0 : this.volume * .42, now + .045);
  }
  _track(source) { this.sources.add(source); source.onended = () => { this.sources.delete(source); source.disconnect(); }; }
  _playSample(id, volume = .8, rate = 1) {
    if (this.paused) return false;
    const buffer = this.buffers.get(id), ctx = this._ensure();
    if (!ctx || !buffer) return false;
    this.unlock();
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer; source.playbackRate.value = rate;
    const info = this.assetInfo[id], offset = info.offset || 0;
    const duration = (buffer.duration - offset) / rate;
    const now = ctx.currentTime;
    const normalized = volume * Math.min(1.5, .8 / Math.max(.25, info.peak));
    gain.gain.setValueAtTime(normalized, now);
    gain.gain.setValueAtTime(normalized, now + Math.max(.02, duration - .07));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain).connect(this.master); this._track(source);
    source.start(now, offset); source.stop(now + duration + .005);
    this.sampleCounts[id] = (this.sampleCounts[id] || 0) + 1;
    return true;
  }
  _tone(from, to, duration, volume, type = 'sine', delay = 0) {
    if (this.paused) return;
    const ctx = this._ensure(); if (!ctx) return; this.unlock();
    const now = ctx.currentTime + delay, source = ctx.createOscillator(), gain = ctx.createGain();
    source.type = type; source.frequency.setValueAtTime(from, now); source.frequency.exponentialRampToValueAtTime(Math.max(15, to), now + duration);
    gain.gain.setValueAtTime(.0001, now); gain.gain.linearRampToValueAtTime(volume, now + .008); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(gain).connect(this.master); this._track(source); source.start(now); source.stop(now + duration + .01);
  }
  _noise(duration, frequency, volume, delay = 0, type = 'bandpass') {
    if (this.paused) return;
    const ctx = this._ensure(); if (!ctx) return; this.unlock();
    const now = ctx.currentTime + delay, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this.noiseBuffer; filter.type = type; filter.frequency.value = frequency; filter.Q.value = .7;
    gain.gain.setValueAtTime(.0001, now); gain.gain.linearRampToValueAtTime(volume, now + .012); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master); this._track(source); source.start(now, Math.random() * .5); source.stop(now + duration + .01);
  }
  playSwing(combo = 1) { this._playSample(`sword${Math.max(1, Math.min(3, combo))}`, combo === 0 ? .42 : .9, combo === 0 ? .92 : 1); }
  playHit() { this._noise(.13, 1800, .3); this._tone(135, 43, .16, .3); this._tone(780, 560, .19, .045, 'triangle'); }
  playSpellCharge() { this._noise(.34, 2300, .13); this._tone(180, 520, .34, .09); }
  playSpellLaunch() { this._playSample('magic', 1); }
  playNixSpell() { this._playSample('magic', .3, 1.18); }
  playExplosion() { this._noise(.42, 650, .38, 0, 'lowpass'); this._tone(100, 25, .42, .32); }
  playHeal() { [523, 659, 784].forEach((n, i) => this._tone(n, n * 1.002, .27, .09, 'sine', i * .065)); }
  playLink() { [220, 330, 440, 660].forEach((n, i) => this._tone(n, n * .99, .38, .08, 'triangle', i * .05)); }
  playLimit() { this._noise(.4, 480, .25); this._tone(90, 32, .65, .3); this._tone(440, 130, .5, .1, 'triangle', .1); }
  playJump() { this._noise(.15, 520, .12); }
  playDodge() { this._noise(.2, 1100, .18); }
  playLand() { this._noise(.11, 380, .12, 0, 'lowpass'); this._tone(76, 40, .09, .07); }
  playFootstep() { this._noise(.07, 560, .065, 0, 'lowpass'); }
  playMenu() { this._tone(540, 430, .075, .055, 'triangle'); }
  reset(stopAmbience = false) {
    for (const source of this.sources) { try { source.stop(); } catch {} }
    this.sources.clear(); if (stopAmbience && this.ambience) { this.ambience.source.stop(); this.ambience = null; }
  }
}

