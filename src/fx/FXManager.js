import * as THREE from 'three';

export class FXManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'FXManager';
    this.scene.add(this.group);

    this.slashArcs = [];
    this.projectiles = [];
    this.explosions = [];
    this.shockwaves = [];
    this.chargeOrbs = [];

    // High-capacity dynamic particle pool for sparks, crimson embers, dark lightning & heal motes
    this.maxSparks = 700;
    this.sparkData = [];
    this.initSparkPool();

    // Sword ribbon trail (20 segments connecting SwordBase -> SwordTip history)
    this.trailHistory = [];
    this.maxTrail = 20;
    this.trailActive = false;
    this.initSwordTrail();
    // One permanent light avoids recompiling scene shaders for every spell.
    this.effectLight = new THREE.PointLight(0xff1744, 0, 16, 1.5);
    this.group.add(this.effectLight);
    this._closest = new THREE.Vector3();
  }

  _disposeObject(object) {
    const geometries = new Set(), materials = new Set();
    object.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    object.removeFromParent();
  }

  reset() {
    for (const child of [...this.group.children]) {
      if (child !== this.trailMesh && child !== this.sparkPoints && child !== this.effectLight) this._disposeObject(child);
    }
    for (const collection of [this.slashArcs, this.projectiles, this.explosions, this.shockwaves, this.chargeOrbs, this.trailHistory]) collection.length = 0;
    for (const spark of this.sparkData) spark.active = false;
    this.sparkGeo.attributes.position.array.fill(0);
    this.sparkGeo.attributes.aSize.array.fill(0);
    this.sparkGeo.attributes.aSize.needsUpdate = true;
    this.trailMesh.visible = false;
    this.effectLight.intensity = 0;
  }

  initSwordTrail() {
    const n = this.maxTrail;
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      uv[i * 4 + 0] = u;
      uv[i * 4 + 1] = 0;
      uv[i * 4 + 2] = u;
      uv[i * 4 + 3] = 1;
      if (i < n - 1) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          // vUv.x: 0 = newest (at blade), 1 = oldest tail
          // vUv.y: 0 = hilt base, 1 = blade tip
          float ageFade = pow(1.0 - vUv.x, 1.45);
          float tipIntensity = smoothstep(0.05, 0.92, vUv.y);
          float edgeStreak = smoothstep(0.68, 0.98, vUv.y);
          float flameNoise = 0.75 + 0.25 * sin(vUv.x * 22.0 - uTime * 28.0 + vUv.y * 8.0);

          vec3 darkCrimson = vec3(0.55, 0.0, 0.14);
          vec3 brightCrimson = vec3(1.0, 0.08, 0.26);
          vec3 whiteHot = vec3(1.0, 0.85, 0.92);

          vec3 col = mix(darkCrimson, brightCrimson, tipIntensity * flameNoise);
          col = mix(col, whiteHot, edgeStreak * (1.0 - vUv.x * 0.65));

          float alpha = ageFade * (0.25 + 0.75 * tipIntensity) * flameNoise;
          gl_FragColor = vec4(col * 1.95, alpha * 0.92);
        }
      `,
    });

    this.trailMesh = new THREE.Mesh(geo, mat);
    this.trailMesh.frustumCulled = false;
    this.group.add(this.trailMesh);
  }

  initSparkPool() {
    const pos = new Float32Array(this.maxSparks * 3);
    const col = new Float32Array(this.maxSparks * 3);
    const size = new Float32Array(this.maxSparks);

    for (let i = 0; i < this.maxSparks; i++) {
      pos[i * 3 + 1] = -9999;
      this.sparkData.push({
        active: false,
        life: 0,
        maxLife: 1,
        pos: new THREE.Vector3(0, -9999, 0),
        vel: new THREE.Vector3(),
        gravity: -9.8,
        drag: 0.96,
        size: 1,
        color: new THREE.Color(0xff1744),
      });
    }

    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparkGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.sparkGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uIsoScale: { value: 36 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uIsoScale;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uIsoScale * 0.12, 1.0, 32.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float core = exp(-d * d * 24.0);
          float glow = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * (0.8 + core * 0.8), glow * 0.7);
        }
      `,
    });

    this.sparkPoints = new THREE.Points(this.sparkGeo, mat);
    this.sparkPoints.frustumCulled = false;
    this.group.add(this.sparkPoints);
  }

  emitSparks(origin, count, opts = {}) {
    const c1 = new THREE.Color(opts.color1 ?? 0xff1744);
    const c2 = new THREE.Color(opts.color2 ?? 0xffb3c6);
    const speed = opts.speed ?? 7.5;
    const spread = opts.spread ?? 1.0;
    const gravity = opts.gravity ?? -8.5;
    const size = opts.size ?? 1.1;
    const life = opts.life ?? 0.55;

    let spawned = 0;
    for (let i = 0; i < this.maxSparks && spawned < count; i++) {
      const s = this.sparkData[i];
      if (s.active) continue;
      s.active = true;
      s.life = 0;
      s.maxLife = life * (0.65 + Math.random() * 0.7);
      s.pos.copy(origin);
      s.pos.x += (Math.random() - 0.5) * 0.25;
      s.pos.y += (Math.random() - 0.5) * 0.25;
      s.pos.z += (Math.random() - 0.5) * 0.25;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const vMag = speed * (0.45 + Math.random() * 0.85);
      s.vel.set(
        Math.sin(phi) * Math.cos(theta) * vMag * spread,
        Math.abs(Math.cos(phi)) * vMag * 0.85 + (opts.upBias ?? 1.5),
        Math.sin(phi) * Math.sin(theta) * vMag * spread
      );
      if (opts.dir) {
        s.vel.addScaledVector(opts.dir, speed * 0.65);
      }
      s.gravity = gravity;
      s.size = size * (0.7 + Math.random() * 0.7);
      s.color.copy(c1).lerp(c2, Math.random());
      spawned++;
    }
  }

  recordSwordSample(basePos, tipPos, active) {
    this.trailActive = active;
    if (active) {
      this.trailHistory.unshift({
        base: basePos.clone(),
        tip: tipPos.clone(),
      });
      if (this.trailHistory.length > this.maxTrail) {
        this.trailHistory.pop();
      }
      // Emit subtle crimson sparks from the blade tip while swinging
      if (Math.random() < 0.35) {
        this.emitSparks(tipPos, 2, {
          color1: 0xff0a3c,
          color2: 0xff99b8,
          speed: 3.2,
          size: 0.75,
          life: 0.32,
          gravity: -2.0,
        });
      }
    } else if (this.trailHistory.length > 0) {
      this.trailHistory.pop();
    }
  }

  spawnSlashWave(origin, forward, comboStep = 1) {
    // Wide crescent crimson-black slash arc matching Persona 5 / Kingdom Hearts sword FX
    const radius = comboStep === 3 ? 1.9 : 1.65;
    const geo = new THREE.RingGeometry(radius * 0.78, radius, 36, 1, -Math.PI * 0.55, Math.PI * 1.1);
    // Polar UVs form a tapered crescent, instead of large rectangular fans.
    const arcUv = geo.attributes.uv;
    for (let i = 0; i < arcUv.count; i++) arcUv.setXY(i, (i % 37) / 36, Math.floor(i / 37));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0 },
        uColor: { value: new THREE.Color(comboStep === 3 ? 0xff0044 : 0xff1e56) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uProgress;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float radial = smoothstep(0.0, 0.24, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
          float arcFade = pow(max(0.0, sin(vUv.x * 3.14159)), 1.8);
          float hotEdge = smoothstep(0.72, 0.93, vUv.y) * 0.6;
          vec3 col = mix(uColor * 1.85, vec3(1.0, 0.88, 0.94), hotEdge);
          float alpha = radial * arcFade * (1.0 - uProgress);
          gl_FragColor = vec4(col * 2.1, alpha * 0.95);
        }
      `,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin).add(new THREE.Vector3(0, 1.08, 0));

    const yaw = Math.atan2(forward.x, forward.z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = yaw - Math.PI / 2;
    if (comboStep === 1) {
      mesh.rotation.z = -0.38;
      mesh.rotation.x = Math.PI / 2 + 0.28;
    } else if (comboStep === 2) {
      mesh.rotation.z = 0.35;
      mesh.rotation.x = Math.PI / 2 - 0.26;
    } else {
      // Attack 3 vertical overhead cleave wave
      mesh.rotation.y = yaw;
      mesh.rotation.z = Math.PI / 2;
      mesh.rotation.x = 0;
    }

    this.group.add(mesh);
    this.slashArcs.push({
      mesh,
      vel: forward.clone().multiplyScalar(comboStep === 3 ? 9.5 : 5.2),
      life: 0,
      maxLife: comboStep === 3 ? 0.38 : 0.28,
      spin: comboStep === 2 ? -5.5 : 5.5,
    });

    this.emitSparks(mesh.position, comboStep === 3 ? 38 : 22, {
      color1: 0xff003c,
      color2: 0xffccd8,
      speed: comboStep === 3 ? 9.5 : 6.5,
      dir: forward,
      size: 1.15,
    });

    if (comboStep === 3) {
      this.spawnShockwave(
        origin.clone().addScaledVector(forward, 1.4),
        0xff124f,
        3.8,
        0.48
      );
    }
  }

  spawnShockwave(pos, colorHex = 0xff1744, maxRadius = 3.5, duration = 0.45) {
    const geo = new THREE.RingGeometry(0.25, 0.58, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.position.y += 0.06;
    this.group.add(mesh);
    this.shockwaves.push({
      mesh,
      life: 0,
      maxLife: duration,
      maxScale: maxRadius / 0.58,
    });
  }

  spawnSpellCharge(handNode) {
    // Spinning crimson magic sigil + core attached to Aeren's left hand during Cast wind-up
    const orbGroup = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffd6e2,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), coreMat);
    orbGroup.add(core);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff0a46,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring1 = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 32), ringMat);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.44, 32), ringMat);
    ring2.rotation.x = Math.PI / 2;
    orbGroup.add(ring1, ring2);

    this.group.add(orbGroup);
    this.chargeOrbs.push({
      group: orbGroup,
      ring1,
      ring2,
      handNode,
      life: 0,
      maxLife: 0.56,
    });
  }

  spawnCrimsonProjectile(origin, direction, targetEnemy = null, onImpact = null) {
    // Launched Crimson Magic Spell ("Lanza del Abismo Carmesí")
    const projGroup = new THREE.Group();
    projGroup.position.copy(origin);

    // White-hot inner core
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 20, 20),
      new THREE.MeshBasicMaterial({
        color: 0xffeef2,
        blending: THREE.AdditiveBlending,
      })
    );
    projGroup.add(core);

    // Outer fiery plasma shell with animated shader
    const shellMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        uniform float uTime;
        varying vec3 vN;
        varying vec3 vP;
        void main() {
          vec3 p = position * (1.0 + 0.14 * sin(position.x * 9.0 + uTime * 22.0));
          vP = p;
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vN;
        varying vec3 vP;
        void main() {
          float rim = pow(1.0 - abs(vN.z), 1.4);
          vec3 col = mix(vec3(1.0, 0.05, 0.25), vec3(1.0, 0.65, 0.2), rim);
          gl_FragColor = vec4(col * 2.2, 0.85);
        }
      `,
    });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.52, 24, 24), shellMat);
    projGroup.add(shell);

    // Twin spinning runic vortex rings around the projectile
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff124f,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 10, 32), ringMat);
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.028, 10, 32), ringMat);
    ringB.rotation.x = Math.PI / 2;
    projGroup.add(ringA, ringB);

    this.group.add(projGroup);
    this.projectiles.push({
      group: projGroup,
      shellMat,
      ringA,
      ringB,
      vel: direction.clone().normalize().multiplyScalar(22.0),
      previous: origin.clone(),
      target: targetEnemy,
      life: 0,
      maxLife: 2.1,
      onImpact,
    });

    // Launch burst at hand
    this.emitSparks(origin, 35, {
      color1: 0xff003c,
      color2: 0xffd1dc,
      speed: 8.5,
      dir: direction,
      size: 1.25,
    });
  }

  spawnCrimsonExplosion(pos) {
    // Massive crimson-black Persona 5 / Kingdom Hearts magic detonation
    const expGroup = new THREE.Group();
    expGroup.position.copy(pos);

    const domeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uProgress: { value: 0 } },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uProgress;
        varying vec3 vN;
        varying vec3 vP;
        void main() {
          float rim = pow(1.0 - abs(vN.z), 1.35);
          float bands = 0.6 + 0.4 * sin(vP.y * 8.0 - uProgress * 18.0);
          vec3 col = mix(vec3(1.0, 0.04, 0.24), vec3(1.0, 0.85, 0.92), rim * bands);
          float alpha = (1.0 - uProgress) * (0.45 + 0.55 * rim);
          gl_FragColor = vec4(col * 2.2, alpha * 0.85);
        }
      `,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 28, 24), domeMat);
    expGroup.add(dome);

    // Vertical crimson-violet pillar of fire
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0xff174b,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.25, 8.2, 20, 1, true), pillarMat);
    pillar.position.y = 3.2;
    expGroup.add(pillar);

    this.group.add(expGroup);
    this.explosions.push({
      group: expGroup,
      dome,
      domeMat,
      pillar,
      pillarMat,
      life: 0,
      maxLife: 0.65,
      maxRadius: 3.8,
    });

    this.spawnShockwave(pos, 0xff0a46, 5.2, 0.55);
    this.spawnShockwave(pos, 0xc33cff, 3.6, 0.42);
    this.emitSparks(pos, 85, {
      color1: 0xff003c,
      color2: 0xffea9f,
      speed: 13.5,
      size: 1.5,
      life: 0.78,
      upBias: 3.5,
    });
  }

  spawnSupportLinkFX(playerPos, enemies) {
    // Companions Lyra (emerald wind/heal) & Nix (astral cyan-violet frost) burst
    this.spawnShockwave(playerPos, 0x38ffb3, 5.0, 0.65);
    this.spawnShockwave(playerPos, 0x4cc9ff, 6.2, 0.75);
    this.emitSparks(playerPos.clone().add(new THREE.Vector3(0, 1, 0)), 75, {
      color1: 0x2eff9b,
      color2: 0x62d8ff,
      speed: 8.0,
      size: 1.35,
      life: 0.85,
      gravity: -2.0,
    });
    for (const e of enemies) {
      if (!e.dead && e.position.distanceTo(playerPos) < 15) {
        this.spawnShockwave(e.position, 0x52dcff, 3.0, 0.45);
        this.emitSparks(e.position.clone().add(new THREE.Vector3(0, 1, 0)), 35, {
          color1: 0x48e5ff,
          color2: 0xc266ff,
          speed: 9.0,
        });
      }
    }
  }

  update(dt, elapsed, enemies, mapScene) {
    this.effectLight.intensity = 0;
    // 1. Update sword ribbon trail geometry
    this.trailMesh.material.uniforms.uTime.value = elapsed;
    if (this.trailHistory.length >= 2) {
      this.trailMesh.visible = true;
      const posAttr = this.trailMesh.geometry.attributes.position;
      const arr = posAttr.array;
      const len = this.trailHistory.length;
      for (let i = 0; i < this.maxTrail; i++) {
        const s = this.trailHistory[Math.min(i, len - 1)];
        arr[i * 6 + 0] = s.base.x;
        arr[i * 6 + 1] = s.base.y;
        arr[i * 6 + 2] = s.base.z;
        arr[i * 6 + 3] = s.tip.x;
        arr[i * 6 + 4] = s.tip.y;
        arr[i * 6 + 5] = s.tip.z;
      }
      posAttr.needsUpdate = true;
    } else {
      this.trailMesh.visible = false;
    }

    // 2. Update slash wave arcs
    for (let i = this.slashArcs.length - 1; i >= 0; i--) {
      const a = this.slashArcs[i];
      a.life += dt;
      const t = a.life / a.maxLife;
      if (t >= 1) {
        this.group.remove(a.mesh);
        a.mesh.geometry.dispose();
        a.mesh.material.dispose();
        this.slashArcs.splice(i, 1);
        continue;
      }
      a.mesh.position.addScaledVector(a.vel, dt);
      a.mesh.scale.setScalar(1.0 + t * 0.55);
      a.mesh.material.uniforms.uProgress.value = t;
    }

    // 3. Update hand spell-charge orbs
    for (let i = this.chargeOrbs.length - 1; i >= 0; i--) {
      const c = this.chargeOrbs[i];
      c.life += dt;
      if (c.life >= c.maxLife) {
        this._disposeObject(c.group);
        this.chargeOrbs.splice(i, 1);
        continue;
      }
      if (c.handNode) {
        c.handNode.getWorldPosition(c.group.position);
      }
      const s = Math.sin((c.life / c.maxLife) * Math.PI) * 1.35;
      c.group.scale.setScalar(s);
      c.ring1.rotation.z += dt * 12;
      c.ring2.rotation.y -= dt * 14;
      if (Math.random() < 0.8) {
        this.emitSparks(c.group.position, 2, {
          color1: 0xff0040,
          color2: 0xffb8d0,
          speed: 2.5,
          size: 0.85,
          life: 0.25,
          gravity: 1.5,
        });
      }
    }

    // 4. Update launched crimson projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life += dt;
      p.shellMat.uniforms.uTime.value = elapsed;
      p.ringA.rotation.z += dt * 14;
      p.ringB.rotation.x += dt * 16;

      // Soft homing toward target enemy
      if (p.target && !p.target.dead) {
        const aim = p.target.position
          .clone()
          .add(new THREE.Vector3(0, 1.0, 0))
          .sub(p.group.position)
          .normalize();
        const speed = p.vel.length();
        p.vel.lerp(aim.multiplyScalar(speed), Math.min(1, dt * 7.5));
      }

      p.previous.copy(p.group.position);
      p.group.position.addScaledVector(p.vel, dt);
      this.effectLight.position.copy(p.group.position);
      this.effectLight.intensity = 2;

      // Dense crimson fire & dark spark wake
      this.emitSparks(p.group.position, 2, {
        color1: 0xff0838,
        color2: 0xc229ff,
        speed: 3.4,
        size: 1.15,
        life: 0.36,
        gravity: 0.5,
      });

      // Check collision with enemies or floor
      let hitPos = null;
      if (enemies) {
        for (const e of enemies) {
          if (e.dead || e.disabled) continue;
          const eCenter = e.position.clone().add(new THREE.Vector3(0, 1.0, 0));
          const dx = p.group.position.x - p.previous.x, dy = p.group.position.y - p.previous.y, dz = p.group.position.z - p.previous.z;
          const lengthSq = dx * dx + dy * dy + dz * dz;
          const t = lengthSq > 0 ? THREE.MathUtils.clamp(((eCenter.x - p.previous.x) * dx + (eCenter.y - p.previous.y) * dy + (eCenter.z - p.previous.z) * dz) / lengthSq, 0, 1) : 0;
          this._closest.copy(p.previous).lerp(p.group.position, t);
          if (this._closest.distanceToSquared(eCenter) < Math.pow((e.radius || .45) + .36, 2)) {
            hitPos = this._closest.clone();
            break;
          }
        }
      }
      if (!hitPos && mapScene) {
        const g = mapScene.sampleGround(p.group.position.x, p.group.position.z);
        if (g.height > -1000 && p.group.position.y <= g.height + 0.25) {
          hitPos = p.group.position.clone();
          hitPos.y = g.height + 0.1;
        }
      }
      if (hitPos || p.life >= p.maxLife) {
        const boomPos = hitPos || p.group.position.clone();
        this.spawnCrimsonExplosion(boomPos);
        if (hitPos && p.onImpact) p.onImpact(boomPos);
        this._disposeObject(p.group);
        this.projectiles.splice(i, 1);
      }
    }

    // 5. Update explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.life += dt;
      const t = ex.life / ex.maxLife;
      if (t >= 1) {
        this._disposeObject(ex.group);
        this.explosions.splice(i, 1);
        continue;
      }
      const ease = 1 - Math.pow(1 - t, 3);
      ex.dome.scale.setScalar(0.4 + ease * ex.maxRadius);
      ex.domeMat.uniforms.uProgress.value = t;
      ex.pillar.scale.set(1.0 - t * 0.45, 0.5 + ease * 1.4, 1.0 - t * 0.45);
      ex.pillarMat.opacity = (1 - t) * 0.32;
      this.effectLight.position.copy(ex.group.position).y += 1;
      this.effectLight.intensity = Math.max(this.effectLight.intensity, 8 * (1 - t));
    }

    // 6. Update ground shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life += dt;
      const t = sw.life / sw.maxLife;
      if (t >= 1) {
        this.group.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mesh.material.dispose();
        this.shockwaves.splice(i, 1);
        continue;
      }
      const s = 1 + (sw.maxScale - 1) * (1 - Math.pow(1 - t, 2.4));
      sw.mesh.scale.setScalar(s);
      sw.mesh.material.opacity = (1 - t) * 0.9;
    }

    // 7. Update particle pool
    const posArr = this.sparkGeo.attributes.position.array;
    const colArr = this.sparkGeo.attributes.aColor.array;
    const sizeArr = this.sparkGeo.attributes.aSize.array;
    for (let i = 0; i < this.maxSparks; i++) {
      const s = this.sparkData[i];
      if (!s.active) continue;
      s.life += dt;
      if (s.life >= s.maxLife) {
        s.active = false;
        posArr[i * 3 + 1] = -9999;
        sizeArr[i] = 0;
        continue;
      }
      const k = 1 - s.life / s.maxLife;
      s.vel.y += s.gravity * dt;
      s.vel.multiplyScalar(Math.pow(s.drag, dt * 60));
      s.pos.addScaledVector(s.vel, dt);

      posArr[i * 3 + 0] = s.pos.x;
      posArr[i * 3 + 1] = s.pos.y;
      posArr[i * 3 + 2] = s.pos.z;
      colArr[i * 3 + 0] = s.color.r * k;
      colArr[i * 3 + 1] = s.color.g * k;
      colArr[i * 3 + 2] = s.color.b * k;
      sizeArr[i] = s.size * k;
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparkGeo.attributes.aColor.needsUpdate = true;
    this.sparkGeo.attributes.aSize.needsUpdate = true;
  }
}
