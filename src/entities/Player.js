import * as THREE from 'three';
import { assetUrl } from '../assetUrl.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const UP = new THREE.Vector3(0, 1, 0);
const WALK_SPEED = 4.5;
const RUN_SPEED = 8.4;
const SPRINT_SPEED = 12.6;
const GRAVITY = 22.0;

const ATTACKS = {
  Attack1: { speed: 1.26, reach: 3.8, damage: 310, lunge: 2.1, arc: -0.25 },
  Attack2: { speed: 1.3, reach: 4.1, damage: 390, lunge: 2.4, arc: -0.25 },
  Attack3: { speed: 1.22, reach: 4.6, damage: 620, lunge: 3.1, arc: -0.35 },
};

const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export class Player {
  constructor(scene, fxManager, audio) {
    this.scene = scene;
    this.fx = fxManager;
    this.audio = audio;

    this.root = new THREE.Group();
    this.root.name = 'AerenPlayer';
    this.position = this.root.position;
    this.position.set(0, 8.24, 79.8);
    scene.add(this.root);

    this.level = 41;
    this.maxHp = 3560;
    this.maxMp = 240;
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.limitGauge = 85;
    this.items = 5;

    this.velocity = new THREE.Vector3();
    this.dodgeDirection = new THREE.Vector3();
    this.facingYaw = Math.PI;
    this.isMoving = false;
    this.isSprinting = false;
    this.grounded = true;
    this.verticalVel = 0;
    this.groundHeight = 8.24;
    this.lastSafePosition = this.position.clone();

    this.invulnerable = 0;
    this.dodgeCooldown = 0;
    this.linkCooldown = 0;
    this.itemCooldown = 0;
    this.hitStop = 0;
    this.generation = 0;

    this.mixer = null;
    this.actions = {};
    this.meta = null;
    this.fxNodes = {};
    this.currentAction = null;
    this.state = 'Idle';
    this.stateTime = 0;
    this.stateScale = 1;
    this.queuedCombo = false;
    this.eventFired = {};
    this.limitTargets = null;
    this.actionTarget = null;

    this.shaderTime = { value: 0 };
    this.swordLight = new THREE.PointLight(0xff1744, 2.8, 5.5, 1.6);
    this.swordLight.position.set(0, 1.1, 0);
    this.root.add(this.swordLight);

    // Soft grounding contact shadow under Aeren's boots so he sits solidly on carved stone
    const sc = document.createElement('canvas');
    sc.width = 64;
    sc.height = 64;
    const sctx = sc.getContext('2d');
    const sgrad = sctx.createRadialGradient(32, 32, 3, 32, 32, 30);
    sgrad.addColorStop(0, 'rgba(3, 1, 8, 0.72)');
    sgrad.addColorStop(0.55, 'rgba(5, 2, 12, 0.34)');
    sgrad.addColorStop(1, 'rgba(5, 2, 12, 0)');
    sctx.fillStyle = sgrad;
    sctx.fillRect(0, 0, 64, 64);
    this.contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 24),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false })
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.015;
    this.root.add(this.contactShadow);

    this._move = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._base = new THREE.Vector3();
    this._tip = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._enemies = [];
    this._footMeshes = [];
    this._handPosition = new THREE.Vector3();
    this._swordDesired = new THREE.Vector3();
    this._handCorrection = new THREE.Quaternion();
    this._parentRotation = new THREE.Quaternion();
    this._localCorrection = new THREE.Quaternion();
  }

  async load() {
    const [gltf, metaRes] = await Promise.all([
      new GLTFLoader().loadAsync(assetUrl('models/aeren-optimized.glb')),
      fetch(assetUrl('models/aeren_meta.json')),
    ]);
    if (!metaRes.ok) throw new Error('No se pudo cargar el rig de Aeren');
    this.meta = await metaRes.json();
    this.model = gltf.scene;
    this.root.add(this.model);

    this.model.traverse((obj) => {
      if (this.meta.fx_nodes[obj.name]) this.fxNodes[obj.name] = obj;
      if (obj.name === 'Hand_R') this.handBone = obj;
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;

      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (!mat) continue;
        mat.roughness = 0.44;
        mat.metalness = 0.58;
        mat.envMapIntensity = 1.22;
        if (mat.normalScale) mat.normalScale.setScalar(1.0);
        if (mat.map) mat.map.anisotropy = 8;

        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uAerenTime = this.shaderTime;
          shader.fragmentShader =
            'uniform float uAerenTime;\n' +
            shader.fragmentShader.replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
               float redMark = smoothstep(1.5, 3.1, diffuseColor.r / (diffuseColor.g + diffuseColor.b + 0.02));
               redMark *= smoothstep(0.14, 0.40, diffuseColor.r);
               totalEmissiveRadiance += vec3(1.65, 0.04, 0.16) * redMark * (0.85 + 0.25 * sin(uAerenTime * 3.8));`
            );
        };
        mat.customProgramCacheKey = () => 'aeren-crimson-albedo-emission-v2';
      }

      if (obj.isSkinnedMesh) {
        obj.frustumCulled = false;
        obj.normalizeSkinWeights();
        const position = obj.geometry.attributes.position;
        const candidates = [];
        for (let i = 0; i < position.count; i++) {
          if (position.getY(i) < 0.075 && Math.abs(position.getX(i)) < 0.5) candidates.push(i);
        }
        if (candidates.length) {
          const stride = Math.max(1, Math.ceil(candidates.length / 96));
          this._footMeshes.push({
            mesh: obj,
            indices: candidates.filter((_, i) => i % stride === 0),
          });
        }
      }
    });

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const act = this.mixer.clipAction(clip);
      const looping = this.meta.clips[clip.name]?.loop;
      act.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
      act.clampWhenFinished = !looping;
      this.actions[clip.name] = act;
    }

    this.playState('Idle', 0);
    this.mixer.update(0);
    this.root.rotation.y = this.facingYaw;
    return this;
  }

  reset(position = new THREE.Vector3(0, 8.24, 79.8)) {
    this.generation++;
    this.position.copy(position);
    this.lastSafePosition.copy(position);
    this.groundHeight = position.y;
    this.facingYaw = Math.PI;
    this.root.rotation.y = this.facingYaw;
    this.velocity.set(0, 0, 0);
    this.verticalVel = 0;
    this.grounded = true;
    this.isMoving = false;
    this.isSprinting = false;
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.limitGauge = 85;
    this.items = 5;
    this.invulnerable = 1.0;
    this.dodgeCooldown = this.linkCooldown = this.itemCooldown = this.hitStop = 0;
    this.queuedCombo = false;
    this.limitTargets = null;
    this.actionTarget = null;
    this.mixer?.stopAllAction();
    this.currentAction = null;
    this.playState('Idle', 0);
    this.mixer?.update(0);
    this.swordLight.intensity = 2.8;
    if (this.model) this.model.position.y = 0;
  }

  playState(name, fade = 0.1, timeScale = 1) {
    const next = this.actions[name === 'Limit' ? 'Attack3' : name];
    if (!next) return false;
    this.state = name;
    this.stateTime = 0;
    this.stateScale = timeScale;
    this.eventFired = {};
    next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1);
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.fadeOut(fade);
      next.fadeIn(fade);
    } else {
      next.stopFading();
    }
    next.play();
    this.currentAction = next;
    return true;
  }

  getForward() {
    return new THREE.Vector3(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
  }

  faceToward(target, instant = false, dt = 1 / 60) {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    if (dx * dx + dz * dz < 0.0001) return;
    this.facingYaw +=
      angleDelta(this.facingYaw, Math.atan2(dx, dz)) * (instant ? 1 : 1 - Math.exp(-dt * 22));
    this.root.rotation.y = this.facingYaw;
  }

  triggerAttack(target) {
    if (this.state === 'Death' || this.state === 'Limit') return false;

    // Buffer next combo hit if already swinging
    if (this.state === 'Attack1' || this.state === 'Attack2') {
      this.queuedCombo = true;
      if (target && !target.dead) this.actionTarget = target;
      return true;
    }
    if (this.state === 'Attack3' && this.stateTime < this._duration() * 0.72) {
      return false;
    }

    if (target && !target.dead && target.position.distanceTo(this.position) < 9.5) {
      this.faceToward(target.position, true);
    }
    this.actionTarget = target;
    this.queuedCombo = false;
    this.playState('Attack1', 0.06, ATTACKS.Attack1.speed);
    this.audio?.playSwing(1);
    return true;
  }

  triggerCast(target, camForward) {
    if (this.state === 'Death' || this.state === 'Limit') return false;
    if (this.state === 'Cast' && this.stateTime < 0.35) return false;

    // Auto-channel abyssal mana if low so the player can always fire red magic
    if (this.mp < 18) {
      this.mp = Math.min(this.maxMp, this.mp + 36);
    }
    this.mp = Math.max(0, this.mp - 18);
    this.actionTarget = target;

    if (target && !target.dead) {
      this.faceToward(target.position, true);
    } else if (camForward) {
      this.facingYaw = Math.atan2(camForward.x, camForward.z);
      this.root.rotation.y = this.facingYaw;
    }

    this.playState('Cast', 0.06, 1.38);
    this.audio?.playSpellCharge();
    if (this.fxNodes.HandL_FX) {
      this.fx.spawnSpellCharge(this.fxNodes.HandL_FX);
    }
    return true;
  }

  triggerDodge(direction) {
    if (this.state === 'Death' || this.state === 'Limit' || this.dodgeCooldown > 0) return false;
    this.dodgeDirection.copy(
      direction && direction.lengthSq() > 0.001 ? direction : this.getForward()
    );
    this.dodgeDirection.y = 0;
    this.dodgeDirection.normalize();
    this.facingYaw = Math.atan2(this.dodgeDirection.x, this.dodgeDirection.z);
    this.root.rotation.y = this.facingYaw;
    this.dodgeCooldown = 0.42;
    this.invulnerable = Math.max(this.invulnerable, 0.45);
    this.playState('Dodge', 0.05, 1.45);
    this.audio?.playDodge();
    this.fx.emitSparks(this.position.clone().addScaledVector(UP, 0.85), 24, {
      color1: 0xb829ff,
      color2: 0xff1e56,
      speed: 7.0,
      size: 1.05,
    });
    return true;
  }

  triggerJump() {
    if (this.state === 'Death' || this.state === 'Limit') return false;
    if (!this.grounded && this.verticalVel > 1.0) return false;
    this.grounded = false;
    this.verticalVel = 8.8;
    this.playState('Jump', 0.06, 1.25);
    this.audio?.playJump();
    this.fx.emitSparks(this.position.clone().addScaledVector(UP, 0.2), 14, {
      color1: 0xc266ff,
      color2: 0xff2a6d,
      speed: 4.5,
      size: 0.9,
    });
    return true;
  }

  useItem(onFloatingText) {
    if (this.state === 'Death') return false;
    if (this.items <= 0) this.items = 3; // Replenish astral ether charges if depleted
    const healHp = Math.min(this.maxHp - this.hp, 1400) || 1400;
    const healMp = Math.min(this.maxMp - this.mp, 110) || 110;
    this.hp = Math.min(this.maxHp, this.hp + 1400);
    this.mp = Math.min(this.maxMp, this.mp + 110);
    this.items = Math.max(1, this.items - 1);
    this.itemCooldown = 0.8;
    this.fx.spawnShockwave(this.position, 0x2eff9b, 3.2, 0.48);
    this.fx.emitSparks(this.position.clone().addScaledVector(UP, 1.0), 40, {
      color1: 0x2eff9b,
      color2: 0xb1f3e5,
      speed: 5.5,
      size: 1.15,
      gravity: -1.5,
    });
    this.audio?.playHeal();
    onFloatingText?.(
      this.position.clone().addScaledVector(UP, 1.9),
      `+${healHp} VIT  +${Math.round(healMp)} MP`,
      'weak'
    );
    return true;
  }

  useLink(enemies, onDamageEnemy) {
    if (this.state === 'Death' || this.state === 'Limit') return false;
    const targets = enemies.filter((e) => !e.dead && e.position.distanceTo(this.position) < 16);
    this.linkCooldown = 4.0;
    this.fx.spawnSupportLinkFX(this.position, targets);
    this.audio?.playLink();
    for (const e of targets) {
      onDamageEnemy(e, 520 + Math.floor(Math.random() * 110), 'weak', 'VÍNCULO ASTRAL');
    }
    return true;
  }

  useLimit(enemies, target, onDamageEnemy, onCutIn) {
    if (this.state === 'Death' || this.state === 'Limit') return false;
    this.limitGauge = 0;
    if (target && !target.dead) this.faceToward(target.position, true);
    this.velocity.set(0, 0, 0);
    this.limitTargets = { enemies, target, onDamageEnemy };
    this.invulnerable = 1.2;
    this.playState('Limit', 0.06, 0.96);
    this.audio?.playLimit();
    onCutIn?.('JUICIO CARMESÍ DEL ABISMO');
    return true;
  }

  takeDamage(amount, onFloatingText) {
    const dodgeIFrames = this.state === 'Dodge' && this.stateTime < 0.44;
    if (
      this.state === 'Death' ||
      this.state === 'Limit' ||
      dodgeIFrames ||
      this.invulnerable > 0 ||
      amount <= 0
    ) {
      return false;
    }
    const applied = Math.min(this.hp, amount);
    this.hp -= applied;
    this.invulnerable = 0.75;
    this.limitGauge = Math.min(100, this.limitGauge + 12);
    // Do not interrupt Aeren's active sword combo or spell cast on light hits (poise/hyperarmor)
    const inActiveAttack = !!ATTACKS[this.state] || this.state === 'Cast';
    if (this.hp <= 0) {
      this.playState('Death', 0.05, 1.1);
    } else if (!inActiveAttack) {
      this.playState('Hit', 0.04, 1.45);
    }
    onFloatingText?.(this.position.clone().addScaledVector(UP, 1.7), `-${applied}`, 'magic');
    return applied;
  }

  _finishAction(input) {
    this.actionTarget = null;
    if (!this.grounded) {
      this.playState('Fall', 0.08);
    } else if (this.isMoving) {
      this.playState('Run', 0.08);
    } else {
      this.playState('Idle', 0.1);
    }
  }

  _duration() {
    return (this.currentAction?.getClip().duration || 0.55) / this.stateScale;
  }

  update(dt, elapsed, input, cameraCtrl, mapScene, enemies, target, callbacks) {
    if (!this.mixer) return;
    target =
      target && !target.dead
        ? target
        : this.actionTarget && !this.actionTarget.dead
          ? this.actionTarget
          : null;
    this._enemies = enemies;
    this.shaderTime.value = elapsed;

    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.linkCooldown = Math.max(0, this.linkCooldown - dt);
    this.itemCooldown = Math.max(0, this.itemCooldown - dt);

    const step = this.hitStop > 0 ? dt * 0.18 : dt;
    this.hitStop = Math.max(0, this.hitStop - dt);
    this.stateTime += step;
    this.mixer.update(step);

    if (this.state === 'Death') {
      this.isMoving = false;
      this.velocity.set(0, 0, 0);
      this._updateSword(false);
      return;
    }

    // Health lost in combat persists until the player heals or earns recovery.
    this.mp = Math.min(this.maxMp, this.mp + dt * 9.0);
    this.limitGauge = Math.min(100, this.limitGauge + dt * 2.5);

    this._move
      .copy(cameraCtrl.getForwardXZ())
      .multiplyScalar(input.forward)
      .addScaledVector(cameraCtrl.getRightXZ(), input.right);
    const inputLength = Math.min(1, this._move.length());
    if (inputLength > 0.001) this._move.normalize();
    this.isMoving = inputLength > 0.04;
    this.isSprinting = this.isMoving && !!input.sprint;

    const attack = ATTACKS[this.state];
    if (attack) {
      const hitTime = (this.meta.clips[this.state]?.events?.hit?.[0] ?? 0.25) / this.stateScale;

      // Magnetic gap-closing lunge toward target or movement direction
      if (this.stateTime < hitTime) {
        if (target && !target.dead && target.position.distanceTo(this.position) < 8.5) {
          this.faceToward(target.position, false, step * 1.4);
          const distToTarget = target.position.distanceTo(this.position);
          if (distToTarget > 1.35) {
            const lungeStep = Math.min(
              distToTarget - 1.25,
              (attack.lunge / Math.max(hitTime, 0.12)) * step
            );
            this._delta.copy(this.getForward()).multiplyScalar(lungeStep);
            this.tryMove(this._delta, mapScene, true);
          }
        } else {
          if (this.isMoving) {
            this.facingYaw +=
              angleDelta(this.facingYaw, Math.atan2(this._move.x, this._move.z)) *
              (1 - Math.exp(-step * 14));
          }
          this._delta
            .copy(this.getForward())
            .multiplyScalar((attack.lunge * 0.65 / Math.max(hitTime, 0.12)) * step);
          this.tryMove(this._delta, mapScene, true);
        }
      }

      if (!this.eventFired.hit && this.stateTime >= hitTime) {
        this.eventFired.hit = true;
        const index = Number(this.state.slice(-1));
        const forward = this.getForward();
        this.fx.spawnSlashWave(this.position, forward, index);
        let hit = false;

        for (const enemy of enemies) {
          if (enemy.dead || enemy.disabled || Math.abs(enemy.position.y - this.position.y) > 2.4) {
            continue;
          }
          this._tmp.subVectors(enemy.position, this.position);
          this._tmp.y = 0;
          const distance = this._tmp.length();
          if (
            distance <= attack.reach &&
            (distance < 1.45 || this._tmp.multiplyScalar(1 / distance).dot(forward) > attack.arc)
          ) {
            const dmg = attack.damage + Math.floor(Math.random() * 65);
            callbacks?.onDamageEnemy?.(
              enemy,
              dmg,
              index === 3 ? 'weak' : 'normal',
              index === 3 ? 'TAJO CARMESÍ' : ''
            );
            this.mp = Math.min(this.maxMp, this.mp + 16);
            this.limitGauge = Math.min(100, this.limitGauge + 9);
            hit = true;
          }
        }
        if (hit) {
          this.hitStop = index === 3 ? 0.045 : 0.025;
          cameraCtrl.addShake(index === 3 ? 0.28 : 0.14);
        }
      }

      // Fast combo chaining window
      if (this.queuedCombo && this.stateTime >= this._duration() * 0.52 && this.state !== 'Attack3') {
        const next = this.state === 'Attack1' ? 'Attack2' : 'Attack3';
        this.queuedCombo = false;
        if (target && !target.dead && target.position.distanceTo(this.position) < 9.0) {
          this.faceToward(target.position, true);
        }
        this.playState(next, 0.05, ATTACKS[next].speed);
        this.audio?.playSwing(next === 'Attack2' ? 2 : 3);
      } else if (this.stateTime >= this._duration() * 0.92) {
        this._finishAction(input);
      }
    } else if (this.state === 'Cast') {
      const release = (this.meta.clips.Cast?.events?.release?.[0] || 0.42) / this.stateScale;
      if (target && !target.dead && this.stateTime < release) {
        this.faceToward(target.position, false, step * 1.5);
      }
      if (!this.eventFired.release && this.stateTime >= release) {
        this.eventFired.release = true;
        this.root.updateMatrixWorld(true);
        const origin = this.fxNodes.HandL_FX
          ? this.fxNodes.HandL_FX.getWorldPosition(new THREE.Vector3())
          : this.position.clone().addScaledVector(UP, 1.35);
        const aim =
          target && !target.dead
            ? target.position.clone().addScaledVector(UP, 1.05).sub(origin).normalize()
            : this.getForward();
        const generation = this.generation;
        this.audio?.playSpellLaunch();
        cameraCtrl.addShake(0.22);

        this.fx.spawnCrimsonProjectile(origin, aim, target, (boom) => {
          if (generation !== this.generation || this.state === 'Death') return;
          this.audio?.playExplosion();
          cameraCtrl.addShake(0.36);
          for (const e of enemies) {
            if (!e.dead && !e.disabled && e.position.distanceTo(boom) < 4.8) {
              const dmg = 740 + Math.floor(Math.random() * 140);
              callbacks?.onDamageEnemy?.(e, dmg, 'magic', 'LLAMA CARMESÍ');
              this.limitGauge = Math.min(100, this.limitGauge + 14);
            }
          }
        });
      }
      if (this.stateTime >= this._duration() * 0.88) {
        this._finishAction(input);
      }
    } else if (this.state === 'Limit') {
      const hitTime = (this.meta.clips.Attack3?.events?.hit?.[0] || 0.45) / this.stateScale;
      if (!this.eventFired.hit && this.stateTime >= hitTime) {
        this.eventFired.hit = true;
        const center = this.position.clone().addScaledVector(this.getForward(), 2.5);
        this.fx.spawnCrimsonExplosion(center);
        for (const e of this.limitTargets?.enemies || []) {
          if (!e.dead && !e.disabled && e.position.distanceTo(this.position) < 16) {
            this.fx.spawnCrimsonExplosion(e.position.clone().addScaledVector(UP, 0.9));
            this.limitTargets.onDamageEnemy(e, 1580, 'weak', 'LÍMITE CARMESÍ');
          }
        }
        cameraCtrl.addShake(0.45);
        this.hitStop = 0.06;
      }
      if (this.stateTime >= this._duration()) {
        this.limitTargets = null;
        this._finishAction(input);
      }
    } else if (this.state === 'Dodge') {
      const t = this.stateTime / this._duration();
      const dodgeSpeed = t < 0.72 ? 14.5 : 6.0;
      this._delta.copy(this.dodgeDirection).multiplyScalar(dodgeSpeed * step);
      this.tryMove(this._delta, mapScene, true);
      if (t >= 0.92) this._finishAction(input);
    } else if (this.state === 'Hit') {
      if (this.stateTime >= 0.22) this._finishAction(input);
    } else {
      // Agile Kingdom Hearts Locomotion (Idle / Walk / Run / Jump / Fall / Land)
      const baseSpeed = input.sprint
        ? SPRINT_SPEED
        : inputLength < 0.45
          ? WALK_SPEED
          : RUN_SPEED;
      this._tmp.copy(this._move).multiplyScalar(baseSpeed * inputLength);
      this.velocity.lerp(this._tmp, 1 - Math.exp(-step * (inputLength > 0 ? 22 : 24)));
      if (this.velocity.lengthSq() < 0.002) this.velocity.set(0, 0, 0);

      this._delta.copy(this.velocity).multiplyScalar(step);
      const beforeX = this.position.x;
      const beforeZ = this.position.z;
      this.tryMove(this._delta, mapScene, !this.grounded);
      const actualSpeed =
        Math.hypot(this.position.x - beforeX, this.position.z - beforeZ) / Math.max(step, 0.001);

      if (this.isMoving) {
        this.facingYaw +=
          angleDelta(this.facingYaw, Math.atan2(this._move.x, this._move.z)) *
          (1 - Math.exp(-step * 20));
        if (this.isSprinting && this.grounded && Math.random() < 0.45) {
          this.fx.emitSparks(this.position.clone().addScaledVector(UP, 0.12), 1, {
            color1: 0xb829ff,
            color2: 0xff1e56,
            speed: 2.2,
            size: 0.7,
            life: 0.25,
          });
        }
      }

      if (this.grounded) {
        const moving = this.isMoving && actualSpeed > 0.2;
        const next = moving ? (actualSpeed < 3.6 ? 'Walk' : 'Run') : 'Idle';
        if (this.state !== next && !(this.state === 'Land' && this.stateTime < 0.1)) {
          this.playState(next, 0.1);
        }
        if (moving && this.currentAction) {
          const playback = THREE.MathUtils.clamp(
            actualSpeed / (next === 'Run' ? 6.2 : 3.2),
            0.75,
            1.65
          );
          this.currentAction.setEffectiveTimeScale(playback);
          this.stateScale = playback;
        }
      }
    }

    this._softSeparateFromEnemies(step, mapScene);
    this._updateGround(step, mapScene, input);
    this.root.rotation.y = this.facingYaw;
    this._settleFeet(step);

    const activeSlash = !!ATTACKS[this.state] || this.state === 'Limit';
    this._updateSword(activeSlash);
  }

  _softSeparateFromEnemies(dt, mapScene) {
    // Gentle push so Aeren never gets wedged inside an enemy while still being able to run past them
    if (this.state === 'Dodge' || !this.grounded) return;
    for (const e of this._enemies) {
      if (e.dead || e.disabled || Math.abs(e.position.y - this.position.y) > 1.8) continue;
      const dx = this.position.x - e.position.x;
      const dz = this.position.z - e.position.z;
      const dist = Math.hypot(dx, dz);
      const minSep = 0.58;
      if (dist < minSep && dist > 0.0001) {
        const push = (minSep - dist) * Math.min(1, dt * 14);
        const nx = this.position.x + (dx / dist) * push;
        const nz = this.position.z + (dz / dist) * push;
        const g = mapScene.sampleGround(nx, nz);
        if (g.height > -1000 && Math.abs(g.height - this.position.y) < 1.2) {
          this.position.x = nx;
          this.position.z = nz;
        }
      }
    }
  }

  _updateSword(active) {
    if (!this.fxNodes.SwordBase || !this.fxNodes.SwordTip) return;
    this.root.updateMatrixWorld(true);
    this.fxNodes.SwordBase.getWorldPosition(this._base);
    this.fxNodes.SwordTip.getWorldPosition(this._tip);
    this.fx.recordSwordSample(this._base, this._tip, active);
    this._tmp.copy(this._tip);
    this.root.worldToLocal(this._tmp);
    this.swordLight.position.copy(this._tmp);
    this.swordLight.intensity = active ? 8.5 : 2.6;
  }

  updateDeath(dt) {
    if (this.state !== 'Death' || !this.mixer) return;
    this.stateTime += dt;
    this.mixer.update(dt);
    if (!this.grounded) {
      this.verticalVel -= GRAVITY * dt;
      this.position.y += this.verticalVel * dt;
      if (this.position.y <= this.groundHeight) {
        this.position.y = this.groundHeight;
        this.verticalVel = 0;
        this.grounded = true;
      }
    }
    this._constrainSwordToFloor();
    this._updateSword(false);
  }

  _constrainSwordToFloor() {
    if (!this.handBone || !this.fxNodes.SwordTip) return;
    this.root.updateMatrixWorld(true);
    this.fxNodes.SwordTip.getWorldPosition(this._tip);
    const floor = this.groundHeight + 0.12;
    if (this._tip.y >= floor) return;
    this.handBone.getWorldPosition(this._handPosition);
    this._tmp.subVectors(this._tip, this._handPosition);
    const length = this._tmp.length();
    if (length < 0.01) return;
    const y = THREE.MathUtils.clamp(floor - this._handPosition.y, -length * 0.98, length * 0.98);
    this._swordDesired.set(this._tmp.x, 0, this._tmp.z);
    if (this._swordDesired.lengthSq() < 0.0001) this._swordDesired.copy(this.getForward());
    this._swordDesired
      .normalize()
      .multiplyScalar(Math.sqrt(Math.max(0, length * length - y * y)));
    this._swordDesired.y = y;
    this._handCorrection.setFromUnitVectors(this._tmp.normalize(), this._swordDesired.normalize());
    this.handBone.parent.getWorldQuaternion(this._parentRotation);
    this._localCorrection
      .copy(this._parentRotation)
      .invert()
      .multiply(this._handCorrection)
      .multiply(this._parentRotation);
    this.handBone.quaternion.premultiply(this._localCorrection).normalize();
    this.root.updateMatrixWorld(true);
  }

  _settleFeet(dt) {
    if (!this.model || !this._footMeshes.length) return;
    let offset = 0;
    if (this.grounded && ['Idle', 'Walk', 'Run', 'Land'].includes(this.state)) {
      this.root.updateMatrixWorld(true);
      let lowest = Infinity;
      for (const { mesh, indices } of this._footMeshes) {
        mesh.skeleton.update();
        for (const index of indices) {
          mesh.getVertexPosition(index, this._tmp).applyMatrix4(mesh.matrixWorld);
          lowest = Math.min(lowest, this._tmp.y);
        }
      }
      if (Number.isFinite(lowest)) {
        offset = THREE.MathUtils.clamp(
          this.model.position.y + this.position.y - lowest + 0.008,
          -0.035,
          0.1
        );
      }
    }
    this.model.position.y = THREE.MathUtils.lerp(
      this.model.position.y,
      offset,
      1 - Math.exp(-dt * 28)
    );
  }

  _updateGround(dt, mapScene, input) {
    const ground = mapScene.sampleGround(this.position.x, this.position.z);
    const hasFloor = ground.height > -1000;
    if (hasFloor) {
      this.groundHeight = ground.height;
    }

    if (!this.grounded) {
      this.verticalVel -= GRAVITY * dt;
      this.position.y += this.verticalVel * dt;
      if (this.verticalVel < -0.5 && this.state === 'Jump') {
        this.playState('Fall', 0.1);
      }
      if (hasFloor && this.verticalVel <= 0 && this.position.y <= ground.height + 0.05) {
        this.position.y = ground.height;
        this.verticalVel = 0;
        this.grounded = true;
        if (!ground.blocked) this.lastSafePosition.copy(this.position);
        if (this.state === 'Jump' || this.state === 'Fall') {
          this.playState(this.isMoving ? 'Run' : 'Land', 0.08);
        }
      }
    } else if (hasFloor) {
      this.position.y = THREE.MathUtils.lerp(
        this.position.y,
        ground.height,
        1 - Math.exp(-dt * 28)
      );
      if (!ground.blocked) {
        this.lastSafePosition.copy(this.position);
      }
    }

    if (this.contactShadow) {
      const air = Math.max(0, this.position.y - this.groundHeight);
      this.contactShadow.position.y = 0.015 - (this.position.y - this.groundHeight);
      this.contactShadow.material.opacity = THREE.MathUtils.clamp(1.0 - air * 0.25, 0.15, 1.0);
      this.contactShadow.scale.setScalar(THREE.MathUtils.clamp(1.0 - air * 0.12, 0.55, 1.0));
    }

    if (this.position.y < -18) {
      this.position.copy(this.lastSafePosition);
      this.grounded = true;
      this.verticalVel = 0;
      this.takeDamage(250);
    }
  }

  _canStand(x, z, mapScene, referenceHeight, ignoreBlocked = false) {
    const ground = mapScene.sampleGround(x, z);
    if (ground.height < -1000) return false;
    if (!ignoreBlocked && ground.blocked) return false;

    const maxStepUp = this.grounded ? 1.25 : 2.8;
    const maxStepDown = this.grounded ? 1.65 : 8.0;
    if (ground.height - referenceHeight > maxStepUp) return false;
    if (referenceHeight - ground.height > maxStepDown) return false;

    // Keep a small safety margin from falling into the void (-9999)
    const voidMargin = 0.18;
    for (const [ox, oz] of [
      [voidMargin, 0],
      [-voidMargin, 0],
      [0, voidMargin],
      [0, -voidMargin],
    ]) {
      const edge = mapScene.sampleGround(x + ox, z + oz);
      if (edge.height < -1000) return false;
    }
    return true;
  }

  tryMove(delta, mapScene, phaseThrough = false) {
    const length = Math.hypot(delta.x, delta.z);
    if (length < 0.000001) return false;

    const steps = Math.max(1, Math.ceil(length / 0.14));
    const stepLen = length / steps;
    const baseAngle = Math.atan2(delta.x, delta.z);
    // 8 slide angles (0°, ±22°, ±45°, ±68°, ±84°) so Aeren glides smoothly along any wall or ring
    const slideOffsets = [0, 0.38, -0.38, 0.78, -0.78, 1.18, -1.18, 1.46, -1.46];
    let moved = false;

    for (let i = 0; i < steps; i++) {
      const oldGround = mapScene.sampleGround(this.position.x, this.position.z);
      const reference = oldGround.height > -1000 ? oldGround.height : this.groundHeight;
      let stepMoved = false;

      for (let s = 0; s < slideOffsets.length; s++) {
        const ang = baseAngle + slideOffsets[s];
        const scale = Math.max(0.32, Math.cos(slideOffsets[s]));
        const nx = this.position.x + Math.sin(ang) * stepLen * scale;
        const nz = this.position.z + Math.cos(ang) * stepLen * scale;
        if (this._canStand(nx, nz, mapScene, reference, phaseThrough)) {
          this.position.x = nx;
          this.position.z = nz;
          moved = true;
          stepMoved = true;
          break;
        }
      }
      if (!stepMoved && !phaseThrough) {
        // Fallback: if standing on a cell that was flagged, allow moving onto unflagged ground
        const nx = this.position.x + Math.sin(baseAngle) * stepLen;
        const nz = this.position.z + Math.cos(baseAngle) * stepLen;
        if (oldGround.blocked && this._canStand(nx, nz, mapScene, reference, true)) {
          this.position.x = nx;
          this.position.z = nz;
          moved = true;
        }
      }
    }
    return moved;
  }
}
