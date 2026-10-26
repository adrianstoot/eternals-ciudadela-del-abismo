const PALETTE = ['#d6a2ff', '#a762ff', '#8d63ff', '#f1d8ff', '#bd7bff', '#ff829b'];

// Light-weight, title-only particles: no Three.js renderer, textures or
// per-frame allocations, so they disappear as soon as the player starts.
export class TitleParticles {
  constructor(canvas, screen, mode = 'title') {
    this.canvas = canvas;
    this.screen = screen;
    this.mode = mode;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.motionReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.running = false;
    this.frame = 0;
    this.lastFrame = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this._resize = () => this.resize();
    this._visibility = () => {
      if (document.hidden) this._cancel();
      else if (this.running && !this.screen.classList.contains('departing')) this._request();
    };
    this.resize();
    this.particles = this._createParticles();
    this.running = true;
    if (this.motionReduced) this.draw(0);
    else this._request();
    addEventListener('resize', this._resize, { passive: true });
    document.addEventListener('visibilitychange', this._visibility);
  }

  _createParticles() {
    let seed = 0x7e7a41;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const compact = this.width < 700;
    const count = this.mode === 'world' ? (compact ? 75 : 170) : compact ? 42 : 112;
    return Array.from({ length: count }, (_, index) => {
      // Focus the magic around the heading and play action, with just a few
      // distant motes to blend it into the artwork.
      const zone = random();
      const focused = zone < .88;
      const mobileX = .12 + random() * .76;
      const mobileY = zone < .34 ? .68 + random() * .17 : zone < .64 ? .82 + random() * .12 : .22 + random() * .7;
      const colorRoll = random();
      return {
        x: this.mode === 'world' ? random() : compact ? mobileX : focused ? .035 + random() * .58 : random() * .96,
        y: this.mode === 'world' ? random() : compact ? mobileY : zone < .34 ? .35 + random() * .15 : zone < .64 ? .5 + random() * .17 : focused ? .18 + random() * .68 : .04 + random() * .92,
        radius: index % 9 === 0 ? 2 + random() * 1.25 : .8 + random() * 1.15,
        speed: 5 + random() * 13,
        drift: (random() - .5) * 8,
        phase: random() * Math.PI * 2,
        frequency: .45 + random() * 1.1,
        alpha: .38 + random() * .46,
        color: colorRoll < .68 ? PALETTE[0] : colorRoll < .87 ? PALETTE[1 + Math.floor(random() * 3)] : colorRoll < .96 ? PALETTE[4] : PALETTE[5],
        spark: index % 9 === 0,
      };
    });
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.width = box.width;
    this.height = box.height;
    this.dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.particles) {
      this.particles = this._createParticles();
      if (this.motionReduced) this.draw(0);
    }
  }

  _request() {
    if (!this.frame && this.running && !document.hidden) this.frame = requestAnimationFrame(time => this.draw(time));
  }

  _cancel() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  draw(time) {
    this.frame = 0;
    const { ctx, width, height } = this;
    if (!ctx || !width || !height) return;
    const now = time * .001;
    const dt = this.motionReduced ? 0 : Math.min(.04, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      if (!this.motionReduced) {
        p.y -= p.speed * dt / height;
        p.x += (p.drift + Math.sin(now * p.frequency + p.phase) * 2.4) * dt / width;
        if (p.y < (this.mode === 'world' ? -.02 : .1)) { p.y = 1.02; if (this.mode !== 'world') p.x = .035 + ((p.x + .11) % .58); }
      }
      const x = p.x * width;
      const y = p.y * height;
      const pulse = .72 + Math.sin(now * p.frequency + p.phase) * .28;
      const alpha = p.alpha * pulse;
      ctx.globalAlpha = alpha;
      if (p.spark) {
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 11;
        ctx.beginPath();
        ctx.arc(x, y, p.radius * .74, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = alpha * .65;
        ctx.fillRect(x - p.radius * 1.8, y - .35, p.radius * 3.6, .7);
        ctx.fillRect(x - .35, y - p.radius * 1.8, .7, p.radius * 3.6);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    if (!this.motionReduced && this.running && !this.screen.classList.contains('departing')) this._request();
  }

  stop() {
    this.running = false;
    this._cancel();
    this.ctx?.clearRect(0, 0, this.width, this.height);
    removeEventListener('resize', this._resize);
    document.removeEventListener('visibilitychange', this._visibility);
  }
}
