import * as THREE from 'three';

export class HUDManager {
  constructor(camera, audio, onCommandExecute) {
    this.camera = camera;
    this.audio = audio;
    this.onCommandExecute = onCommandExecute;

    this.hpFill = document.getElementById('hud-hp-fill');
    this.mpFill = document.getElementById('hud-mp-fill');
    this.statHp = document.getElementById('stat-hp');
    this.statMp = document.getElementById('stat-mp');
    this.mobileHp = document.getElementById('mobile-hp');
    this.mobileMp = document.getElementById('mobile-mp');
    this.mobileHpFill = document.getElementById('mobile-hp-fill');
    this.mobileMpFill = document.getElementById('mobile-mp-fill');

    this.limitRoot = document.getElementById('hud-limit');
    this.limitBarFill = document.getElementById('limit-bar-fill');
    this.limitArcFill = document.getElementById('limit-arc-fill');

    this.zoneName = document.getElementById('zone-name');
    this.minimapCoord = document.getElementById('minimap-coord');
    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas?.getContext('2d');

    this.enemyHud = document.getElementById('enemy-hud');
    this.enemyRank = document.getElementById('enemy-rank');
    this.enemyName = document.getElementById('enemy-name');
    this.enemyHpText = document.getElementById('enemy-hp-text');
    this.enemyBarTrail = document.getElementById('enemy-bar-trail');
    this.enemyBarFill = document.getElementById('enemy-bar-fill');

    this.lockReticle = document.getElementById('lock-reticle');
    this.interactPrompt = document.getElementById('interact-prompt');
    this.interactText = document.getElementById('interact-text');

    this.floatingLayer = document.getElementById('floating-layer');
    this.p5Flash = document.getElementById('p5-flash');
    this.p5Cutin = document.getElementById('p5-cutin');
    this.p5CutinTitle = document.getElementById('p5-cutin-title');
    this.partyLyra = document.getElementById('party-lyra');

    this.cmdButtons = Array.from(document.querySelectorAll('.cmd-item'));
    this.touchButtons = Object.fromEntries([...document.querySelectorAll('[data-touch-cmd]')].map(button => [button.dataset.touchCmd, button]));
    this.selectedCmdIndex = 0;
    this.floaters = [];
    this.enemyPlates = new Map();
    this.compactEnemyHud = matchMedia('(pointer: coarse), (max-width: 700px)').matches;
    addEventListener('resize', () => {
      this.compactEnemyHud = matchMedia('(pointer: coarse), (max-width: 700px)').matches;
    }, { passive: true });
    this.combatTarget = null;
    this.combatTargetTimer = 0;

    this.minimapTick = 0;
    this.damageTime = 0;
    this.cutInTime = 0;
    this.companionTime = 0;

    this._projVec = new THREE.Vector3();
    this._platePos = new THREE.Vector3();
    this._reticlePos = new THREE.Vector3();

    this._bindCommandEvents();
  }

  _bindCommandEvents() {
    this.cmdButtons.forEach((btn, idx) => {
      btn.addEventListener('mouseenter', () => {
        if (this.selectedCmdIndex !== idx) {
          this.selectCommand(idx, true);
        }
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectCommand(idx, false);
        const cmd = btn.dataset.cmd;
        this.onCommandExecute?.(cmd);
      });
    });

    this.partyLyra?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectCommand(3, false);
      this.onCommandExecute?.('link');
    });

    this.limitRoot?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onCommandExecute?.('limit');
    });
  }

  selectCommand(index, playSound = true) {
    this.selectedCmdIndex = (index + this.cmdButtons.length) % this.cmdButtons.length;
    this.cmdButtons.forEach((btn, idx) => {
      btn.classList.toggle('selected', idx === this.selectedCmdIndex);
    });
    if (playSound) this.audio?.playMenu();
  }

  cycleCommand(delta) {
    this.selectCommand(this.selectedCmdIndex + delta, true);
  }

  getSelectedCommand() {
    return this.cmdButtons[this.selectedCmdIndex]?.dataset.cmd || 'attack';
  }

  setCombatTarget(enemy, duration = 6.5) {
    if (!enemy || enemy.dead) return;
    this.combatTarget = enemy;
    this.combatTargetTimer = duration;
  }

  triggerCutIn(title = 'JUICIO DEL ABISMO') {
    if (this.p5CutinTitle) this.p5CutinTitle.textContent = title;
    this.p5Flash?.classList.remove('active');
    this.p5Cutin?.classList.remove('active');
    void this.p5Flash?.offsetWidth;
    this.p5Flash?.classList.add('active');
    this.p5Cutin?.classList.add('active');
    this.cutInTime = 0.6;
  }

  pulseCompanion() {
    if (!this.partyLyra) return;
    this.partyLyra.classList.add('active-link');
    this.companionTime = 1;
  }

  spawnFloatingText(worldPos, value, style = 'slash', tag = '') {
    if (!this.floatingLayer) return;
    const el = document.createElement('div');
    el.className = `dmg-float ${style}`;
    el.innerHTML = `${tag ? `<span class="dmg-tag">${tag}</span>` : ''}${value}`;
    this.floatingLayer.appendChild(el);

    this.floaters.push({
      el,
      worldPos: worldPos.clone().add(
        new THREE.Vector3((Math.random() - 0.5) * 0.75, 1.55 + Math.random() * 0.35, (Math.random() - 0.5) * 0.75)
      ),
      age: 0,
      life: 0.92,
    });
    if (this.floaters.length > 28) this.floaters.shift().el.remove();
  }

  reset() {
    for (const f of this.floaters) f.el.remove();
    this.floaters.length = 0;
    for (const plate of this.enemyPlates.values()) {
      plate.root.style.display = 'none';
    }
    this.combatTarget = null;
    this.combatTargetTimer = 0;
    this.damageTime = this.cutInTime = 0;
    this.companionTime = 0;
    this.partyLyra?.classList.remove('active-link');
    this.p5Flash?.classList.remove('active');
    this.p5Cutin?.classList.remove('active');
    document.getElementById('damage-vignette')?.classList.remove('active');
  }

  showDamage() {
    this.damageTime = 0.22;
    document.getElementById('damage-vignette')?.classList.add('active');
  }

  updateAbilities(player) {
    const buttons = this.cmdButtons;
    if (buttons[1]) buttons[1].disabled = player.mp < 28 || player.state === 'Death';
    if (buttons[2]) {
      buttons[2].disabled = player.items <= 0 || player.itemCooldown > 0;
      buttons[2].querySelector('.cmd-key').textContent = `${player.items} · 1 / H`;
    }
    if (buttons[3]) {
      buttons[3].disabled = player.linkCooldown > 0;
      buttons[3].querySelector('.cmd-key').textContent =
        player.linkCooldown > 0 ? `${Math.ceil(player.linkCooldown)} s` : '2 / L';
    }
    const { magic: touchMagic, items: touchHeal, link: touchLink, limit: touchLimit } = this.touchButtons;
    if (touchMagic) touchMagic.disabled = player.mp < 28 || player.state === 'Death';
    if (touchHeal) touchHeal.disabled = player.items <= 0 || player.itemCooldown > 0;
    if (touchLink) touchLink.disabled = player.linkCooldown > 0;
    if (touchLimit) {
      touchLimit.disabled = player.limitGauge < 100 || player.state === 'Death';
      touchLimit.classList.toggle('available', !touchLimit.disabled);
    }
  }

  _ensureEnemyPlate(e) {
    let plate = this.enemyPlates.get(e.id);
    if (plate) return plate;

    const root = document.createElement('div');
    const isSeal = !!e.objective;
    const isBoss = isSeal || e.tier === 3;
    root.className = `enemy-plate tier-${e.tier}${isBoss ? ' is-boss' : ''}${isSeal ? ' is-seal' : ''}`;
    root.style.display = 'none';

    const top = document.createElement('div');
    top.className = 'enemy-plate-top';

    const badge = document.createElement('span');
    badge.className = 'enemy-plate-badge';
    badge.textContent = isSeal ? '✦' : e.tier === 3 ? '◆' : e.tier === 2 ? '❖' : '◈';

    const name = document.createElement('span');
    name.className = 'enemy-plate-name';
    name.textContent = e.name;

    top.append(badge, name);

    const track = document.createElement('div');
    track.className = 'enemy-plate-track';

    const trail = document.createElement('div');
    trail.className = 'enemy-plate-trail';

    const fill = document.createElement('div');
    fill.className = 'enemy-plate-fill';

    track.append(trail, fill);
    root.append(top, track);
    this.floatingLayer?.appendChild(root);

    plate = { root, top, name, trail, fill, lastPct: -1, lastTrailPct: -1 };
    this.enemyPlates.set(e.id, plate);
    return plate;
  }

  _resolveHudTarget(player, enemies, lockedEnemy) {
    if (lockedEnemy && !lockedEnemy.dead && !lockedEnemy.disabled) return lockedEnemy;
    if (
      this.combatTarget &&
      !this.combatTarget.dead &&
      !this.combatTarget.disabled &&
      this.combatTargetTimer > 0 &&
      this.combatTarget.position.distanceTo(player.position) < 28
    ) {
      return this.combatTarget;
    }

    let bestBoss = null;
    let bestBossDist = 20.5;
    let bestCombat = null;
    let bestCombatDist = 15.0;

    for (const e of enemies) {
      if (e.dead || e.disabled) continue;
      if (Math.abs(e.position.y - player.position.y) > 3.2) continue;
      const d = e.position.distanceTo(player.position);
      if ((e.objective || e.tier === 3) && d < bestBossDist) {
        bestBossDist = d;
        bestBoss = e;
      }
      if (['chase', 'windup', 'slash', 'recover', 'hit'].includes(e.state) && d < bestCombatDist) {
        bestCombatDist = d;
        bestCombat = e;
      }
    }
    return bestBoss || bestCombat || null;
  }

  _updateEnemyPlates(player, enemies, lockedEnemy, hudTarget) {
    if (!this.floatingLayer || !enemies) return;
    const overview = !!window.__GAME__?.cameraCtrl?.presetIndex;

    let targetProjX = -9999;
    let targetProjY = -9999;
    let targetDist = 9999;
    if (hudTarget && !hudTarget.dead && !hudTarget.disabled) {
      targetDist = hudTarget.position.distanceTo(player.position);
      this._platePos.set(
        hudTarget.position.x,
        hudTarget.position.y + (hudTarget.scale || 1.0) * 1.35,
        hudTarget.position.z
      );
      const tProj = this._projectToScreen(this._platePos);
      if (tProj.visible) {
        targetProjX = tProj.x;
        targetProjY = tProj.y;
      }
    }

    const visiblePlates = [];

    for (const e of enemies) {
      const plate = this._ensureEnemyPlate(e);
      if (e.dead || e.disabled || overview) {
        if (plate.root.style.display !== 'none') plate.root.style.display = 'none';
        continue;
      }

      // Bosses & Seal Guardians actively shown in the grand top #enemy-hud never show a redundant second banner
      if (hudTarget === e && (e.objective || e.tier === 3)) {
        if (plate.root.style.display !== 'none') plate.root.style.display = 'none';
        continue;
      }

      const dist = e.position.distanceTo(player.position);
      const isLocked = lockedEnemy === e;
      const isDamaged = e.hp < e.maxHp;
      const inCombat = ['chase', 'windup', 'slash', 'recover', 'hit'].includes(e.state);
      const maxVisibleDist = e.objective || e.tier === 3 ? 28 : 23;

      if (!isLocked && !isDamaged && !inCombat && dist > maxVisibleDist) {
        if (plate.root.style.display !== 'none') plate.root.style.display = 'none';
        continue;
      }
      if (dist > 38 && !isLocked) {
        if (plate.root.style.display !== 'none') plate.root.style.display = 'none';
        continue;
      }

      const headHeight = (e.scale || 1.0) * 1.98 + (e.objective ? 0.16 : 0.08);
      this._platePos.set(e.position.x, e.position.y + headHeight, e.position.z);
      const proj = this._projectToScreen(this._platePos);
      if (
        !proj.visible ||
        proj.x < -30 ||
        proj.x > window.innerWidth + 30 ||
        proj.y < -40 ||
        proj.y > window.innerHeight + 40
      ) {
        if (plate.root.style.display !== 'none') plate.root.style.display = 'none';
        continue;
      }

      // Prevent close-range overhead plates from colliding with top-center #objective / #enemy-hud
      if (hudTarget === e && proj.y < 260) {
        if (plate.root.style.display !== 'none') plate.root.style.display = 'none';
        continue;
      }
      if (proj.y < 195 && Math.abs(proj.x - window.innerWidth * 0.5) < 265) {
        proj.y = 195;
      }

      // Suppress distant background enemy plates occluded directly behind the active foreground combat target
      if (
        hudTarget &&
        hudTarget !== e &&
        !isLocked &&
        dist > targetDist + 5.5 &&
        Math.abs(proj.x - targetProjX) < 95 &&
        Math.abs(proj.y - targetProjY) < 125
      ) {
        if (plate.root.style.display !== 'none') plate.root.style.display = 'none';
        continue;
      }

      plate.root.style.display = '';
      const pct = THREE.MathUtils.clamp((e.hp / e.maxHp) * 100, 0, 100);
      const trailPct = THREE.MathUtils.clamp(((e.trailHp ?? e.hp) / e.maxHp) * 100, pct, 100);

      if (Math.abs(pct - plate.lastPct) > 0.05) {
        plate.fill.style.width = `${pct.toFixed(1)}%`;
        plate.lastPct = pct;
      }
      if (Math.abs(trailPct - plate.lastTrailPct) > 0.05) {
        plate.trail.style.width = `${trailPct.toFixed(1)}%`;
        plate.lastTrailPct = trailPct;
      }

      const showTop =
        hudTarget !== e && (isLocked || isDamaged || e.objective || e.tier === 3 || dist < 16.5);
      if (plate.top) plate.top.style.display = showTop ? '' : 'none';
      plate.root.classList.toggle('is-locked', isLocked);
      plate.root.classList.toggle('is-windup', e.state === 'windup');

      const distAlpha = isLocked || isDamaged
        ? 1.0
        : THREE.MathUtils.clamp(1.0 - (dist - 15.5) / (maxVisibleDist - 15.5), 0.35, 1.0);
      const scale = THREE.MathUtils.clamp(1.08 - dist * 0.014, 0.76, 1.04);
      const marginX = showTop ? 98 * scale : 56 * scale;
      const sx = THREE.MathUtils.clamp(proj.x, marginX, window.innerWidth - marginX);
      const sy = THREE.MathUtils.clamp(proj.y, 44, window.innerHeight - 36);

      visiblePlates.push({ plate, x: sx, y: sy, dist, scale, alpha: distAlpha, showTop, isLocked, isDamaged });
    }

    // Front-to-back vertical de-overlap so clustered Sentinels never stack unreadable banners
    visiblePlates.sort((a, b) => Number(b.isLocked) - Number(a.isLocked) || Number(b.isDamaged) - Number(a.isDamaged) || a.dist - b.dist);
    const visiblePlateLimit = this.compactEnemyHud ? 2 : 6;
    for (let i = 0; i < visiblePlates.length; i++) {
      const cur = visiblePlates[i];
      if (i >= visiblePlateLimit) {
        cur.plate.root.style.display = 'none';
        continue;
      }
      for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < i; j++) {
          const prev = visiblePlates[j];
          const minDx = (cur.showTop || prev.showTop ? 142 : 92) * Math.max(cur.scale, prev.scale);
          const minDy = (cur.showTop ? 30 : 18) * Math.max(cur.scale, prev.scale);
          if (Math.abs(cur.x - prev.x) < minDx && Math.abs(cur.y - prev.y) < minDy) {
            cur.y = Math.max(38, prev.y - minDy);
          }
        }
      }
      cur.plate.root.style.opacity = cur.alpha.toFixed(2);
      cur.plate.root.style.transform = `translate3d(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${cur.scale.toFixed(2)})`;
    }
  }

  update(dt, player, mapScene, enemies, lockedEnemy, activeTeleporter) {
    if (this.damageTime > 0) {
      this.damageTime -= dt;
      if (this.damageTime <= 0) document.getElementById('damage-vignette')?.classList.remove('active');
    }
    if (this.cutInTime > 0) {
      this.cutInTime -= dt;
      if (this.cutInTime <= 0) {
        this.p5Flash?.classList.remove('active');
        this.p5Cutin?.classList.remove('active');
      }
    }
    if (this.companionTime > 0) {
      this.companionTime -= dt;
      if (this.companionTime <= 0) this.partyLyra?.classList.remove('active-link');
    }
    if (this.combatTargetTimer > 0) {
      this.combatTargetTimer = Math.max(0, this.combatTargetTimer - dt);
      if (this.combatTarget?.dead) this.combatTarget = null;
    }

    // 1. HP & MP Bars (calibrated to exact UI texture pixel bounds)
    const hpRatio = THREE.MathUtils.clamp(player.hp / player.maxHp, 0, 1);
    const hpRightPct = 100 - (34.46 + (95.34 - 34.46) * hpRatio);
    if (this.hpFill) {
      this.hpFill.style.clipPath = `inset(0 ${hpRightPct.toFixed(2)}% 0 0)`;
    }
    if (this.statHp) this.statHp.textContent = Math.round(player.hp);
    if (this.mobileHp) this.mobileHp.textContent = Math.round(player.hp);
    if (this.mobileHpFill) this.mobileHpFill.style.transform = `scaleX(${hpRatio})`;

    const mpRatio = THREE.MathUtils.clamp(player.mp / player.maxMp, 0, 1);
    const mpRightPct = 100 - (36.72 + (92.51 - 36.72) * mpRatio);
    if (this.mpFill) {
      this.mpFill.style.clipPath = `inset(0 ${mpRightPct.toFixed(2)}% 0 0)`;
    }
    if (this.statMp) this.statMp.textContent = Math.round(player.mp);
    if (this.mobileMp) this.mobileMp.textContent = Math.round(player.mp);
    if (this.mobileMpFill) this.mobileMpFill.style.transform = `scaleX(${mpRatio})`;

    // 2. Limit Gauge
    const limRatio = THREE.MathUtils.clamp(player.limitGauge / 100, 0, 1);
    const limRightPct = 100 - (21.92 + (78.57 - 21.92) * limRatio);
    if (this.limitBarFill) {
      this.limitBarFill.style.clipPath = `inset(0 ${limRightPct.toFixed(2)}% 0 0)`;
    }
    if (this.limitArcFill) {
      this.limitArcFill.style.opacity = (0.25 + limRatio * 0.75).toFixed(2);
    }
    this.limitRoot?.classList.toggle('ready', player.limitGauge >= 100);

    // 3. District Banner & Teleporter Prompt
    const zone = mapScene.getNearestDistrict(player.position);
    if (this.zoneName && !this.zoneOverride && this.zoneName.textContent !== zone) {
      this.zoneName.textContent = zone;
    }

    if (activeTeleporter) {
      this.interactPrompt?.classList.remove('hidden');
      const destPortal = mapScene.portals?.[activeTeleporter.destIdx];
      if (this.interactText) {
        this.interactText.textContent = `Salto Astral a ${destPortal ? destPortal.name : 'Santuario'}`;
      }
    } else {
      this.interactPrompt?.classList.add('hidden');
    }
    const touchPortal = document.querySelector('[data-touch-cmd="interact"]');
    if (touchPortal) {
      touchPortal.disabled = !activeTeleporter;
      touchPortal.classList.toggle('available', Boolean(activeTeleporter));
      touchPortal.title = activeTeleporter
        ? `Viajar a ${mapScene.portals?.[activeTeleporter.destIdx]?.name || 'Santuario'}`
        : 'Acércate a un portal';
    }

    // 4. Auto-Engaging Top Boss / Combat Target HUD & Lock-On Reticle
    const hudTarget = this._resolveHudTarget(player, enemies, lockedEnemy);
    if (hudTarget) {
      this.enemyHud?.classList.remove('hidden');
      const isSeal = !!hudTarget.objective;
      const isBoss = isSeal || hudTarget.tier === 3;
      this.enemyHud?.classList.toggle('is-seal', isSeal);
      this.enemyHud?.classList.toggle('is-boss', isBoss);

      if (this.enemyRank) {
        this.enemyRank.textContent = isSeal
          ? `✦ GUARDIÁN DEL SELLO · ${hudTarget.objectiveName.toUpperCase()} ✦`
          : hudTarget.tier === 3
            ? '◆ SOBERANO DEL ABISMO · NV. 44'
            : hudTarget.tier === 2
              ? '❖ CABALLERO ABISAL · NV. 42'
              : '◈ CENTINELA DEL ABISMO · NV. 40';
      }
      if (this.enemyName) this.enemyName.textContent = hudTarget.name.toUpperCase();
      if (this.enemyHpText) {
        this.enemyHpText.textContent = `${Math.ceil(hudTarget.hp)} / ${hudTarget.maxHp}`;
      }
      const pct = THREE.MathUtils.clamp((hudTarget.hp / hudTarget.maxHp) * 100, 0, 100);
      const trailPct = THREE.MathUtils.clamp(
        ((hudTarget.trailHp ?? hudTarget.hp) / hudTarget.maxHp) * 100,
        pct,
        100
      );
      if (this.enemyBarFill) this.enemyBarFill.style.width = `${pct.toFixed(1)}%`;
      if (this.enemyBarTrail) this.enemyBarTrail.style.width = `${trailPct.toFixed(1)}%`;
    } else {
      this.enemyHud?.classList.add('hidden');
    }

    if (lockedEnemy && !lockedEnemy.dead) {
      this._reticlePos.set(lockedEnemy.position.x, lockedEnemy.position.y + 1.32, lockedEnemy.position.z);
      const screenPos = this._projectToScreen(this._reticlePos);
      if (screenPos.visible) {
        this.lockReticle?.classList.remove('hidden');
        this.lockReticle.style.left = `${screenPos.x}px`;
        this.lockReticle.style.top = `${screenPos.y}px`;
      } else {
        this.lockReticle?.classList.add('hidden');
      }
    } else {
      this.lockReticle?.classList.add('hidden');
    }

    // 5. World-Space Floating Enemy Health Bars
    this._updateEnemyPlates(player, enemies, lockedEnemy, hudTarget);

    // 6. Floating Damage Numbers
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age >= f.life) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      f.worldPos.y += dt * 1.45;
      const proj = this._projectToScreen(f.worldPos);
      f.el.style.display = proj.visible ? '' : 'none';
      const alpha = 1 - Math.pow(f.age / f.life, 2);
      const scale = f.age < 0.14 ? 0.65 + (f.age / 0.14) * 0.55 : 1.2 - (f.age / f.life) * 0.25;
      f.el.style.left = `${proj.x}px`;
      f.el.style.top = `${proj.y}px`;
      f.el.style.opacity = alpha.toFixed(2);
      f.el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(2)})`;
    }

    // 7. Real-Time Circular Minimap
    this.minimapTick += dt;
    if (this.minimapTick >= 0.075 || dt === 0) {
      this.minimapTick = 0;
      this._renderMinimap(player, mapScene, enemies, lockedEnemy);
    }
  }

  _projectToScreen(worldVec) {
    this._projVec.copy(worldVec).project(this.camera);
    const halfW = window.innerWidth * 0.5;
    const halfH = window.innerHeight * 0.5;
    return {
      x: this._projVec.x * halfW + halfW,
      y: -this._projVec.y * halfH + halfH,
      visible: this._projVec.z < 1.0 && this._projVec.z > -1.0,
    };
  }

  _renderMinimap(player, mapScene, enemies, lockedEnemy) {
    const ctx = this.minimapCtx;
    if (!ctx) return;

    const W = 256;
    const H = 256;
    const cx = W * 0.5;
    const cy = H * 0.5;
    const scale = 1.65; // pixels per world meter

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 108, 0, Math.PI * 2);
    ctx.clip();

    // Abyssal radar background
    const bg = ctx.createRadialGradient(cx, cy, 8, cx, cy, 110);
    bg.addColorStop(0, 'rgba(38, 14, 68, 0.92)');
    bg.addColorStop(1, 'rgba(9, 4, 18, 0.98)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Subtle radar rings
    ctx.strokeStyle = 'rgba(182, 92, 255, 0.18)';
    ctx.lineWidth = 1;
    for (const r of [36, 72, 102]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const px = player.position.x;
    const pz = player.position.z;
    const toMini = (wx, wz) => [cx + (wx - px) * scale, cy + (wz - pz) * scale];

    const collision = mapScene.collision;
    if (collision) {
      if (this.minimapTerrainSource !== collision) {
        this.minimapTerrainSource = collision;
        this.minimapTerrain = document.createElement('canvas');
        this.minimapTerrain.width = collision.w;
        this.minimapTerrain.height = collision.h;
        const terrainCtx = this.minimapTerrain.getContext('2d');
        const image = terrainCtx.createImageData(collision.w, collision.h);
        for (let i = 0; i < collision.heights.length; i++) {
          if (collision.heights[i] <= -1000) continue;
          const at = i * 4,
            blocked = collision.flags[i] !== 0;
          const height = Math.max(0, Math.min(18, collision.heights[i]));
          image.data[at] = blocked ? 55 : 93 + height * 2;
          image.data[at + 1] = blocked ? 48 : 88 + height * 2;
          image.data[at + 2] = blocked ? 74 : 123 + height * 2;
          image.data[at + 3] = blocked ? 120 : 215;
        }
        terrainCtx.putImageData(image, 0, 0);
      }
      const [mx, mz] = toMini(collision.x0, collision.z0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        this.minimapTerrain,
        mx,
        mz,
        collision.w * collision.cell * scale,
        collision.h * collision.cell * scale
      );
    }

    // Teleporter nodes (cyan-violet diamonds)
    if (mapScene.portals) {
      for (const tp of mapScene.portals) {
        const [tx, tz] = toMini(tp.pos.x, tp.pos.z);
        ctx.fillStyle = '#6be6ff';
        ctx.beginPath();
        ctx.arc(tx, tz, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Enemies (crimson pulsing dots; gold diamonds for Seal Guardians)
    for (const e of enemies) {
      if (e.dead || e.disabled) continue;
      const [ex, ez] = toMini(e.position.x, e.position.z);
      const isLocked = lockedEnemy && lockedEnemy.id === e.id;
      ctx.fillStyle = isLocked ? '#fff1b4' : e.objective ? '#f0c674' : '#e04f70';
      ctx.beginPath();
      ctx.arc(ex, ez, isLocked ? 5.2 : e.objective ? 4.6 : 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player Arrow at center
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(Math.sin(player.facingYaw), Math.cos(player.facingYaw)));
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ff3864';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(-5.5, -6);
    ctx.lineTo(0, -3);
    ctx.lineTo(5.5, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();

    if (this.minimapCoord) {
      const distSanctuary = Math.round(Math.hypot(px, pz + 5.1));
      this.minimapCoord.textContent = `SANTUARIO ${distSanctuary}m`;
    }
  }
}
