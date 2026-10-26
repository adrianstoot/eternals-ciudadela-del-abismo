import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, FXAAEffect, BlendFunction } from 'postprocessing';
import { MapScene } from '../world/MapScene.js';
import { KHCamera } from '../camera/KHCamera.js';
import { FXManager } from '../fx/FXManager.js';
import { Player } from '../entities/Player.js';
import { EnemyManager } from '../entities/EnemyManager.js';
import { HUDManager } from '../ui/HUDManager.js';
import { TitleParticles } from '../ui/TitleParticles.js';
import { SynthAudio } from '../audio/SynthAudio.js';

const STEP = 1 / 60;
const SPAWN = new THREE.Vector3(0, 8.24, 79.8);
const $ = id => document.getElementById(id);

export class AbyssCitadelGame {
  constructor() {
    this.canvas = $('game-canvas');
    this.scene = new THREE.Scene();
    const isoAspect = innerWidth / innerHeight;
    this.camera = new THREE.OrthographicCamera(-12.5 * isoAspect, 12.5 * isoAspect, 12.5, -12.5, 0.15, 650);
    this.camera.aspect = isoAspect;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, powerPreference: 'high-performance', antialias: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomEffect = new BloomEffect({ intensity: 1.05, luminanceThreshold: 0.58, luminanceSmoothing: 0.28, mipmapBlur: true, radius: 0.65 });
    this.composer.addPass(new EffectPass(this.camera, this.bloomEffect, new VignetteEffect({ offset: 0.28, darkness: 0.38, blendFunction: BlendFunction.NORMAL }), new FXAAEffect()));
    this.audio = new SynthAudio();
    this.titleMusic = $('title-music');
    this.titleMusic.volume = .45;
    this.titleMusicBlocked = false;
    this.titleMusicPending = false;
    this.titleMusicRequest = 0;
    this.titleParticles = new TitleParticles($('title-particles'), $('title-screen'));
    this.fx = new FXManager(this.scene);
    this.mapScene = new MapScene(this.scene, this.renderer);
    this.cameraCtrl = new KHCamera(this.camera, this.canvas);
    this.player = new Player(this.scene, this.fx, this.audio);
    this.hud = new HUDManager(this.camera, this.audio, cmd => this.executeCommand(cmd));
    this.enemyManager = null;
    this.keys = new Set();
    this.touchMove = { forward: 0, right: 0 };
    this.touchSprint = false;
    this.isTouchDevice = matchMedia('(pointer: coarse)').matches;
    this.orientationPausedVideo = false;
    this.lockedEnemy = null;
    this.activeTeleporter = null;
    this.phase = 'loading';
    this.introCutoffSeconds = 5;
    this.introFadeDuration = 550;
    this.introFadeStarted = false;
    this.introCutoffTimer = 0;
    this.introFadeFrame = 0;
    this.introRevealPending = false;
    this.ready = false;
    this.elapsed = 0;
    this.frame = 0;
    this.accumulator = 0;
    this.lastFrameTime = 0;
    this.hitStop = 0;
    this.teleportCooldown = 0;
    this.noticeTime = 0;
    this.killCount = 0;
    this.seals = 0;
    this.frozenForScreenshot = false;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.frameTimes = [];
    this.quality = 'performance';
    this._setQuality('performance');
    this._bindInputs();
    this._bindInterface();
    this._bindTouch();
    this._playTitleMusic();
    addEventListener('pointerdown', e => {
      if (this.titleMusicBlocked && !e.target.closest?.('#title-play, #title-sound')) this._playTitleMusic();
    }, { passive: true });
    addEventListener('resize', () => { this._resize(); this._syncMobileOrientation(); });
    this._installDiagnostics();
  }

  async init() {
    try {
      const audioReady = this.audio.loadAssets();
      await this.mapScene.load((message, progress) => {
        $('loading-progress').style.width = `${Math.round(progress * 75)}%`;
        $('loading-status').textContent = message;
        $('title-load-progress').style.width = `${Math.round(progress * 75)}%`;
        $('title-status').textContent = `Preparando el mundo · ${Math.round(progress * 75)}%`;
      });
      $('loading-status').textContent = 'Preparando a Aeren y sus animaciones…';
      $('loading-progress').style.width = '80%';
      await this.player.load();
      $('loading-status').textContent = 'Despertando a los guardianes…';
      this.enemyManager = new EnemyManager(this.scene, this.fx, this.audio);
      if (this.enemyManager.load) await this.enemyManager.load(this.mapScene);
      else this.enemyManager.reset?.(this.mapScene);
      await audioReady;
      this.player.reset?.(SPAWN.clone());
      const ground = this.mapScene.sampleGround(this.player.position.x, this.player.position.z);
      if (ground.valid) this.player.position.y = ground.height;
      this.cameraCtrl.reset?.(this.player);
      this.mapScene.update(0, 0, this.player.position);
      this.player.root.updateMatrixWorld(true);
      $('loading-status').textContent = 'Preparando la primera imagen de la Ciudadela…';
      $('title-status').textContent = 'Preparando la escena…';
      this.mapScene.atmosphere?.update(this.player.position, this.camera, this.reducedMotion);
      this.renderer.info.reset();
      this.composer.render(STEP);
      this.ready = true;
      $('loading-progress').style.width = '100%';
      $('loading-status').textContent = 'La Ciudadela te espera';
      $('loading-overlay').classList.add('fade-out');
      this._updateObjective();
      this.phase = 'ready';
      this.cameraCtrl.enabled = false;
      $('title-play').disabled = false;
      $('title-load-progress').style.width = '100%';
      $('title-status').textContent = this.isTouchDevice ? 'TOCA JUGAR PARA CONTINUAR' : 'ENTER · COMENZAR';
      $('title-play').focus({ preventScroll: true });
      requestAnimationFrame(t => this._animate(t));
    } catch (err) {
      console.error('No se pudo preparar la Ciudadela:', err);
      $('loading-status').textContent = `No se pudo cargar el juego. ${err.message}`;
      $('loading-overlay').classList.add('load-failed');
      $('title-status').textContent = `No se pudo preparar el juego: ${err.message}`;
    }
  }

  _playTitleMusic(force = false) {
    if (!['loading', 'ready', 'world-map'].includes(this.phase) || this.audio.muted || (this.titleMusicPending && !force)) return;
    const request = ++this.titleMusicRequest;
    this.titleMusicPending = true;
    this.titleMusic.play().then(() => {
      if (request !== this.titleMusicRequest) return;
      this.titleMusicPending = false;
      if (!['loading', 'ready', 'world-map'].includes(this.phase) || this.audio.muted) { this.titleMusic.pause(); return; }
      this.titleMusicBlocked = false;
      $('title-sound').textContent = 'SONIDO ON';
      $('title-sound').setAttribute('aria-label', 'Activar o silenciar el sonido de ETERNALS');
      $('map-sound').textContent = 'SONIDO ON';
      $('map-sound').setAttribute('aria-label', 'Activar o silenciar sonido');
    }).catch(error => {
      if (request !== this.titleMusicRequest) return;
      this.titleMusicPending = false;
      if (!['loading', 'ready', 'world-map'].includes(this.phase) || this.audio.muted) return;
      this.titleMusicBlocked = true;
      $('title-sound').textContent = error.name === 'NotAllowedError' ? 'ACTIVAR MÚSICA' : 'MÚSICA NO DISPONIBLE';
      $('title-sound').setAttribute('aria-label', 'Activar música de la portada');
      if (this.phase === 'world-map') $('map-sound').textContent = error.name === 'NotAllowedError' ? 'ACTIVAR MÚSICA' : 'MÚSICA NO DISPONIBLE';
    });
  }

  _openWorldMap() {
    if (!this.ready || this.phase !== 'ready') return;
    if (this.isTouchDevice) this._requestMobileLandscape();
    this.phase = 'world-map';
    this._playTitleMusic(true);
    this.audio.prepare();
    $('title-screen').classList.add('departing');
    $('title-screen').setAttribute('aria-hidden', 'true');
    $('title-screen').inert = true;
    this.titleParticles.stop();
    $('world-map').hidden = false;
    this.worldMapParticles = new TitleParticles($('world-map-particles'), $('world-map'), 'world');
    $('map-start').focus({ preventScroll: true });
  }

  _backToTitle() {
    if (this.phase !== 'world-map') return;
    this.worldMapParticles?.stop();
    $('world-map').hidden = true;
    this.phase = 'ready';
    $('title-screen').classList.remove('departing');
    $('title-screen').removeAttribute('aria-hidden');
    $('title-screen').inert = false;
    this.titleParticles = new TitleParticles($('title-particles'), $('title-screen'));
    this._playTitleMusic();
    $('title-play').focus({ preventScroll: true });
  }

  _beginIntro() {
    if (!this.ready || this.phase !== 'world-map') return;
    if (this.isTouchDevice) this._requestMobileLandscape();
    this.phase = 'intro';
    this.worldMapParticles?.stop();
    $('world-map').hidden = true;
    this.audio.prepare();
    $('intro-overlay').hidden = false;
    const video = $('intro-video');
    this.titleMusic.pause();
    this.titleMusic.currentTime = 0;
    clearInterval(this.introCutoffTimer);
    cancelAnimationFrame(this.introFadeFrame);
    this.introFadeStarted = false;
    $('intro-overlay').classList.remove('is-fading');
    $('intro-skip').disabled = false;
    this.introUnavailable = false;
    video.muted = this.audio.muted;
    video.volume = 1;
    video.currentTime = 0;
    this._playIntroVideo();
  }

  _playIntroVideo() {
    if (this.phase !== 'intro') return;
    const video = $('intro-video');
    $('intro-fallback').hidden = true;
    video.play().then(() => {
      if (this.phase !== 'intro') return;
      clearInterval(this.introCutoffTimer);
      this.introCutoffTimer = setInterval(() => {
        if (this.phase !== 'intro') { clearInterval(this.introCutoffTimer); return; }
        if (!video.paused && video.currentTime >= this.introCutoffSeconds) this._finishIntro();
      }, 40);
    }).catch(error => {
      if (this.phase !== 'intro') return;
      const unavailable = !!video.error || error.name === 'NotSupportedError';
      this.introUnavailable = unavailable;
      $('intro-message').textContent = unavailable ? 'No se pudo reproducir la introducción.' : 'Pulsa para reproducir la introducción.';
      $('intro-continue').textContent = unavailable ? 'CONTINUAR AL JUEGO' : 'REPRODUCIR INTRODUCCIÓN';
      $('intro-fallback').hidden = false;
      $('intro-continue').focus({ preventScroll: true });
    });
  }

  _finishIntro() {
    if (this.phase !== 'intro' || this.introFadeStarted) return;
    this.introFadeStarted = true;
    clearInterval(this.introCutoffTimer);
    $('intro-skip').disabled = true;
    const video = $('intro-video');
    $('intro-fallback').hidden = true;
    $('intro-overlay').classList.add('is-fading');
    const startVolume = video.muted ? 0 : video.volume;
    const startedAt = performance.now();
    const fade = now => {
      if (this.phase !== 'intro') { this.introFadeStarted = false; return; }
      const progress = Math.min(1, (now - startedAt) / this.introFadeDuration);
      if (!video.muted) video.volume = startVolume * (1 - progress);
      if (progress < 1) {
        this.introFadeFrame = requestAnimationFrame(fade);
        return;
      }
      video.volume = 0;
      video.pause();
      video.currentTime = 0;
      this.introRevealPending = true;
      this.start();
    };
    this.introFadeFrame = requestAnimationFrame(fade);
  }

  start() {
    if (!this.ready) return;
    this.phase = 'playing';
    $('game-root').scrollTop = 0;
    $('game-root').scrollLeft = 0;
    $('title-screen').classList.add('departing');
    $('title-screen').setAttribute('aria-hidden', 'true');
    $('title-screen').inert = true;
    this.titleParticles.stop();
    document.body.classList.remove('at-title');
    this.cameraCtrl.enabled = true;
    this.accumulator = 0;
    this._clearInput();
    $('game-menu').hidden = true;
    this.audio.setPaused?.(false);
    this.audio.unlock?.();
    this.canvas.focus({ preventScroll: true });
    this._publishDiagnostics();
  }

  pause() {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.cameraCtrl.enabled = false;
    this._clearInput();
    this.audio.setPaused?.(true);
    this._showMenu('paused');
    this._publishDiagnostics();
  }

  restart() {
    if (!this.ready) return;
    this.fx.reset?.();
    this.hud.reset?.();
    this.enemyManager.reset?.(this.mapScene);
    this.player.reset?.(SPAWN.clone());
    const g = this.mapScene.sampleGround(SPAWN.x, SPAWN.z);
    if (g.valid) this.player.position.y = g.height;
    this.mapScene.reset?.(this.player.position);
    this.cameraCtrl.reset?.(this.player);
    this.lockedEnemy = null;
    this.activeTeleporter = null;
    this.hud.zoneOverride = false;
    this.hitStop = this.teleportCooldown = this.accumulator = this.elapsed = 0;
    this.killCount = this.seals = 0;
    this.victoryShown = false;
    this._updateObjective();
    this.audio.reset?.();
    this.start();
  }

  _showMenu(kind) {
    const content = {
      ready: ['LA CIUDADELA TE ESPERA', 'Rompe los tres sellos', 'Derrota a los guardianes del Umbral, del Puente Axial y del Santuario. Lee sus ataques, esquiva y encadena tu espada.', 'Entrar en la Ciudadela'],
      paused: ['UN INSTANTE DE CALMA', 'Incursión en pausa', 'Ajusta el sonido o la calidad. Tu partida te espera.', 'Continuar'],
      dead: ['EL ABISMO RECLAMA', 'Aún no es el final', 'Esquiva cuando el guardián alce su arma y ataca durante su recuperación.', 'Volver a intentarlo'],
      won: ['LOS TRES SELLOS HAN CAÍDO', 'La Ciudadela es tuya', 'Has silenciado a los tres guardianes. Puedes seguir explorando sus islas y pasajes.', 'Seguir explorando'],
    }[kind];
    $('menu-eyebrow').textContent = content[0];
    $('menu-title').textContent = content[1];
    $('menu-description').textContent = content[2];
    $('menu-primary').textContent = content[3];
    $('menu-restart').hidden = kind === 'ready' || kind === 'dead';
    $('game-menu').hidden = false;
    $('menu-primary').focus({ preventScroll: true });
  }

  notice(message, seconds = 3.5) {
    $('game-notice').textContent = message;
    $('game-notice').classList.add('visible');
    this.noticeTime = seconds;
  }

  _updateObjective() {
    const objectives = this.enemyManager?.enemies.filter(e => e.objective) ?? [];
    const next = objectives.find(e => !e.dead);
    const complete = objectives.filter(e => e.dead).length;
    this.seals = complete;
    $('objective-count').textContent = `${complete} / 3`;
    $('objective-label').textContent = next ? `Sello del ${next.objectiveName || next.name}` : 'Sellos liberados';
    document.querySelectorAll('.seal-pip').forEach((el, i) => el.classList.toggle('complete', i < complete));
    if (this.seals === 3 && !this.victoryShown) {
      this.victoryShown = true;
      this.phase = 'won';
      this.cameraCtrl.enabled = false;
      this._clearInput();
      this.audio.playLink();
      this._showMenu('won');
    }
  }

  executeCommand(cmd) {
    if (!this.ready || this.player.hp <= 0) return false;
    if (this.phase === 'won') this.start();
    if (this.phase !== 'playing') return false;
    this.audio.unlock?.();
    // Aim assistance never takes ownership of the free camera.
    let target = this.lockedEnemy;
    if (!target || target.dead || target.position.distanceTo(this.player.position) > 26) {
      target = this.enemyManager?.getClosestTarget(this.player.position, cmd === 'attack' ? 9.5 : 26) || null;
    }
    let accepted = false;
    switch (cmd) {
      case 'attack':
        this.hud.selectCommand(0, false);
        accepted = this.player.triggerAttack(target);
        if (accepted && target) this.hud.setCombatTarget?.(target, 6.5);
        break;
      case 'magic':
        this.hud.selectCommand(1, false);
        accepted = this.player.triggerCast(target, this.cameraCtrl.getForwardXZ());
        if (accepted && target) this.hud.setCombatTarget?.(target, 6.5);
        if (accepted) this.hud.triggerCutIn?.('LLAMA ABISAL CARMESÍ');
        break;
      case 'items':
        this.hud.selectCommand(2, false);
        accepted = this.player.useItem((pos, text, style) => this.hud.spawnFloatingText(pos, text, style, 'ÉTER'));
        break;
      case 'link':
        this.hud.selectCommand(3, false);
        accepted = this.player.useLink(this.enemyManager.enemies, (enemy, damage, style, tag) => this._handleDamageEnemy(enemy, damage, style, tag));
        if (accepted) {
          this.hud.pulseCompanion();
          this.notice('Lyra · Tempestad astral', 1.6);
        }
        break;
      case 'limit':
        accepted = this.player.useLimit(this.enemyManager.enemies, target, (enemy, damage, style, tag) => this._handleDamageEnemy(enemy, damage, style, tag), title => this.hud.triggerCutIn(title));
        if (!accepted && this.player.limitGauge < 100) this.notice('El Límite se carga al combatir.', 1.8);
        break;
      case 'dodge': {
        const input = this._getMovementInput();
        const direction = this.cameraCtrl.getForwardXZ().multiplyScalar(input.forward).addScaledVector(this.cameraCtrl.getRightXZ(), input.right);
        if (direction.lengthSq() < 0.01) direction.copy(this.player.getForward()).negate();
        accepted = this.player.triggerDodge(direction.normalize());
        break;
      }
      case 'jump': accepted = this.player.triggerJump(); break;
      case 'interact': accepted = this._useTeleporter(); break;
      case 'lock': this._cycleLockOn(); return true;
    }
    return Boolean(accepted);
  }

  _handleDamageEnemy(enemy, damage, style = 'slash', tag = '') {
    if (this.phase !== 'playing' || !enemy || enemy.dead) return;
    this.enemyManager.damageEnemy(enemy, damage, style, tag);
    if (style === 'nix') this.hud.pulseCompanion?.('nix');
    else this.hud.setCombatTarget?.(enemy, 7.0);
    this.hud.spawnFloatingText(enemy.position, damage, style, tag);
    if (style !== 'nix') {
      this.hitStop = Math.max(this.hitStop, style === 'normal' || style === 'slash' ? 0.028 : 0.045);
      if (!this.reducedMotion) this.cameraCtrl.addShake(style === 'magic' ? 0.12 : 0.085);
    }
    if (enemy.dead) {
      this.killCount++;
      this.player.mp = Math.min(this.player.maxMp, this.player.mp + 24);
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 150);
      this.player.limitGauge = Math.min(100, this.player.limitGauge + 8);
      if (this.lockedEnemy === enemy) this.lockedEnemy = null;
      if (enemy.objective) this.notice(`Sello liberado · ${enemy.objectiveName}`, 3);
      this._updateObjective();
    }
  }

  _bindInputs() {
    addEventListener('keydown', e => {
      const buttonFocused = !!e.target.closest?.('button');
      const gameKey = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight'].includes(e.code) || (e.code === 'Tab' && this.phase === 'playing');
      if (gameKey && !(e.code === 'Space' && buttonFocused)) e.preventDefault();
      if (e.code === 'Escape') { e.preventDefault(); if (this.phase === 'playing') this.pause(); else if (this.phase === 'paused') this.start(); else if (this.phase === 'world-map') this._backToTitle(); return; }
      if (e.code === 'KeyM' && !e.repeat) { this._toggleMute(); return; }
      if (e.code === 'KeyB' && !e.repeat) { $('controls-bar').classList.toggle('expanded'); return; }
      if (this.phase === 'world-map' && e.code === 'Tab') {
        const buttons = [...$('world-map').querySelectorAll('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement);
        e.preventDefault();
        buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
        return;
      }
      if (this.phase === 'ready') {
        if (buttonFocused && e.target.id !== 'title-play') return;
        if ((e.code === 'Enter' || e.code === 'Space') && this.ready) { e.preventDefault(); this._openWorldMap(); }
        return;
      }
      if (this.phase === 'won') this.start();
      if (this.phase !== 'playing') return;
      this.keys.add(e.code);
      if (e.repeat) return;
      const bindings = { Space: 'jump', KeyJ: 'attack', KeyK: 'magic', Digit1: 'items', KeyH: 'items', Digit2: 'link', KeyL: 'link', KeyQ: 'limit', KeyF: 'limit', KeyX: 'dodge', ControlLeft: 'dodge', ControlRight: 'dodge', KeyE: 'interact', Tab: 'lock' };
      if (bindings[e.code]) this.executeCommand(bindings[e.code]);
      else if (e.code === 'KeyV') {
        const name = this.cameraCtrl.cyclePreset();
        this.hud.zoneOverride = this.cameraCtrl.presetIndex > 0;
        this.notice(name, 1.6);
      } else if (e.code === 'Enter') this.executeCommand(this.hud.getSelectedCommand());
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this._clearInput(); });
    let rightPress = null;
    this.canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      if (this.phase === 'won') this.start();
      this.canvas.focus({ preventScroll: true });
      if (e.button === 0) this.executeCommand('attack');
      if (e.button === 2) rightPress = { x: e.clientX, y: e.clientY, time: performance.now(), moved: false };
    });
    addEventListener('pointermove', e => { if (rightPress && Math.hypot(e.clientX - rightPress.x, e.clientY - rightPress.y) > 8) rightPress.moved = true; });
    addEventListener('pointerup', e => {
      if (e.button === 2 && rightPress) {
        if (!rightPress.moved && performance.now() - rightPress.time < 450) this.executeCommand('magic');
        rightPress = null;
      }
    });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  _bindInterface() {
    $('title-play').addEventListener('click', () => this._openWorldMap());
    $('rotate-start').addEventListener('click', () => this._requestMobileLandscape());
    $('title-sound').addEventListener('click', () => {
      if (this.titleMusicBlocked && !this.audio.muted) this._playTitleMusic(true);
      else this._toggleMute();
    });
    $('map-start').addEventListener('click', () => this._beginIntro());
    $('map-back').addEventListener('click', () => this._backToTitle());
    $('map-sound').addEventListener('click', () => {
      if (this.titleMusicBlocked && !this.audio.muted) this._playTitleMusic(true);
      else this._toggleMute();
    });
    const fullscreen = $('fullscreen-button');
    fullscreen.hidden = !this.isTouchDevice || !document.fullscreenEnabled;
    fullscreen.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else {
          await $('game-root').requestFullscreen();
          if (screen.orientation?.lock) await screen.orientation.lock('landscape').catch(() => {});
        }
      } catch { /* Fullscreen is optional and unsupported on some phones. */ }
    });
    document.addEventListener('fullscreenchange', () => {
      fullscreen.setAttribute('aria-label', document.fullscreenElement ? 'Salir de pantalla completa' : 'Activar pantalla completa');
      fullscreen.setAttribute('aria-pressed', String(!!document.fullscreenElement));
    });
    document.querySelectorAll('.world-map-pin').forEach(pin => pin.addEventListener('click', () => {
      document.querySelectorAll('.world-map-pin').forEach(item => {
        const selected = item === pin;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      $('map-region-name').textContent = pin.dataset.name;
      $('map-region-description').textContent = pin.dataset.description;
    }));
    document.addEventListener('click', e => {
      const button = e.target.closest?.('button');
      if (button && !button.disabled) this.audio.playUi('click', true);
    });
    document.addEventListener('pointerover', e => {
      const button = e.target.closest?.('button');
      if (button && !button.disabled && !button.contains(e.relatedTarget)) this.audio.playUi('hover');
    });
    document.addEventListener('focusin', e => {
      if (e.target.closest?.('button')) this.audio.playUi('hover');
    });
    $('intro-video').addEventListener('ended', () => this._finishIntro());
    $('intro-skip').addEventListener('click', () => this._finishIntro());
    $('intro-video').addEventListener('error', () => {
      if (this.phase !== 'intro') return;
      this.introUnavailable = true;
      $('intro-message').textContent = 'No se pudo reproducir la introducción.';
      $('intro-continue').textContent = 'CONTINUAR AL JUEGO';
      $('intro-fallback').hidden = false;
    });
    $('intro-continue').addEventListener('click', () => {
      if (this.introUnavailable || $('intro-video').error) this._finishIntro();
      else this._playIntroVideo();
    });
    $('menu-primary').addEventListener('click', () => this.phase === 'dead' ? this.restart() : this.start());
    $('menu-restart').addEventListener('click', () => { this.victoryShown = false; this.restart(); });
    $('pause-button').addEventListener('click', () => { if (this.phase === 'playing') this.pause(); else if (this.phase === 'paused') this.start(); });
    $('sound-button').addEventListener('click', () => this._toggleMute());
    $('menu-volume').addEventListener('input', e => this.audio.setVolume?.(Number(e.target.value)));
    $('quality-select').value = this.quality;
    $('quality-select').addEventListener('change', e => this._setQuality(e.target.value));
    $('motion-check').checked = this.reducedMotion;
    $('motion-check').addEventListener('change', e => { this.reducedMotion = e.target.checked; document.documentElement.classList.toggle('reduced-motion', this.reducedMotion); });
    document.querySelectorAll('[data-touch-cmd]').forEach(button => {
      button.addEventListener('pointerdown', e => {
        if (this.phase !== 'playing' || button.disabled) return;
        e.preventDefault(); e.stopPropagation();
        button.classList.add('pressed');
        button.setPointerCapture(e.pointerId);
        this.executeCommand(button.dataset.touchCmd);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => button.classList.remove('pressed'));
      button.addEventListener('click', e => {
        if (e.detail === 0 && !button.disabled) { e.preventDefault(); this.executeCommand(button.dataset.touchCmd); }
      });
    });
    const toggleSprint = () => {
      if (this.phase !== 'playing') return;
      this.touchSprint = !this.touchSprint;
      $('touch-sprint').setAttribute('aria-pressed', String(this.touchSprint));
    };
    $('touch-sprint').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); toggleSprint(); });
    $('touch-sprint').addEventListener('click', e => { if (e.detail === 0) toggleSprint(); });
  }

  async _requestMobileLandscape() {
    if (!this.isTouchDevice) return;
    try {
      const root = $('game-root');
      if (!document.fullscreenElement && document.fullscreenEnabled) await root.requestFullscreen();
      if (screen.orientation?.lock) await screen.orientation.lock('landscape');
    } catch { /* Some mobile browsers only allow rotation by physically turning the device. */ }
    this._resize();
    this._syncMobileOrientation();
  }

  _bindTouch() {
    const pad = $('move-pad'), stick = $('move-stick');
    let pointerId = null;
    const move = e => {
      if (pointerId !== e.pointerId) return;
      const rect = pad.getBoundingClientRect();
      let dx = (e.clientX - rect.left - rect.width / 2) / (rect.width * 0.34);
      let dy = (e.clientY - rect.top - rect.height / 2) / (rect.height * 0.34);
      const length = Math.hypot(dx, dy);
      if (length > 1) { dx /= length; dy /= length; }
      this.touchMove.right = Math.abs(dx) > 0.12 ? dx : 0;
      this.touchMove.forward = Math.abs(dy) > 0.12 ? -dy : 0;
      const range = rect.width * .27;
      stick.style.transform = `translate(${dx * range}px, ${dy * range}px)`;
    };
    const release = e => { if (pointerId === null || e?.pointerId === pointerId) { pointerId = null; this.touchMove = { forward: 0, right: 0 }; stick.style.transform = ''; } };
    pad.addEventListener('pointerdown', e => { if (this.phase !== 'playing' || pointerId !== null) return; e.preventDefault(); pointerId = e.pointerId; pad.setPointerCapture(pointerId); move(e); });
    pad.addEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(type, release);
    addEventListener('blur', () => release());
    // Touching the scene never rotates the mobile camera; PC mouse controls remain unchanged.
    this.canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') e.preventDefault(); }, { passive: false });
  }

  _syncMobileOrientation() {
    if (!this.isTouchDevice) return;
    const portrait = innerHeight > innerWidth;
    const video = $('intro-video');
    if (portrait && this.phase === 'intro' && !video.paused) {
      this.orientationPausedVideo = true;
      video.pause();
    } else if (!portrait && this.orientationPausedVideo && this.phase === 'intro') {
      this.orientationPausedVideo = false;
      this._playIntroVideo();
    }
    if (portrait && this.phase === 'playing') this.pause();
  }

  _clearInput() {
    this.keys.clear();
    this.touchMove.forward = this.touchMove.right = 0;
    this.touchSprint = false;
    $('touch-sprint')?.setAttribute('aria-pressed', 'false');
    document.querySelectorAll('.touch-actions .pressed').forEach(button => button.classList.remove('pressed'));
    const stick = $('move-stick'); if (stick) stick.style.transform = '';
    this.cameraCtrl.dragging = false;
  }

  _toggleMute() {
    const muted = this.audio.toggleMute?.() ?? false;
    this.titleMusic.muted = muted;
    $('intro-video').muted = muted;
    if (muted) this.titleMusic.pause();
    else if (['loading', 'ready', 'world-map'].includes(this.phase)) this._playTitleMusic();
    $('sound-button').textContent = muted ? 'SONIDO OFF' : 'SONIDO ON';
    $('sound-button').setAttribute('aria-pressed', String(!muted));
    $('title-sound').textContent = muted ? 'SONIDO OFF' : 'SONIDO ON';
    $('title-sound').setAttribute('aria-pressed', String(!muted));
    $('map-sound').textContent = muted ? 'SONIDO OFF' : 'SONIDO ON';
    $('map-sound').setAttribute('aria-pressed', String(!muted));
  }

  _setQuality(quality) {
    this.quality = quality;
    const dpr = quality === 'high' ? 1.5 : 1.0;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, dpr));
    this.renderer.shadowMap.enabled = quality !== 'performance';
    this.bloomEffect.intensity = quality === 'performance' ? 0.8 : 1.05;
    this.mapScene?.atmosphere?.setQuality(quality);
    this._resize();
  }

  _resize() {
    const root = $('game-root');
    const width = root.clientWidth || innerWidth, height = root.clientHeight || innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.cameraCtrl?.resize(width, height);
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  _getMovementInput() {
    const fwd =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) +
      this.touchMove.forward;
    const rgt =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) +
      this.touchMove.right;
    return {
      forward: THREE.MathUtils.clamp(fwd, -1, 1),
      right: THREE.MathUtils.clamp(rgt, -1, 1),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint,
    };
  }

  _cycleLockOn() {
    const alive = this.enemyManager.enemies.filter(e => !e.dead && e.position.distanceTo(this.player.position) < 28)
      .sort((a, b) => a.position.distanceToSquared(this.player.position) - b.position.distanceToSquared(this.player.position));
    const index = alive.indexOf(this.lockedEnemy);
    this.lockedEnemy = alive[index + 1] ?? null;
    this.audio.playMenu();
    this.notice(this.lockedEnemy ? `Blanco fijado · ${this.lockedEnemy.name}` : 'Cámara libre', 1.2);
  }

  _findNearbyTeleporter() {
    return this.mapScene.portals.find(p => p.pos.distanceTo(this.player.position) < 3) ?? null;
  }

  _useTeleporter() {
    if (this.teleportCooldown > 0 || !this.player.grounded) return false;
    const portal = this._findNearbyTeleporter(), dest = portal && this.mapScene.portals[portal.destIdx];
    if (!dest) return false;
    const ground = this.mapScene.sampleGround(dest.pos.x, dest.pos.z);
    if (!ground.valid) { this.notice('Este portal todavía no tiene un destino seguro.'); return false; }
    this.fx.spawnShockwave(this.player.position, 0x9a83ff, 2, 0.4);
    this.player.position.copy(dest.pos); this.player.position.y = ground.height;
    this.player.lastSafePosition?.copy(this.player.position);
    this.player.groundHeight = ground.height;
    this.player.velocity.set(0, 0, 0); this.player.verticalVel = 0;
    this.lockedEnemy = null;
    this.cameraCtrl.reset?.(this.player);
    this.teleportCooldown = 1;
    this.fx.reset?.();
    this.fx.spawnShockwave(this.player.position, 0x9a83ff, 2, 0.4);
    this.audio.playLink();
    this.notice(dest.name, 2);
    return true;
  }

  _simulate(dt) {
    this.elapsed += dt;
    this.teleportCooldown = Math.max(0, this.teleportCooldown - dt);
    const input = this._getMovementInput();
    if (this.lockedEnemy && (this.lockedEnemy.dead || this.lockedEnemy.position.distanceTo(this.player.position) > 32)) this.lockedEnemy = null;
    const enemies = this.enemyManager.enemies;
    this.player.update(dt, this.elapsed, input, this.cameraCtrl, this.mapScene, enemies, this.lockedEnemy, {
      onDamageEnemy: (enemy, damage, style, tag) => this._handleDamageEnemy(enemy, damage, style, tag),
    });
    this.enemyManager.update(dt, this.elapsed, this.player, this.mapScene, { onPlayerDamaged: damage => {
      this.audio.playHit();
      if (!this.reducedMotion) this.cameraCtrl.addShake(0.14);
      this.hud.spawnFloatingText(this.player.position, `−${damage}`, 'damage', '');
      this.hud.showDamage?.();
    } });
    this.player.root.updateMatrixWorld(true);
    this.fx.update(dt, this.elapsed, enemies, this.mapScene);
    this.mapScene.update(dt, this.elapsed, this.player.position);
    this.activeTeleporter = this._findNearbyTeleporter();
    if (this.player.hp <= 0 && this.phase === 'playing') {
      this.phase = 'dead'; this.cameraCtrl.enabled = false; this._clearInput(); this.audio.setPaused?.(true); this._showMenu('dead');
    }
  }

  _animate(time) {
    requestAnimationFrame(t => this._animate(t));
    const wallDt = this.lastFrameTime ? Math.min(0.1, (time - this.lastFrameTime) / 1000) : STEP;
    this.lastFrameTime = time;
    if (this.phase === 'ready' || this.phase === 'world-map' || this.phase === 'intro') return;
    this.frame++;
    this.frameTimes.push(wallDt * 1000); if (this.frameTimes.length > 120) this.frameTimes.shift();
    if (this.phase === 'playing' && !this.frozenForScreenshot) {
      this.hitStop = Math.max(0, this.hitStop - wallDt);
      this.accumulator = Math.min(this.accumulator + (this.hitStop > 0 ? 0 : wallDt), STEP * 5);
      while (this.accumulator >= STEP && this.phase === 'playing') { this._simulate(STEP); this.accumulator -= STEP; }
      if (this.reducedMotion || this.isTouchDevice) this.cameraCtrl.trauma = 0;
      this.cameraCtrl.update(wallDt, this.elapsed, this.player, this.lockedEnemy, this.mapScene);
    } else {
      this.accumulator = 0;
      if (this.phase === 'dead' && !this.frozenForScreenshot) {
        if (this.player.updateDeath) this.player.updateDeath(wallDt);
        else this.player.mixer?.update(wallDt);
      }
    }
    if (!this.frozenForScreenshot) this.hud.update(this.phase === 'playing' ? wallDt : 0, this.player, this.mapScene, this.enemyManager.enemies, this.lockedEnemy, this.activeTeleporter);
    if (this.noticeTime > 0 && this.phase === 'playing') { this.noticeTime -= wallDt; if (this.noticeTime <= 0) $('game-notice').classList.remove('visible'); }
    this.hud.updateAbilities?.(this.player);
    this.mapScene.atmosphere?.update(this.player.position, this.camera, this.reducedMotion);
    if (this.fx.sparkPoints?.material.uniforms.uIsoScale) this.fx.sparkPoints.material.uniforms.uIsoScale.value = this.canvas.clientHeight / (this.camera.top - this.camera.bottom);
    this.renderer.info.reset();
    this.composer.render(wallDt);
    if (this.introRevealPending) {
      this.introRevealPending = false;
      $('intro-overlay').hidden = true;
      $('intro-overlay').classList.remove('is-fading');
      this.introFadeStarted = false;
    }
    this._publishDiagnostics();
  }

  _publishDiagnostics() {
    const info = this.renderer.info;
    this.diagnostics = {
      frame: this.frame, phase: this.phase, elapsed: this.elapsed, score: this.seals, kills: this.killCount,
      player: { position: this.player.position.toArray(), velocity: this.player.velocity.toArray(), state: this.player.state, grounded: this.player.grounded, hp: this.player.hp, mp: this.player.mp },
      renderer: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, dpr: this.renderer.getPixelRatio() },
      frameMs: this.frameTimes.reduce((a, b) => a + b, 0) / (this.frameTimes.length || 1),
      physics: { engine: 'custom heightfield', timestep: STEP, maxSubsteps: 5, bodies: 1 + (this.enemyManager?.enemies.filter(e => !e.dead).length || 0), radius: 0.27 },
      quality: this.quality,
    };
    window.__THREE_GAME_DIAGNOSTICS__ = this.diagnostics;
  }

  _installDiagnostics() {
    if (!new URLSearchParams(location.search).has('qa')) return;
    let seed = 12345;
    const seeded = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    Math.random = seeded;
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: value => { seed = value >>> 0; },
      setPausedForScreenshot: paused => { this.frozenForScreenshot = paused; },
      setReducedMotion: enabled => { this.reducedMotion = enabled; this.cameraCtrl.trauma = 0; },
      hideDebugUi: () => {},
      setState: name => {
        this.restart();
        if (name === 'pause') this.pause();
        else if (name === 'fail') { this.player.hp = 0; this.player.playState('Death'); this.phase = 'dead'; this._showMenu('dead'); }
        else if (name === 'overview') { this.cameraCtrl.presetIndex = 2; this.cameraCtrl.update(10, 0, this.player, null, this.mapScene); }
        this.mapScene.update(10, 0, this.player.position);
        this.player.root.updateMatrixWorld(true);
        this.cameraCtrl.trauma = 0;
        $('game-notice').classList.remove('visible');
        this.activeTeleporter = this._findNearbyTeleporter();
        this.hud.update(0, this.player, this.mapScene, this.enemyManager.enemies, null, this.activeTeleporter);
      },
    };
  }
}
