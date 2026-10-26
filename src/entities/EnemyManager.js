import * as THREE from 'three';
import { assetUrl } from '../assetUrl.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

const ENEMY_SPAWNS = [
  // Entrance Plaza & Threshold (5 enemies immediately visible in front of spawn)
  { name: 'Rondador del Umbral Izquierdo', pos: [-3.6, 8.24, 72.8], tier: 1, hp: 980 },
  { name: 'Rondador del Umbral Derecho', pos: [3.6, 8.24, 72.8], tier: 1, hp: 980 },
  { name: 'Acechador del Umbral', pos: [0, 8.24, 67.8], tier: 2, hp: 1350, objective: 'Umbral' },
  { name: 'Espectro de la Galería Oeste', pos: [-11.8, 8.24, 74.8], tier: 1, hp: 1050 },
  { name: 'Espectro de la Galería Este', pos: [11.8, 8.24, 74.8], tier: 1, hp: 1050 },

  // Axial Bridge Gauntlet (5 enemies)
  { name: 'Vigía del Puente Sur', pos: [0, 8.24, 55.5], tier: 1, hp: 1100 },
  { name: 'Lancero Abisal del Eje', pos: [-1.0, 8.24, 46.5], tier: 2, hp: 1350 },
  { name: 'Centinela del Puente Axial', pos: [0, 8.24, 38.0], tier: 2, hp: 1650, objective: 'Puente axial' },
  { name: 'Caballero Sombrío del Eje', pos: [1.0, 8.24, 28.5], tier: 2, hp: 1450 },
  { name: 'Guardián del Pórtico Astral', pos: [0, 8.24, 20.2], tier: 2, hp: 1500 },

  // Central Sanctuary Ring & Altar (6 enemies)
  { name: 'Heraldo del Santuario', pos: [0, 8.24, 9.5], tier: 3, hp: 2500, objective: 'Santuario' },
  { name: 'Custodio Astral de Poniente', pos: [-6.4, 8.24, 11.4], tier: 2, hp: 1550 },
  { name: 'Custodio Astral de Levante', pos: [6.4, 8.24, 11.4], tier: 2, hp: 1550 },
  { name: 'Guardián del Altar Oeste', pos: [-11.2, 8.24, 4.5], tier: 3, hp: 1950 },
  { name: 'Guardián del Altar Este', pos: [11.2, 8.24, 4.5], tier: 3, hp: 1950 },
  { name: 'Arcano del Anillo Norte', pos: [0, 8.24, -11.5], tier: 3, hp: 2100 },

  // West Wing (6 enemies)
  { name: 'Sombra de la Arcada Sur', pos: [-28.58, 8.24, 72.24], tier: 1, hp: 1100 },
  { name: 'Vigilante del Claustro Oeste', pos: [-47.89, 8.24, 56.68], tier: 1, hp: 1200 },
  { name: 'Acechador Serpenteante', pos: [-55.4, 7.3, 44.0], tier: 2, hp: 1450 },
  { name: 'Verdugo de la Terraza Oeste', pos: [-57.5, 8.24, 26.0], tier: 2, hp: 1650 },
  { name: 'Caballero del Pórtico Oeste', pos: [-69.4, 8.15, 1.6], tier: 2, hp: 1750 },
  { name: 'Señor Abisal de Poniente', pos: [-58.0, 10.25, -20.5], tier: 3, hp: 2400 },

  // East Wing & North Sanctuary (6 enemies)
  { name: 'Acechador de la Cripta Este', pos: [42.63, 8.24, 63.86], tier: 1, hp: 1200 },
  { name: 'Centinela del Santuario Este', pos: [60.4, 8.15, 44.6], tier: 2, hp: 1550 },
  { name: 'Inquisidor del Bastión Este', pos: [65.0, 8.24, 8.0], tier: 2, hp: 1650 },
  { name: 'Arcano de la Aguja Oriental', pos: [63.0, 10.25, -17.5], tier: 3, hp: 2400 },
  { name: 'Sombra del Puente Norte', pos: [0, 8.24, -22.0], tier: 2, hp: 1650 },
  { name: 'Señor de la Nave Norte', pos: [0, 8.24, -35.0], tier: 3, hp: 2400 },
];

const _toward = new THREE.Vector3();
const _step = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const angularDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class EnemyManager {
  constructor(scene, fx, audio) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.enemies = [];
    this.ready = false;
    this.attackGap = 0.9;
    this.attackSerial = 0;
    this.defeated = 0;
    this._initSharedMaterials();
    this._spawnAll();
  }

  _initSharedMaterials() {
    const applyObsidianRim = (mat, isBoss) => {
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
             reflectedLight.directSpecular /= (1.0 + reflectedLight.directSpecular * 1.65);`
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
             {
               float regaliaRim = pow(1.0 - clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0), 3.6);
               vec3 regaliaRimCol = ${isBoss ? 'vec3(0.46, 0.10, 0.24)' : 'vec3(0.26, 0.16, 0.54)'};
               totalEmissiveRadiance += regaliaRimCol * regaliaRim * 0.38;
             }`
          );
      };
      mat.customProgramCacheKey = () => `sentinel-regalia-rim-v10-${isBoss ? 'boss' : 'std'}-${mat.uuid.slice(0, 6)}`;
      return mat;
    };

    // Dark forged charcoal-obsidian plate calibrated to match SkinnedBody gunmetal sheen & moonlight rim
    this.armorMat = applyObsidianRim(
      new THREE.MeshStandardMaterial({
        color: 0x3b394e,
        roughness: 0.44,
        metalness: 0.45,
        emissive: 0x06040c,
        emissiveIntensity: 0.25,
        side: THREE.DoubleSide,
      }),
      false
    );
    this.bossArmorMat = applyObsidianRim(
      new THREE.MeshStandardMaterial({
        color: 0x402f42,
        roughness: 0.42,
        metalness: 0.48,
        emissive: 0x10040c,
        emissiveIntensity: 0.28,
        side: THREE.DoubleSide,
      }),
      true
    );
    this.trimMat = applyObsidianRim(
      new THREE.MeshStandardMaterial({
        color: 0x4e486a,
        roughness: 0.40,
        metalness: 0.50,
        emissive: 0x220c44,
        emissiveIntensity: 0.22,
        side: THREE.DoubleSide,
      }),
      false
    );
    this.bossTrimMat = applyObsidianRim(
      new THREE.MeshStandardMaterial({
        color: 0x5a354c,
        roughness: 0.39,
        metalness: 0.52,
        emissive: 0x460a22,
        emissiveIntensity: 0.26,
        side: THREE.DoubleSide,
      }),
      true
    );

    // High-energy ocular visor, thin helm rune seam, astral star core & weapon fuller materials
    this.eyeVioletMat = new THREE.MeshBasicMaterial({
      color: 0xebafff,
      side: THREE.DoubleSide,
    });
    this.eyeBossMat = new THREE.MeshBasicMaterial({
      color: 0xff70a6,
      side: THREE.DoubleSide,
    });
    this.coreVioletMat = new THREE.MeshBasicMaterial({
      color: 0xc864ff,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.coreBossMat = new THREE.MeshBasicMaterial({
      color: 0xff2c70,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.haloRingVioletMat = new THREE.MeshBasicMaterial({
      color: 0xa84cff,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.haloRingBossMat = new THREE.MeshBasicMaterial({
      color: 0xff2868,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.bladeEdgeVioletMat = new THREE.MeshBasicMaterial({
      color: 0xb938ff,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.bladeEdgeBossMat = new THREE.MeshBasicMaterial({
      color: 0xff1e62,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Subtle ground presence & contact shadow
    this.ringGeo = new THREE.RingGeometry(0.54, 0.60, 40);
    this.bossRingGeo = new THREE.RingGeometry(0.72, 0.82, 48);
    this.innerRingGeo = new THREE.RingGeometry(0.32, 0.36, 6);
    this.contactGeo = new THREE.CircleGeometry(0.56, 24);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const sctx = shadowCanvas.getContext('2d');
    const grad = sctx.createRadialGradient(32, 32, 4, 32, 32, 31);
    grad.addColorStop(0, 'rgba(4, 2, 10, 0.78)');
    grad.addColorStop(0.6, 'rgba(6, 3, 14, 0.36)');
    grad.addColorStop(1, 'rgba(6, 3, 14, 0.0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    this.contactMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });

    // Sculpted 8-sided keeled Gothic Great-Helm + Neck Gorget (bottom-to-top for outward normals, faceted forged planes)
    const helmProfile = [
      new THREE.Vector2(0.094, -0.146),
      new THREE.Vector2(0.076, -0.106),
      new THREE.Vector2(0.080, -0.062),
      new THREE.Vector2(0.090,  0.008),
      new THREE.Vector2(0.085,  0.072),
      new THREE.Vector2(0.050,  0.132),
      new THREE.Vector2(0.001,  0.166),
    ];
    const rawHelmDome = new THREE.LatheGeometry(helmProfile, 8);
    rawHelmDome.scale(0.88, 1.0, 1.12);
    this.helmDomeGeo = rawHelmDome.toNonIndexed();
    this.helmDomeGeo.computeVertexNormals();

    // Sharp angular V-visor dark obsidian faceplate (faceted forged planes matching 01_51_44.png)
    const rawFaceplate = new THREE.BufferGeometry();
    rawFaceplate.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          -0.078,  0.084, 0.052,
           0.000,  0.048, 0.116,
           0.078,  0.084, 0.052,
          -0.083,  0.006, 0.056,
           0.000, -0.018, 0.120,
           0.083,  0.006, 0.056,
          -0.058, -0.082, 0.060,
           0.000, -0.122, 0.102,
           0.058, -0.082, 0.060,
        ],
        3
      )
    );
    rawFaceplate.setIndex([
      0, 3, 1, 1, 3, 4,
      1, 4, 2, 2, 4, 5,
      3, 6, 4, 4, 6, 7,
      4, 7, 5, 5, 7, 8,
    ]);
    this.faceplateGeo = rawFaceplate.toNonIndexed();
    this.faceplateGeo.computeVertexNormals();

    // Fierce slanted angular ocular slit hugging the 37° V-visor slope
    const eyeShape = new THREE.Shape();
    eyeShape.moveTo(-0.032, 0.006);
    eyeShape.lineTo(0.005, 0.012);
    eyeShape.lineTo(0.034, -0.006);
    eyeShape.lineTo(-0.006, -0.010);
    eyeShape.closePath();
    this.eyeSlitGeo = new THREE.ShapeGeometry(eyeShape);

    // Thin vertical forehead/chin abyssal seam + 3D swept V-brow visor seam hugging the faceplate
    const helmSeamShape = new THREE.Shape();
    helmSeamShape.moveTo(0, 0.064);
    helmSeamShape.lineTo(0.004, 0.012);
    helmSeamShape.lineTo(0, -0.046);
    helmSeamShape.lineTo(-0.004, 0.012);
    helmSeamShape.closePath();
    this.helmSeamGeo = new THREE.ShapeGeometry(helmSeamShape);

    this.browSeamGeo = new THREE.BufferGeometry();
    this.browSeamGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          -0.068, 0.072, 0.064,
          -0.065, 0.066, 0.065,
           0.000, 0.044, 0.123,
           0.000, 0.037, 0.124,
           0.068, 0.072, 0.064,
           0.065, 0.066, 0.065,
        ],
        3
      )
    );
    this.browSeamGeo.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
    this.browSeamGeo.computeVertexNormals();

    // Sleek 4-sided faceted dark obsidian crown horn spire (sharp forged edges)
    const rawSpike = new THREE.ConeGeometry(0.023, 0.27, 4);
    rawSpike.translate(0, 0.135, 0);
    rawSpike.scale(0.54, 1.0, 1.32);
    this.spikeGeo = rawSpike.toNonIndexed();
    this.spikeGeo.computeVertexNormals();

    // Compact floating obsidian diamond monolith for Sovereign Boss Halos
    this.haloShardGeo = new THREE.OctahedronGeometry(0.032, 0);
    this.haloShardGeo.scale(0.65, 2.2, 0.55);
    this.haloShardGeo.computeVertexNormals();

    // Sculpted angular Gothic spaulder plate (low-profile ridged deltoid armor + sharp outer wing tip, L/R mirrored normals)
    const buildPauldronGeo = (side) => {
      const s = side;
      const pts = [
        // Row 0: Front deltoid apron (+Z)
        -0.042 * s,  0.022,  0.064,
         0.026 * s,  0.020,  0.084,
         0.086 * s, -0.018,  0.074,
         0.106 * s, -0.062,  0.038,
        // Row 1: Raised central Gothic spine ridge
        -0.048 * s,  0.056, -0.004,
         0.024 * s,  0.068, -0.004,
         0.096 * s,  0.030, -0.008,
         0.136 * s, -0.040, -0.014,
        // Row 2: Swept-back scapula bevel (-Z)
        -0.042 * s,  0.020, -0.070,
         0.026 * s,  0.018, -0.090,
         0.088 * s, -0.020, -0.080,
         0.110 * s, -0.064, -0.048,
      ];
      const idx = [];
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          const i00 = r * 4 + c;
          const i01 = i00 + 1;
          const i10 = (r + 1) * 4 + c;
          const i11 = i10 + 1;
          if (s > 0) {
            idx.push(i00, i01, i11, i00, i11, i10);
          } else {
            idx.push(i00, i11, i01, i00, i10, i11);
          }
        }
      }
      const raw = new THREE.BufferGeometry();
      raw.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      raw.setIndex(idx);
      const faceted = raw.toNonIndexed();
      faceted.computeVertexNormals();
      return faceted;
    };
    this.pauldronGeoL = buildPauldronGeo(1);
    this.pauldronGeoR = buildPauldronGeo(-1);

    const buildPauldronSeamGeo = (side) => {
      const s = side;
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            -0.038 * s,  0.059, -0.001,
            -0.038 * s,  0.059, -0.007,
             0.024 * s,  0.071, -0.001,
             0.024 * s,  0.071, -0.007,
             0.094 * s,  0.033, -0.005,
             0.094 * s,  0.033, -0.011,
             0.130 * s, -0.034, -0.012,
             0.130 * s, -0.034, -0.016,
          ],
          3
        )
      );
      g.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 4, 6, 5, 5, 6, 7]);
      g.computeVertexNormals();
      return g;
    };
    this.pauldronSeamGeoL = buildPauldronSeamGeo(1);
    this.pauldronSeamGeoR = buildPauldronSeamGeo(-1);

    // 4-pointed Abyssal Star Chest Bezel (matching 01_51_44.png chest star)
    const starShape = new THREE.Shape();
    starShape.moveTo(0, 0.145);
    starShape.lineTo(0.024, 0.026);
    starShape.lineTo(0.108, 0);
    starShape.lineTo(0.024, -0.026);
    starShape.lineTo(0, -0.165);
    starShape.lineTo(-0.024, -0.026);
    starShape.lineTo(-0.108, 0);
    starShape.lineTo(-0.024, 0.026);
    starShape.closePath();
    this.chestStarGeo = new THREE.ExtrudeGeometry(starShape, {
      depth: 0.016,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.007,
      bevelThickness: 0.007,
    });
    this.chestStarGeo.center();

    this.coreGemGeo = new THREE.OctahedronGeometry(0.038, 0);

    // Tier 2 Sculpted Gothic Pointed Hexagonal Obsidian Buckler
    const aegis = new THREE.Shape();
    aegis.moveTo(0, 0.28);
    aegis.lineTo(0.155, 0.18);
    aegis.lineTo(0.17, -0.05);
    aegis.lineTo(0, -0.30);
    aegis.lineTo(-0.17, -0.05);
    aegis.lineTo(-0.155, 0.18);
    aegis.closePath();
    this.shieldGeo = new THREE.ExtrudeGeometry(aegis, {
      depth: 0.022,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.012,
      bevelThickness: 0.011,
    });
    this.shieldGeo.center();

    // Slim greatsword fuller energy core (aligned with SwordBase +Y)
    this.bladeAuraGeo = new THREE.OctahedronGeometry(1, 0);
  }

  _spawnAll() {
    for (let i = 0; i < ENEMY_SPAWNS.length; i++) {
      const cfg = ENEMY_SPAWNS[i];
      const isBoss = !!cfg.objective || cfg.tier === 3;
      const root = new THREE.Group();
      root.name = `Sentinel_${i}_${cfg.tier}`;
      root.position.fromArray(cfg.pos);
      this.scene.add(root);

      const ringColor = cfg.objective ? 0xff2468 : cfg.tier === 3 ? 0xd938ff : 0x8b3dff;
      const ring = new THREE.Mesh(
        isBoss ? this.bossRingGeo : this.ringGeo,
        new THREE.MeshBasicMaterial({
          color: ringColor,
          transparent: true,
          opacity: isBoss ? 0.58 : 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      root.add(ring);

      const innerRing = new THREE.Mesh(
        this.innerRingGeo,
        new THREE.MeshBasicMaterial({
          color: cfg.objective ? 0xff9ec4 : 0xc978ff,
          transparent: true,
          opacity: isBoss ? 0.42 : 0.20,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      innerRing.rotation.x = -Math.PI / 2;
      innerRing.position.y = 0.036;
      root.add(innerRing);

      const contact = new THREE.Mesh(this.contactGeo, this.contactMat);
      contact.rotation.x = -Math.PI / 2;
      contact.scale.setScalar(isBoss ? 1.32 : 1.05);
      contact.position.y = 0.016;
      root.add(contact);

      const reach = cfg.tier === 3 ? 2.75 : 2.35;
      const tell = new THREE.Mesh(
        new THREE.RingGeometry(0.45, reach, 36, 1, Math.PI * 1.16, Math.PI * 0.68),
        new THREE.MeshBasicMaterial({
          color: 0xff1e5a,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      tell.rotation.x = -Math.PI / 2;
      tell.position.y = 0.048;
      root.add(tell);

      this.enemies.push({
        id: i,
        name: cfg.name,
        tier: cfg.tier,
        objective: !!cfg.objective,
        objectiveName: cfg.objective || '',
        maxHp: cfg.hp,
        hp: cfg.hp,
        trailHp: cfg.hp,
        trailDelay: 0,
        lastHitTime: -999,
        radius: isBoss ? 0.44 : 0.36,
        spawnPos: root.position.clone(),
        position: root.position,
        yaw: Math.PI,
        state: 'patrol',
        stateTimer: 0,
        stateElapsed: 0,
        attackCooldown: 1.4 + (i % 3) * 0.35,
        hitFlash: 0,
        dead: false,
        disabled: false,
        respawnTimer: 0,
        hitApplied: false,
        slashFxApplied: false,
        attackReach: reach,
        scale: cfg.objective ? 1.30 : cfg.tier === 3 ? 1.24 : cfg.tier === 2 ? 1.11 : 1.02,
        parts: { root, body: null, groundRing: ring, innerRing, contact, tell, halo: null, core: null },
        actions: {},
        mixer: null,
        flashUniform: { value: 0 },
        signalUniform: { value: 0 },
        timeUniform: { value: 0 },
      });
    }
  }

  async load(mapScene) {
    const gltf = await new GLTFLoader().loadAsync(assetUrl('models/abyss-sentinel.glb'));
    this.clips = gltf.animations.map((clip) => {
      const copy = clip.clone();
      for (const track of copy.tracks) {
        if (track.name !== 'Root.position') continue;
        const x = track.values[0];
        const z = track.values[2];
        for (let j = 0; j < track.values.length; j += 3) {
          track.values[j] = x;
          track.values[j + 2] = z;
        }
      }
      return copy;
    });

    for (const e of this.enemies) {
      const model = cloneSkeleton(gltf.scene);
      model.name = `Sentinel_${e.id}_SkinnedBody`;
      model.scale.setScalar(e.scale);
      const isBoss = e.objective || e.tier === 3;

      model.traverse((obj) => {
        if (!obj.isMesh) return;
        const mat = obj.material.clone();
        mat.color.setHex(0xffffff);
        mat.roughness = 0.34;
        mat.metalness = 0.76;
        mat.envMapIntensity = 1.38;
        mat.emissive.setHex(0x000000);
        if (mat.map) mat.map.anisotropy = 8;
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uSentinelFlash = e.flashUniform;
          shader.uniforms.uSentinelSignal = e.signalUniform;
          shader.uniforms.uSentinelTime = e.timeUniform;

          // 1. Bind-pose vertex pass: collapse 100% of human head & back-hair inside the enclosed Obsidian Full Helm
          shader.vertexShader =
            `varying vec3 vBindPos;
             varying float vHeadMask;\n` +
            shader.vertexShader.replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
               vBindPos = position;
               float headMask = smoothstep(1.482, 1.545, position.y) * (1.0 - smoothstep(0.19, 0.25, abs(position.x)));
               vec3 headCore = vec3(0.0, 1.595, 0.002);
               transformed = mix(transformed, headCore + (transformed - headCore) * 0.05, headMask);
               vHeadMask = headMask;`
            );

          shader.fragmentShader =
            `uniform float uSentinelFlash;
             uniform float uSentinelSignal;
             uniform float uSentinelTime;
             varying vec3 vBindPos;
             varying float vHeadMask;\n` +
            shader.fragmentShader
              .replace(
                '#include <map_fragment>',
                `#include <map_fragment>
                 vec3 origCol = diffuseColor.rgb;
                 float origLum = dot(origCol, vec3(0.299, 0.587, 0.114));

                 // Selective crimson filigree mask from armor/greatsword texture + razor-thin abyssal fissure seams
                 float redMark = smoothstep(1.38, 2.75, origCol.r / (origCol.g + origCol.b + 0.022)) * smoothstep(0.09, 0.34, origCol.r);
                 float waveA = abs(sin(vBindPos.y * 24.0 + sin(vBindPos.x * 18.0 + vBindPos.z * 12.0) * 1.5));
                 float crackLine = smoothstep(0.045, 0.005, waveA) * smoothstep(0.36, 1.46, vBindPos.y) * (1.0 - smoothstep(1.46, 1.52, vBindPos.y));
                 float seamMask = clamp(redMark + crackLine * 0.48, 0.0, 1.0);

                 // Authentic forged charcoal-black obsidian armor preserving painted plate highlights & AO (like 01_51_44.png)
                 vec3 darkObsidian = vec3(0.020, 0.019, 0.032) + origLum * ${isBoss ? 'vec3(0.76, 0.70, 0.86)' : 'vec3(0.72, 0.74, 0.94)'};
                 vec3 seamAlbedo = ${isBoss ? 'vec3(0.68, 0.08, 0.26)' : 'vec3(0.38, 0.12, 0.82)'};
                 diffuseColor.rgb = mix(darkObsidian, seamAlbedo, seamMask) * (1.0 - vHeadMask * 0.94);
                 diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.88, 0.94), uSentinelFlash * 0.78);`
              )
              .replace(
                '#include <roughnessmap_fragment>',
                `#include <roughnessmap_fragment>
                 roughnessFactor = clamp(0.24 + (1.0 - origLum) * 0.26 - seamMask * 0.12, 0.18, 0.54);`
              )
              .replace(
                '#include <emissivemap_fragment>',
                `#include <emissivemap_fragment>
                 // Selective glowing abyssal armor seams + runic greatsword fuller (NEVER flooding body armor!)
                 float isSword = smoothstep(-0.56, -0.64, vBindPos.x) * smoothstep(1.36, 1.22, vBindPos.y);
                 float bladeAxis = abs(vBindPos.x - (-0.731));
                 float swordFuller = isSword * exp(-bladeAxis * 74.0) * (0.82 + 0.18 * sin(uSentinelTime * 4.6 - vBindPos.y * 6.0));

                 vec3 energyCol = ${isBoss ? 'vec3(1.75, 0.12, 0.48)' : 'vec3(1.02, 0.22, 1.98)'};
                 float seamPulse = 0.86 + 0.14 * sin(uSentinelTime * 3.6 + float(${e.id}) * 1.1);
                 float windupBoost = 1.0 + uSentinelSignal * 1.75;

                 // Subtle cold moonlight/abyssal grazing rim for crisp dark-on-dark silhouette readability
                 float viewRim = pow(1.0 - clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0), 4.2);
                 vec3 rimCol = ${isBoss ? 'vec3(0.48, 0.08, 0.22)' : 'vec3(0.24, 0.12, 0.52)'};

                 totalEmissiveRadiance += energyCol * (seamMask * 0.88 * seamPulse + swordFuller * 1.15) * windupBoost * (1.0 - vHeadMask);
                 totalEmissiveRadiance += rimCol * viewRim * (0.26 + uSentinelSignal * 0.65);
                 totalEmissiveRadiance += vec3(1.15, 0.42, 0.65) * uSentinelFlash * 0.65;`
              );
        };
        mat.customProgramCacheKey = () => `sentinel-obsidian-v8-${isBoss ? 'boss' : 'std'}-${e.id % 4}`;
        obj.material = mat;
        obj.castShadow = true;
        obj.receiveShadow = true;
        // Never frustum-cull SkinnedMesh instances so enemies never vanish when bones animate!
        obj.frustumCulled = false;
      });

      e.parts.body = model;
      e.parts.root.add(model);
      e.mixer = new THREE.AnimationMixer(model);
      for (const clip of this.clips) e.actions[clip.name] = e.mixer.clipAction(clip);
      this._play(e, 'Idle', 0);
      e.mixer.update(0);
      model.updateMatrixWorld(true);
      this._addRegalia(e);
    }

    this.ready = true;
    this.reset(mapScene);
    return this;
  }

  _addRegalia(e) {
    const model = e.parts.body;
    const isBoss = e.objective || e.tier === 3;
    const armorMat = isBoss ? this.bossArmorMat : this.armorMat;
    const trimMat = isBoss ? this.bossTrimMat : this.trimMat;
    const eyeMat = isBoss ? this.eyeBossMat : this.eyeVioletMat;
    const coreMat = isBoss ? this.coreBossMat : this.coreVioletMat;
    const haloRingMat = isBoss ? this.haloRingBossMat : this.haloRingVioletMat;
    const bladeEdgeMat = isBoss ? this.bladeEdgeBossMat : this.bladeEdgeVioletMat;

    const head = model.getObjectByName('Head');
    const chest = model.getObjectByName('Chest');
    const upperArmL = model.getObjectByName('UpperArm_L');
    const upperArmR = model.getObjectByName('UpperArm_R');
    const foreArmL = model.getObjectByName('ForeArm_L');
    const swordBase = model.getObjectByName('SwordBase');

    // 1. Enclosed Faceted Gothic Great-Helm + Flush Slanted Eyes + Swept Dark Obsidian Crown Spires
    // Head local space: +X = left, +Y = up, +Z = forward
    if (head) {
      const helm = new THREE.Group();
      helm.position.set(0, 0.040, -0.002);
      helm.scale.setScalar(1.04);

      const dome = new THREE.Mesh(this.helmDomeGeo, armorMat);
      dome.castShadow = true;
      helm.add(dome);

      const faceplate = new THREE.Mesh(this.faceplateGeo, trimMat);
      faceplate.position.set(0, 0.002, 0.004);
      faceplate.castShadow = true;
      helm.add(faceplate);

      // Thin glowing vertical rune seam + 3D swept V-brow seam + back occipital keel seam
      const helmSeam = new THREE.Mesh(this.helmSeamGeo, coreMat);
      helmSeam.position.set(0, 0.026, 0.125);
      helm.add(helmSeam);

      const browSeam = new THREE.Mesh(this.browSeamGeo, coreMat);
      browSeam.position.set(0, 0.002, 0.004);
      helm.add(browSeam);

      const backSeam = new THREE.Mesh(this.helmSeamGeo, haloRingMat);
      backSeam.position.set(0, 0.028, -0.103);
      backSeam.rotation.y = Math.PI;
      helm.add(backSeam);

      // Slanted fierce glowing ocular slits sitting flush along the 37° V-visor slope
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(this.eyeSlitGeo, eyeMat);
        eye.position.set(side * 0.039, 0.022, 0.095);
        eye.scale.x = side;
        eye.rotation.y = side * 0.62;
        eye.rotation.z = -side * 0.18;
        helm.add(eye);
      }

      // Towering swept-upward dark forged obsidian crown spires (matching 01_51_44.png silhouette)
      const hornLen = isBoss ? 1.14 : e.tier === 2 ? 0.98 : 0.86;
      for (const side of [-1, 1]) {
        const outerHorn = new THREE.Mesh(this.spikeGeo, trimMat);
        outerHorn.position.set(side * 0.068, 0.048, 0.004);
        outerHorn.rotation.set(-0.24, side * 0.16, -side * 0.18);
        outerHorn.scale.set(1.05, hornLen, 1.12);
        outerHorn.castShadow = true;
        helm.add(outerHorn);

        const innerHorn = new THREE.Mesh(this.spikeGeo, armorMat);
        innerHorn.position.set(side * 0.036, 0.106, 0.016);
        innerHorn.rotation.set(-0.18, 0, -side * 0.08);
        innerHorn.scale.set(0.84, hornLen * 0.90, 0.96);
        innerHorn.castShadow = true;
        helm.add(innerHorn);

        const cheekHorn = new THREE.Mesh(this.spikeGeo, armorMat);
        cheekHorn.position.set(side * 0.076, -0.006, 0.014);
        cheekHorn.rotation.set(-0.34, 0, -side * 0.34);
        cheekHorn.scale.set(0.70, hornLen * (e.tier >= 2 ? 0.64 : 0.48), 0.82);
        helm.add(cheekHorn);
      }

      // Central sagittal crest + swept occipital dorsal fin
      const centerCrest = new THREE.Mesh(this.spikeGeo, trimMat);
      centerCrest.position.set(0, 0.132, 0.008);
      centerCrest.rotation.x = -0.22;
      centerCrest.scale.set(0.76, isBoss ? 1.08 : 0.80, 1.22);
      helm.add(centerCrest);

      const backCrest = new THREE.Mesh(this.spikeGeo, armorMat);
      backCrest.position.set(0, 0.048, -0.082);
      backCrest.rotation.x = -0.78;
      backCrest.scale.set(0.72, 0.62, 1.10);
      helm.add(backCrest);

      head.add(helm);
    }

    // 2. Articulated 3-Lame Faceted Gothic Shoulder Spaulders (low-profile, sharp outer wing tip, 100% L/R symmetrical)
    const modelQuat = model.getWorldQuaternion(new THREE.Quaternion());
    const addPauldron = (bone, isLeft) => {
      if (!bone) return;
      const side = isLeft ? 1 : -1;
      const pGeo = isLeft ? this.pauldronGeoL : this.pauldronGeoR;
      const pSeamGeo = isLeft ? this.pauldronSeamGeoL : this.pauldronSeamGeoR;
      const pGroup = new THREE.Group();
      const pScale = isBoss ? 1.14 : e.tier === 2 ? 1.04 : 0.95;

      // Align pGroup local frame with model frame (+X = left, +Y = up, +Z = forward) regardless of arm bone roll
      const invBoneQuat = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
      pGroup.quaternion.copy(invBoneQuat).multiply(modelQuat);
      pGroup.position.set(side * 0.012, 0.012, 0.002).applyQuaternion(pGroup.quaternion);
      pGroup.scale.setScalar(pScale);

      const cap = new THREE.Mesh(pGeo, armorMat);
      cap.rotation.z = -side * 0.10;
      cap.castShadow = true;
      pGroup.add(cap);

      const upperPlate = new THREE.Mesh(pGeo, trimMat);
      upperPlate.scale.set(0.78, 0.84, 0.78);
      upperPlate.position.set(-side * 0.014, 0.022, 0);
      upperPlate.rotation.z = side * 0.08;
      pGroup.add(upperPlate);

      const lowerLame = new THREE.Mesh(pGeo, trimMat);
      lowerLame.scale.set(0.80, 0.76, 0.80);
      lowerLame.position.set(side * 0.024, -0.030, 0);
      lowerLame.rotation.z = -side * 0.24;
      pGroup.add(lowerLame);

      const seam = new THREE.Mesh(pSeamGeo, haloRingMat);
      seam.rotation.z = -side * 0.10;
      pGroup.add(seam);

      // Swept-back dark obsidian collar/shoulder blades along the Gothic ridge
      const spikeMain = new THREE.Mesh(this.spikeGeo, trimMat);
      spikeMain.position.set(side * 0.016, 0.056, -0.010);
      spikeMain.rotation.set(-0.28, 0, -side * 0.34);
      spikeMain.scale.set(0.82, 0.68, 0.92);
      spikeMain.castShadow = true;
      pGroup.add(spikeMain);

      const spikeOuter = new THREE.Mesh(this.spikeGeo, armorMat);
      spikeOuter.position.set(side * 0.072, 0.026, -0.012);
      spikeOuter.rotation.set(-0.26, 0, -side * 0.68);
      spikeOuter.scale.set(0.72, e.tier >= 2 ? 0.60 : 0.44, 0.84);
      pGroup.add(spikeOuter);

      bone.add(pGroup);
    };
    addPauldron(upperArmL, true);
    addPauldron(upperArmR, false);

    // 3. 4-Pointed Abyssal Star Core on Chest + Compact Regal Sovereign Halo on Bosses
    // Chest local space: +X = left, +Y = up, +Z = forward
    if (chest) {
      const starGroup = new THREE.Group();
      starGroup.position.set(0, 0.055, 0.132);

      const bezel = new THREE.Mesh(this.chestStarGeo, trimMat);
      starGroup.add(bezel);

      const coreGem = new THREE.Mesh(this.coreGemGeo, coreMat);
      coreGem.scale.set(0.82, 1.45, 0.52);
      coreGem.position.z = 0.013;
      starGroup.add(coreGem);

      chest.add(starGroup);
      e.parts.core = coreGem;

      if (isBoss) {
        // Proportional, regal Sovereign Crown Halo behind upper shoulders (never blocks melee camera!)
        const halo = new THREE.Group();
        halo.position.set(0, 0.17, -0.13);

        const outerIronRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.245, 0.008, 6, 36),
          trimMat
        );
        halo.add(outerIronRing);

        const innerRuneRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.228, 0.0045, 6, 36),
          haloRingMat
        );
        halo.add(innerRuneRing);

        for (let k = 0; k < 5; k++) {
          const ang = Math.PI * 0.08 + (k / 4) * Math.PI * 0.84;
          const shard = new THREE.Mesh(this.haloShardGeo, k === 2 ? coreMat : trimMat);
          shard.position.set(Math.cos(ang) * 0.275, Math.sin(ang) * 0.275, 0);
          shard.rotation.z = ang - Math.PI * 0.5;
          shard.scale.setScalar(e.objective ? 1.15 : 0.95);
          halo.add(shard);
        }
        chest.add(halo);
        e.parts.halo = halo;
      }
    }

    // 4. Subtle Runic Fuller Core on the Sculpted Abyssal Greatsword
    // SwordBase local space: +Y runs collinearly down the greatsword blade (0 -> 0.98m)
    if (swordBase) {
      const aura = new THREE.Mesh(this.bladeAuraGeo, bladeEdgeMat);
      aura.position.set(0, 0.48, 0);
      aura.scale.set(0.016, 0.46, 0.008);
      swordBase.add(aura);
    }

    // 5. Tier 2 Heavy Abyssal Knights (non-Seal): Sleek Gothic Pointed Obsidian Buckler on ForeArm_L
    // ForeArm_L local space: +Y = elbow->wrist, +Z = outer forearm face
    if (e.tier === 2 && !e.objective && foreArmL) {
      const shield = new THREE.Group();
      shield.position.set(0.01, 0.13, 0.068);
      shield.rotation.x = Math.PI * 0.5;
      shield.rotation.z = Math.PI * 0.5;

      const body = new THREE.Mesh(this.shieldGeo, armorMat);
      body.castShadow = true;
      shield.add(body);

      const rimPlate = new THREE.Mesh(this.shieldGeo, trimMat);
      rimPlate.scale.set(0.84, 0.86, 1.05);
      shield.add(rimPlate);

      const emblem = new THREE.Mesh(this.chestStarGeo, coreMat);
      emblem.scale.setScalar(0.68);
      emblem.position.z = 0.018;
      shield.add(emblem);

      foreArmL.add(shield);
      e.parts.shield = shield;
    }
  }

  _play(e, name, fade = 0.12, rate = 1, start = 0) {
    const action = e.actions[name];
    if (!action) return;
    if (e.currentAction === action && !['Attack1', 'Hit', 'Death'].includes(name)) {
      action.setEffectiveTimeScale(rate);
      return;
    }
    e.currentAction?.fadeOut(fade);
    action.reset().setEffectiveWeight(1).setEffectiveTimeScale(rate);
    action.setLoop(
      ['Idle', 'Walk', 'Run'].includes(name) ? THREE.LoopRepeat : THREE.LoopOnce,
      Infinity
    );
    action.clampWhenFinished = true;
    action.time = start;
    action.fadeIn(fade).play();
    e.currentAction = action;
  }

  _state(e, state, duration = 0) {
    e.state = state;
    e.stateElapsed = 0;
    e.stateTimer = duration;
    e.parts.tell.visible = state === 'windup' || state === 'slash';
    if (state === 'windup') {
      e.hitApplied = false;
      e.slashFxApplied = false;
      this._play(e, 'Attack1', 0.15, 0, 0.12);
    } else if (state === 'slash') {
      this._play(e, 'Attack1', 0.035, 1.1, 0.12);
      this.audio?.playSwing(0);
    } else if (state === 'recover') {
      this._play(e, 'Idle', 0.16);
    } else if (state === 'hit') {
      this._play(e, 'Hit', 0.05, 1.25);
    } else if (state === 'dead') {
      this._play(e, 'Death', 0.08, 1);
    } else {
      this._play(e, state === 'chase' ? 'Run' : state === 'return' ? 'Walk' : 'Idle');
    }
  }

  reset(mapScene) {
    this.attackGap = 1.0;
    this.attackSerial = 0;
    this.defeated = 0;
    for (const e of this.enemies) {
      const cfg = ENEMY_SPAWNS[e.id];
      const spawn = this._safeSpawn(mapScene, cfg.pos[0], cfg.pos[2], cfg.pos[1]);
      e.disabled = !spawn;
      e.dead = false;
      e.hp = e.maxHp;
      e.trailHp = e.maxHp;
      e.trailDelay = 0;
      e.lastHitTime = -999;
      e.respawnTimer = 0;
      if (spawn) {
        e.spawnPos.copy(spawn);
        e.position.copy(spawn);
      }
      e.parts.root.visible = !!spawn;
      e.parts.root.scale.setScalar(1);
      e.parts.root.rotation.y = Math.PI;
      e.parts.body?.position.set(0, 0, 0);
      e.parts.body?.scale.setScalar(e.scale);
      e.mixer?.stopAllAction();
      e.currentAction = null;
      e.parts.groundRing.visible = true;
      e.parts.innerRing.visible = true;
      e.parts.contact.visible = true;
      e.yaw = Math.PI;
      e.hitFlash = 0;
      e.attackCooldown = 1.4 + (e.id % 3) * 0.35;
      e.flashUniform.value = 0;
      e.signalUniform.value = 0;
      this._state(e, 'patrol');
      e.mixer?.update(0);
    }
  }

  _safeSpawn(map, x, z, y) {
    if (!map) return new THREE.Vector3(x, y, z);
    const direct = map.sampleGround(x, z);
    if (direct.height > -1000 && Math.abs(direct.height - y) <= 2.5) {
      return new THREE.Vector3(x, direct.height, z);
    }
    if (map.findWalkablePosition) {
      const found = map.findWalkablePosition(x, z, 12, 0.35, y);
      if (found) {
        return found.isVector3
          ? found.clone()
          : new THREE.Vector3(found.x, found.y ?? found.height ?? y, found.z);
      }
    }
    return new THREE.Vector3(x, y, z);
  }

  damageEnemy(enemy, amount, type = 'slash') {
    if (!enemy || enemy.dead || enemy.disabled || !(amount > 0)) return false;
    enemy.trailHp = Math.max(enemy.trailHp ?? enemy.hp, enemy.hp);
    enemy.trailDelay = 0.34;
    enemy.hp = Math.max(0, enemy.hp - amount);
    enemy.hitFlash = 0.22;
    enemy.lastHitTime = performance.now() * 0.001;
    _anchor.copy(enemy.position).y += 1.15;
    this.fx.emitSparks(_anchor, enemy.hp <= 0 ? 42 : 20, {
      color1: type === 'nix' ? 0x38c6ff : type === 'magic' ? 0xff1744 : 0xd85cff,
      color2: type === 'nix' ? 0xd9fbff : 0xffeef6,
      speed: 7.8,
      size: 1.1,
    });
    this.fx.spawnShockwave(enemy.position, type === 'nix' ? 0x69dfff : type === 'magic' ? 0xff1744 : 0xb838ff, 2.0, 0.28);
    this.audio?.playHit();

    if (enemy.hp <= 0) {
      enemy.dead = true;
      enemy.respawnTimer = enemy.objective ? 28.0 : 16.0;
      this.defeated++;
      this._state(enemy, 'dead', 1.8);
      enemy.attackCooldown = Infinity;
      if (type === 'nix') this.fx.spawnShockwave(enemy.position, 0x8deaff, 2.8, .6);
      else this.fx.spawnCrimsonExplosion(enemy.position.clone().add(new THREE.Vector3(0, 0.9, 0)));
    } else {
      // The familiar can damage an enemy preparing a swing, but cannot
      // repeatedly cancel its committed attack and protect the player forever.
      if (!(type === 'nix' && (enemy.state === 'windup' || enemy.state === 'slash'))) {
        this._state(enemy, 'hit', type === 'nix' ? 0.18 : type === 'magic' ? 0.45 : 0.26);
        enemy.attackCooldown = Math.max(enemy.attackCooldown, 0.6);
      }
    }
    return true;
  }

  getClosestTarget(playerPos, maxDist = 24) {
    let best = null;
    let bestDist = maxDist;
    for (const e of this.enemies) {
      if (e.dead || e.disabled || Math.abs(e.position.y - playerPos.y) > 3.5) continue;
      const d = e.position.distanceTo(playerPos);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  _move(e, direction, distance, map, player) {
    if (distance <= 0.0001) return false;
    let moved = false;
    const steps = Math.max(1, Math.ceil(distance / 0.16));
    for (let i = 0; i < steps; i++) {
      const dx = (direction.x * distance) / steps;
      const dz = (direction.z * distance) / steps;
      let accepted = false;
      for (const [sx, sz] of [
        [dx, dz],
        [dx, 0],
        [0, dz],
      ]) {
        if (Math.abs(sx) + Math.abs(sz) < 0.00001) continue;
        const nx = e.position.x + sx;
        const nz = e.position.z + sz;
        const ground = map.sampleGround(nx, nz);
        if (ground.height < -1000 || Math.abs(ground.height - e.position.y) > 0.95) continue;
        if (
          player &&
          Math.abs(player.position.y - e.position.y) < 1.6 &&
          Math.hypot(nx - player.position.x, nz - player.position.z) < 0.85
        ) {
          continue;
        }
        let blocked = false;
        for (const other of this.enemies) {
          if (
            other === e ||
            other.dead ||
            other.disabled ||
            Math.abs(other.position.y - e.position.y) > 1.5
          ) {
            continue;
          }
          if (Math.hypot(nx - other.position.x, nz - other.position.z) < 0.78) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        e.position.x = nx;
        e.position.z = nz;
        e.position.y = ground.height;
        accepted = true;
        moved = true;
        break;
      }
      if (!accepted) break;
    }
    return moved;
  }

  update(dt, elapsed, player, mapScene, callbacks) {
    if (!this.ready) return;
    this.attackGap = Math.max(0, this.attackGap - dt);
    const playerDead = player.hp <= 0 || player.state === 'Death';
    const overview = !!window.__GAME__?.cameraCtrl?.presetIndex;

    for (const e of this.enemies) {
      if (e.disabled) continue;
      e.stateElapsed += dt;
      e.stateTimer = Math.max(0, e.stateTimer - dt);
      e.attackCooldown = Math.max(0, e.attackCooldown - dt);
      e.timeUniform.value = elapsed;

      // Smooth delayed damage-trail bar decay
      if (e.trailDelay > 0) {
        e.trailDelay = Math.max(0, e.trailDelay - dt);
      } else if (e.trailHp > e.hp) {
        e.trailHp = Math.max(e.hp, e.trailHp - e.maxHp * 0.95 * dt);
      } else {
        e.trailHp = e.hp;
      }

      const distance = e.position.distanceTo(player.position);
      e.parts.root.visible = distance < 110 || overview;
      const castShadow = distance < 32;
      if (e.shadowActive !== castShadow) {
        e.parts.body?.traverse((obj) => {
          if (obj.isMesh) obj.castShadow = castShadow;
        });
        e.shadowActive = castShadow;
      }
      if (distance < 55 || overview || (e.dead && e.stateElapsed < 2)) {
        e.mixer?.update(dt);
      }

      if (e.dead) {
        e.parts.groundRing.visible = false;
        e.parts.innerRing.visible = false;
        e.parts.contact.visible = e.stateElapsed < 1.7;
        if (e.stateElapsed > 1.25) {
          const scale = Math.max(0, 1 - (e.stateElapsed - 1.25) / 0.6);
          e.parts.root.scale.setScalar(scale);
          if (scale <= 0) e.parts.root.visible = false;
        }
        // Respawn non-objective enemies so the citadel never feels empty
        if (!e.objective) {
          e.respawnTimer -= dt;
          if (e.respawnTimer <= 0) {
            e.dead = false;
            e.hp = e.maxHp;
            e.trailHp = e.maxHp;
            e.position.copy(e.spawnPos);
            e.parts.root.visible = true;
            e.parts.root.scale.setScalar(1);
            e.parts.groundRing.visible = true;
            e.parts.innerRing.visible = true;
            e.parts.contact.visible = true;
            this._state(e, 'patrol');
            this.fx.spawnShockwave(e.position, 0xb838ff, 2.2, 0.35);
          }
        }
        continue;
      }

      const isBoss = e.objective || e.tier === 3;
      e.parts.groundRing.visible = (isBoss ? distance < 48 : distance < 28) || overview;
      e.parts.innerRing.visible = isBoss && distance < 36;
      e.parts.groundRing.rotation.z = elapsed * 1.2 + e.id;
      e.parts.innerRing.rotation.z = -elapsed * 1.9 - e.id;
      e.parts.groundRing.material.opacity = e.objective
        ? 0.58 + 0.16 * Math.sin(elapsed * 4 + e.id)
        : isBoss
          ? 0.42 + 0.12 * Math.sin(elapsed * 3.2 + e.id)
          : 0.22 + 0.08 * Math.sin(elapsed * 2.8 + e.id);

      if (e.parts.halo) {
        e.parts.halo.rotation.z = Math.sin(elapsed * 1.2 + e.id) * 0.14;
      }

      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.flashUniform.value = e.hitFlash / 0.22;
      e.signalUniform.value = e.state === 'windup' ? 0.95 : 0.22 + 0.14 * Math.sin(elapsed * 3 + e.id);

      const ground = mapScene.sampleGround(e.position.x, e.position.z);
      if (ground.height > -1000) {
        e.position.y = ground.height;
      } else {
        e.position.copy(e.spawnPos);
        this._state(e, 'patrol');
      }

      _toward.subVectors(player.position, e.position);
      _toward.y = 0;
      const dist = _toward.length();
      const homeDistance = Math.hypot(e.position.x - e.spawnPos.x, e.position.z - e.spawnPos.z);
      const aggro = e.tier === 3 ? 16 : 13.5;
      const heightMatch = Math.abs(player.position.y - e.position.y) < 2.4;
      if (playerDead && !['patrol', 'return'].includes(e.state)) {
        this._state(e, 'return');
      }

      if (e.state === 'hit') {
        if (e.stateTimer <= 0) this._state(e, 'chase');
      } else if (e.state === 'windup') {
        const progress = e.stateElapsed / (e.tier === 3 ? 0.85 : 0.75);
        if (progress < 0.62) {
          e.yaw += angularDelta(e.yaw, Math.atan2(_toward.x, _toward.z)) * Math.min(1, dt * 7);
        }
        e.parts.tell.material.opacity = 0.14 + Math.min(1, progress) * 0.34;
        e.parts.tell.scale.setScalar(0.85 + Math.min(1, progress) * 0.15);
        if (e.stateTimer <= 0) this._state(e, 'slash', 0.45);
      } else if (e.state === 'slash') {
        e.parts.tell.material.opacity = Math.max(0, 0.34 - e.stateElapsed * 0.9);
        if (!e.slashFxApplied && e.stateElapsed >= 0.10) {
          e.slashFxApplied = true;
          _forward.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
          _anchor.copy(e.position).addScaledVector(_forward, 1.15);
          _anchor.y += 1.0;
          this.fx.emitSparks(_anchor, isBoss ? 22 : 12, {
            color1: isBoss ? 0xff1e62 : 0xb938ff,
            color2: 0xffd6ec,
            speed: 6.2,
            dir: _forward,
            size: 0.95,
            life: 0.34,
          });
        }
        if (!e.hitApplied && e.stateElapsed >= 0.14) {
          e.hitApplied = true;
          _forward.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
          const inCone = dist < 0.75 || _toward.normalize().dot(_forward) > Math.cos(Math.PI * 0.36);
          if (!playerDead && heightMatch && dist < e.attackReach + 0.18 && inCone) {
            const amount = 75 + e.tier * 25;
            const applied = player.takeDamage(amount);
            if (applied !== false && applied !== 0) {
              callbacks?.onPlayerDamaged?.(typeof applied === 'number' ? applied : amount);
            }
          }
        }
        if (e.stateTimer <= 0) {
          this._state(e, 'recover', e.tier === 3 ? 0.95 : 0.85);
          e.attackCooldown = 1.5 + e.tier * 0.12;
        }
      } else if (e.state === 'recover') {
        if (e.stateTimer <= 0) this._state(e, 'chase');
      } else if (!playerDead && heightMatch && dist < aggro && homeDistance < 22) {
        if (e.state !== 'chase') this._state(e, 'chase');
        e.yaw += angularDelta(e.yaw, Math.atan2(_toward.x, _toward.z)) * Math.min(1, dt * 7);
        if (dist > 1.75 + e.tier * 0.05) {
          _toward.normalize();
          const speed = e.tier === 2 ? 2.6 : e.tier === 3 ? 2.9 : 3.1;
          if (this._move(e, _toward, speed * dt, mapScene, player)) {
            this._play(e, 'Run', 0.14, speed / 2.5);
          } else {
            this._play(e, 'Idle');
          }
        } else {
          this._play(e, 'Idle');
          const committed = this.enemies.filter(
            (other) => !other.dead && ['windup', 'slash'].includes(other.state)
          ).length;
          if (this.attackGap <= 0 && e.attackCooldown <= 0 && committed < 2 && player.grounded) {
            this._state(e, 'windup', e.tier === 3 ? 0.85 : 0.75);
            this.attackGap = 0.85;
            this.attackSerial++;
          }
        }
      } else if (homeDistance > 0.6) {
        if (e.state !== 'return') this._state(e, 'return');
        _step.subVectors(e.spawnPos, e.position);
        _step.y = 0;
        _step.normalize();
        e.yaw += angularDelta(e.yaw, Math.atan2(_step.x, _step.z)) * Math.min(1, dt * 5);
        this._move(e, _step, Math.min(2.6 * dt, homeDistance), mapScene, player);
      } else {
        if (e.state !== 'patrol') this._state(e, 'patrol');
        if (heightMatch && dist < 22) {
          e.yaw += angularDelta(e.yaw, Math.atan2(_toward.x, _toward.z)) * Math.min(1, dt * 2.2);
        }
      }
      e.parts.root.rotation.y = e.yaw;
    }
  }
}
