import * as THREE from 'three';
import { assetUrl } from '../assetUrl.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { cutMasonryPassage } from './PassageGeometry.js';
import { AbyssAtmosphere } from './AbyssAtmosphere.js';

export class MapScene {
  constructor(scene, renderer = null) {
    this.scene = scene;
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.root.name = 'CiudadelaAbismo';
    this.scene.add(this.root);

    this.shaderUniforms = {
      uTime: { value: 0 },
      uPlayerPos: { value: new THREE.Vector3(0, 8.2, 79.8) },
    };

    this.collision = null;
    this.worldData = null;
    this.floatingChunks = [];
    this.animatedObjects = [];
    this.portals = [];
    this.violetLights = [];
    this.cameraTrace = new THREE.Vector3();
    this.staticMeshes = [];
    this.walkwaySegments = [];
    this._lastLightSelection = -1;
  }

  async load(onProgress = () => {}) {
    onProgress('Cargando topografía y colisiones del abismo…', 0.15);
    const [worldRes, colMetaRes, colBinRes] = await Promise.all([
      fetch(assetUrl('data/world.json')),
      fetch(assetUrl('data/collision.json')),
      fetch(assetUrl('data/collision.bin')),
    ]);
    this.worldData = await worldRes.json();
    const colMeta = await colMetaRes.json();
    const colBuf = await colBinRes.arrayBuffer();
    const count = colMeta.w * colMeta.h;
    this.collision = {
      ...colMeta,
      heights: new Float32Array(colBuf, 0, count),
      flags: new Uint8Array(colBuf, count * 4, count),
    };

    onProgress('Cargando texturas PBR de piedra tallada, pizarra gótica y basalto abisal…', 0.32);
    const texLoader = new THREE.TextureLoader();
    const [
      flagColor,
      flagNormal,
      flagRough,
      stoneColor,
      stoneNormal,
      stoneRough,
      basaltColor,
      basaltNormal,
      basaltRough,
      basaltVeins,
    ] = await Promise.all([
      texLoader.loadAsync(assetUrl('textures/flagstone_color.jpg')),
      texLoader.loadAsync(assetUrl('textures/flagstone_normal.jpg')),
      texLoader.loadAsync(assetUrl('textures/flagstone_roughness.jpg')),
      texLoader.loadAsync(assetUrl('textures/stone_color.jpg')),
      texLoader.loadAsync(assetUrl('textures/stone_normal.jpg')),
      texLoader.loadAsync(assetUrl('textures/stone_roughness.jpg')),
      texLoader.loadAsync(assetUrl('textures/basalt_color.jpg')),
      texLoader.loadAsync(assetUrl('textures/basalt_normal.jpg')),
      texLoader.loadAsync(assetUrl('textures/basalt_roughness.jpg')),
      texLoader.loadAsync(assetUrl('textures/basalt_veins.jpg')),
    ]);
    const maxAniso = Math.min(16, this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 8);
    for (const t of [flagColor, stoneColor, basaltColor]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
    }
    for (const t of [flagNormal, flagRough, stoneNormal, stoneRough, basaltNormal, basaltRough, basaltVeins]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = maxAniso;
    }

    const materials = this.createMaterials({
      flagColor,
      flagNormal,
      flagRough,
      stoneColor,
      stoneNormal,
      stoneRough,
      basaltColor,
      basaltNormal,
      basaltRough,
      basaltVeins,
    });
    this.materials = materials;
    if (this.renderer) {
      const envScene = this._buildAbyssalEnvironment();
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.environmentTarget = pmrem.fromScene(envScene, 0.035);
      this.scene.environment = this.environmentTarget.texture;
      this.scene.environmentIntensity = 0.85;
      pmrem.dispose();
    }
    this.scene.fog = new THREE.FogExp2(0x161128, 0.0028);

    onProgress('Descomprimiendo la geometría optimizada de la Ciudadela…', 0.52);
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(assetUrl('models/map-optimized.glb'));

    const mapGroup = gltf.scene;
    mapGroup.traverse((obj) => {
      if (!obj.isMesh) return;
      const [role, cxStr, czStr] = obj.name.split('|');
      const cx = parseInt(cxStr || '0', 10);
      const cz = parseInt(czStr || '0', 10);
      if (materials[role]) {
        obj.material = materials[role];
      }
      obj.castShadow = role === 'trim' || role === 'stone' || role === 'basalt';
      obj.receiveShadow = role === 'stone' || role === 'stone_light' || role === 'trim' || role === 'basalt';

      // The exported chunks split buildings and walkways at arbitrary boundaries.
      // Moving a chunk tears the architecture apart and moves it away from its collider.
      obj.frustumCulled = true;
      obj.geometry.computeBoundingSphere();
      obj.userData.role = role;
      obj.userData.chunkX = cx * 24 + 12;
      obj.userData.chunkZ = cz * 24 + 12;
      this.staticMeshes.push(obj);
    });
    this.root.add(mapGroup);

    onProgress('Invocando niebla del inframundo, núcleo astral y luces violetas…', 0.78);
    this.buildSkyAndMoon();
    this.buildAbyssOceanAndUnderworldFog();
    this.buildSanctuaryCoreFX();
    this.buildAdvancedVioletLights();
    this.buildVioletParticles();
    this.buildAstralBridgesAndPortals();
    // Open full-height masonry passages at both ends of the Axial Bridge and clean heightfield flags
    this.carveWalkablePassage(new THREE.Vector3(0, 8.2, 76.2), new THREE.Vector3(0, 8.2, 70.8), 3.6, 30);
    this.carveWalkablePassage(new THREE.Vector3(0, 8.2, 17.2), new THREE.Vector3(0, 8.2, 13.0), 3.6, 30);
    this.cleanWalkabilityGrid();

    return this;
  }

  _buildAbyssalEnvironment() {
    // Rich dark-fantasy PMREM IBL environment: moonlit silver-blue zenith, gothic twilight horizon,
    // and luminous violet-magenta abyssal sea bounce so stone, armor, blades & crystals gleam naturally.
    const env = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vDir;
          void main() {
            float y = vDir.y;
            vec3 zenith = vec3(0.20, 0.27, 0.48);
            vec3 horizon = vec3(0.18, 0.11, 0.30);
            vec3 nadir = vec3(0.42, 0.08, 0.56);
            vec3 c = y >= 0.0
              ? mix(horizon, zenith, pow(y, 0.65))
              : mix(horizon, nadir, pow(-y, 0.75));
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      })
    );
    env.add(dome);

    const addEmitter = (pos, radius, colorHex, mult) => {
      const c = new THREE.Color(colorHex).multiplyScalar(mult);
      const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(...pos);
      env.add(m);
    };
    addEmitter([-26, 42, 18], 5.5, 0xe8f1ff, 4.8);   // Cold moonlight specular highlight
    addEmitter([0, 12, -28], 6.5, 0xb86bff, 3.2);    // Sanctuary astral core bounce
    addEmitter([28, -22, 12], 8.0, 0xd81b60, 2.6);   // Crimson-magenta abyssal chasm glow
    addEmitter([-28, -20, -14], 8.0, 0x7c4dff, 2.8); // Deep violet abyssal glow
    return env;
  }

  createMaterials(tex) {
    // True world-space triplanar PBR masonry & fractured volcanic basalt with real normal maps,
    // roughness maps, chiseled bevel AO, and glowing crimson-violet cliff veins.
    const masonry = (name, cfg) => {
      const {
        colorMap,
        normalMap,
        roughMap,
        veinMap = null,
        tint = 0xffffff,
        roughness = 0.75,
        metalness = 0.06,
        envMapIntensity = 0.95,
        scale = 0.24,
        normalStrength = 1.15,
        rock = false,
      } = cfg;

      const mat = new THREE.MeshStandardMaterial({
        map: colorMap,
        color: tint,
        roughness,
        metalness,
        envMapIntensity,
      });
      mat.customProgramCacheKey = () => `citadel-pbr-v8-${name}`;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.shaderUniforms.uTime;
        shader.uniforms.uNormalTex = { value: normalMap };
        shader.uniforms.uRoughTex = { value: roughMap };
        if (veinMap) shader.uniforms.uVeinTex = { value: veinMap };

        shader.vertexShader =
          `varying vec3 vStoneWorld;
           varying vec3 vStoneNormal;
           varying vec3 vViewAxisX;
           varying vec3 vViewAxisY;
           varying vec3 vViewAxisZ;\n` +
          shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
             vStoneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
             vStoneNormal = inverseTransformDirection(transformedNormal, viewMatrix);
             vViewAxisX = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
             vViewAxisY = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
             vViewAxisZ = (viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;`
          );

        shader.fragmentShader =
          `uniform float uTime;
           uniform sampler2D uNormalTex;
           uniform sampler2D uRoughTex;
           ${veinMap ? 'uniform sampler2D uVeinTex;' : ''}
           varying vec3 vStoneWorld;
           varying vec3 vStoneNormal;
           varying vec3 vViewAxisX;
           varying vec3 vViewAxisY;
           varying vec3 vViewAxisZ;
           float stoneHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
           float stoneNoise(vec3 p) {
             vec3 i = floor(p), f = fract(p);
             f = f * f * (3.0 - 2.0 * f);
             return mix(
               mix(mix(stoneHash(i), stoneHash(i + vec3(1,0,0)), f.x), mix(stoneHash(i + vec3(0,1,0)), stoneHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(stoneHash(i + vec3(0,0,1)), stoneHash(i + vec3(1,0,1)), f.x), mix(stoneHash(i + vec3(0,1,1)), stoneHash(i + vec3(1,1,1)), f.x), f.y),
               f.z
             );
           }\n` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <map_fragment>',
            `#ifdef USE_MAP
               vec3 wN = normalize(vStoneNormal);
               vec3 blend = pow(abs(wN), vec3(5.5));
               blend /= max(blend.x + blend.y + blend.z, 0.0001);
               vec3 wp = vStoneWorld * ${scale.toFixed(4)};

               vec3 cX = texture2D(map, wp.zy).rgb;
               vec3 cY = texture2D(map, wp.xz).rgb;
               vec3 cZ = texture2D(map, wp.xy).rgb;
               vec3 triAlbedo = cX * blend.x + cY * blend.y + cZ * blend.z;

               // Multi-scale macro weathering so large plazas and cliffs never look repetitive
               float macroVar = stoneNoise(vStoneWorld * 0.085);
               float midVar = stoneNoise(vStoneWorld * 0.38);
               vec3 weatherTint = mix(vec3(0.84, 0.82, 0.94), vec3(1.14, 1.06, 0.98), macroVar);
               float wear = mix(0.86, 1.15, midVar);
               ${
                 rock
                   ? `
                 // Darken lower abyssal cliff faces and enrich volcanic strata
                 float cliffDepth = smoothstep(-24.0, 9.5, vStoneWorld.y);
                 wear *= mix(0.62, 1.12, cliffDepth);
                 weatherTint = mix(vec3(0.76, 0.68, 0.98), vec3(1.06, 0.98, 1.08), midVar);
               `
                   : `
                 // Subtle sanctuary & walkway warmth on horizontal carved stone slabs
                 float topSlab = clamp(wN.y, 0.0, 1.0);
                 weatherTint = mix(weatherTint, weatherTint * vec3(1.05, 1.01, 0.98), topSlab * 0.5);
               `
               }
               diffuseColor.rgb *= triAlbedo * weatherTint * wear * 1.38;
             #endif`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
             {
               vec3 wNR = normalize(vStoneNormal);
               vec3 bR = pow(abs(wNR), vec3(5.5));
               bR /= max(bR.x + bR.y + bR.z, 0.0001);
               vec3 wpR = vStoneWorld * ${scale.toFixed(4)};
               float rSample = texture2D(uRoughTex, wpR.zy).r * bR.x
                             + texture2D(uRoughTex, wpR.xz).r * bR.y
                             + texture2D(uRoughTex, wpR.xy).r * bR.z;
               // Damp moonlit sheen patches on stone plazas to catch astral core & moonlight reflections
               float dampPatch = smoothstep(0.56, 0.84, stoneNoise(vStoneWorld * 0.14));
               roughnessFactor = clamp(rSample * roughness - dampPatch * ${rock ? '0.08' : '0.14'}, 0.18, 0.97);
             }`
          )
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
             {
               vec3 wNN = normalize(vStoneNormal) * faceDirection;
               vec3 bN = pow(abs(wNN), vec3(5.5));
               bN /= max(bN.x + bN.y + bN.z, 0.0001);
               vec3 wpN = vStoneWorld * ${scale.toFixed(4)};

               vec2 tX = (texture2D(uNormalTex, wpN.zy).xy * 2.0 - 1.0) * ${normalStrength.toFixed(2)};
               vec2 tY = (texture2D(uNormalTex, wpN.xz).xy * 2.0 - 1.0) * ${normalStrength.toFixed(2)};
               vec2 tZ = (texture2D(uNormalTex, wpN.xy).xy * 2.0 - 1.0) * ${normalStrength.toFixed(2)};

               // Whiteout/UDN world-space triplanar normal blend
               vec3 wnX = vec3(wNN.x, tX.y, tX.x);
               vec3 wnY = vec3(tY.x, wNN.y, tY.y);
               vec3 wnZ = vec3(tZ.x, tZ.y, wNN.z);
               vec3 worldPerturbed = normalize(wnX * bN.x + wnY * bN.y + wnZ * bN.z);
               normal = normalize(
                 worldPerturbed.x * vViewAxisX +
                 worldPerturbed.y * vViewAxisY +
                 worldPerturbed.z * vViewAxisZ
               );
             }`
          );

        if (veinMap) {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
             {
               vec3 wNV = normalize(vStoneNormal);
               vec3 bV = pow(abs(wNV), vec3(5.5));
               bV /= max(bV.x + bV.y + bV.z, 0.0001);
               vec3 wpV = vStoneWorld * ${scale.toFixed(4)};
               float vein = texture2D(uVeinTex, wpV.zy).r * bV.x
                          + texture2D(uVeinTex, wpV.xz).r * bV.y
                          + texture2D(uVeinTex, wpV.xy).r * bV.z;
               // Molten abyssal fissures strictly on chasm cliffs below walkways & outer volcanic crags (keep gothic arches/pillars clean!)
               float underCliff = smoothstep(7.65, 1.8, vStoneWorld.y) * (1.0 - smoothstep(0.75, 0.96, abs(wNV.y)) * 0.55);
               float outerRim = max(
                 smoothstep(74.0, 90.0, abs(vStoneWorld.x)),
                 max(smoothstep(90.0, 106.0, vStoneWorld.z), smoothstep(-54.0, -70.0, vStoneWorld.z))
               ) * 0.92;
               float cliffMask = clamp(max(underCliff, outerRim), 0.0, 1.15);
               float pulse = 0.74 + 0.26 * sin(uTime * 2.1 - vStoneWorld.y * 0.35 + vStoneWorld.x * 0.12);
               float hot = smoothstep(0.24, 0.80, vein) * cliffMask;
               vec3 veinCol = mix(vec3(0.95, 0.10, 1.65), vec3(2.35, 0.12, 0.58), smoothstep(0.32, 0.82, vein));
               totalEmissiveRadiance += veinCol * hot * pulse * 1.42;
             }`
          );
        }
      };
      return mat;
    };

    const crystalMat = (name, color, emissive, intensity, roughness = 0.14, metalness = 0.35) => {
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: intensity,
        roughness,
        metalness,
        envMapIntensity: 1.65,
      });
      mat.name = name;
      return mat;
    };

    return {
      stone_light: masonry('flagstone-light', {
        colorMap: tex.flagColor,
        normalMap: tex.flagNormal,
        roughMap: tex.flagRough,
        tint: 0xd8cec8,
        roughness: 0.88,
        metalness: 0.05,
        envMapIntensity: 1.05,
        scale: 0.26,
        normalStrength: 1.22,
      }),
      stone: masonry('cathedral-stone', {
        colorMap: tex.stoneColor,
        normalMap: tex.stoneNormal,
        roughMap: tex.stoneRough,
        tint: 0xb6b2c8,
        roughness: 0.86,
        metalness: 0.10,
        envMapIntensity: 1.0,
        scale: 0.25,
        normalStrength: 1.18,
      }),
      trim: masonry('carved-trim', {
        colorMap: tex.stoneColor,
        normalMap: tex.stoneNormal,
        roughMap: tex.stoneRough,
        tint: 0x8e8aa6,
        roughness: 0.72,
        metalness: 0.28,
        envMapIntensity: 1.25,
        scale: 0.34,
        normalStrength: 1.28,
      }),
      basalt: masonry('abyssal-basalt', {
        colorMap: tex.basaltColor,
        normalMap: tex.basaltNormal,
        roughMap: tex.basaltRough,
        veinMap: tex.basaltVeins,
        tint: 0x9c96ba,
        roughness: 0.88,
        metalness: 0.16,
        envMapIntensity: 1.10,
        scale: 0.115,
        normalStrength: 1.42,
        rock: true,
      }),
      rubble: masonry('abyssal-rubble', {
        colorMap: tex.basaltColor,
        normalMap: tex.basaltNormal,
        roughMap: tex.basaltRough,
        tint: 0x857f99,
        roughness: 0.95,
        metalness: 0.08,
        envMapIntensity: 0.8,
        scale: 0.22,
        normalStrength: 1.30,
        rock: true,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: 0x3b3f54,
        roughness: 0.24,
        metalness: 0.92,
        envMapIntensity: 1.45,
      }),
      crystal: crystalMat('amethyst', 0x281242, 0x8e38f5, 1.75, 0.12, 0.45),
      fuchsia: crystalMat('energy-vein', 0x261042, 0x9b2eff, 1.18, 0.16, 0.42),
      heart: crystalMat('astral-core', 0x9b82ec, 0xb86cff, 2.35, 0.08, 0.48),
      symbol: crystalMat('rune', 0x352252, 0x8a48e8, 0.92, 0.22, 0.42),
      railcap: crystalMat('rail-inlay', 0x282f5c, 0x7c68f2, 0.88, 0.24, 0.65),
    };
  }

  buildSkyAndMoon() {
    // Rich gothic-cosmic sky dome with multi-octave FBM violet/crimson nebulae & anti-aliased stars
    const skyGeo = new THREE.SphereGeometry(265, 48, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: this.shaderUniforms.uTime },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vDir;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise3(vec3 x) {
          vec3 i = floor(x), f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z
          );
        }
        float fbm(vec3 p) {
          float v = 0.0, a = 0.52;
          for (int i = 0; i < 5; i++) {
            v += a * noise3(p);
            p = p * 2.04 + vec3(1.7, -1.2, 0.9);
            a *= 0.5;
          }
          return v;
        }
        float starLayer(vec3 dir, float scale, float density) {
          vec3 p = dir * scale;
          vec3 id = floor(p);
          vec3 f = fract(p) - 0.5;
          float h = hash(id);
          if (h < density) return 0.0;
          vec3 jitter = (vec3(hash(id + 1.1), hash(id + 2.3), hash(id + 3.7)) - 0.5) * 0.55;
          float d = length(f - jitter);
          float tw = 0.65 + 0.35 * sin(uTime * (2.2 + h * 4.0) + h * 95.0);
          return smoothstep(0.22, 0.015, d) * tw * smoothstep(density, 1.0, h);
        }

        void main() {
          float y = vDir.y;
          vec3 zenith = vec3(0.006, 0.009, 0.028);
          vec3 midSky = vec3(0.022, 0.014, 0.055);
          vec3 horizon = vec3(0.055, 0.020, 0.095);
          vec3 abyss = vec3(0.095, 0.018, 0.145);

          vec3 col = y > 0.0
            ? mix(horizon, mix(midSky, zenith, smoothstep(0.18, 0.85, y)), pow(clamp(y, 0.0, 1.0), 0.62))
            : mix(horizon, abyss, clamp(-y * 2.4, 0.0, 1.0));

          // Multi-layered cosmic nebula ribbons across the cathedral sky
          vec3 np = vDir * 3.2 + vec3(uTime * 0.008, 0.0, -uTime * 0.006);
          float neb1 = fbm(np);
          float neb2 = fbm(np * 2.1 + vec3(neb1 * 1.4));
          float band = smoothstep(0.42, 0.82, neb1 * 0.6 + neb2 * 0.55) * (1.0 - smoothstep(0.0, 0.88, abs(y - 0.12)));
          float rift = smoothstep(0.62, 0.88, neb2) * band;

          col += vec3(0.075, 0.022, 0.155) * band;
          col += vec3(0.16, 0.025, 0.095) * rift * 0.75;

          // Atmospheric glow around the northern Abyssal Moon direction
          vec3 moonDir = normalize(vec3(-30.0, 77.0, -168.0));
          float moonDot = max(dot(vDir, moonDir), 0.0);
          col += vec3(0.14, 0.09, 0.26) * pow(moonDot, 14.0) * 0.85;
          col += vec3(0.32, 0.22, 0.52) * pow(moonDot, 90.0) * 0.65;

          // Two crisp anti-aliased star layers above horizon
          if (y > -0.04) {
            float horizonFade = smoothstep(-0.04, 0.16, y);
            float s1 = starLayer(vDir, 135.0, 0.968);
            float s2 = starLayer(vDir, 250.0, 0.982);
            float temp = hash(floor(vDir * 135.0) + 9.4);
            vec3 starCol = mix(vec3(0.76, 0.84, 1.0), vec3(1.0, 0.82, 0.94), temp);
            col += starCol * (s1 * 1.35 + s2 * 0.75) * horizonFade * (1.0 - band * 0.45);
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.root.add(new THREE.Mesh(skyGeo, skyMat));

    // High-detail Astral Eclipse Moon with lunar maria, crater relief, corona & twin astrolabe rings
    const moonGroup = new THREE.Group();
    moonGroup.position.set(-30, 77, -168);

    // Soft atmospheric corona halo behind the moon
    const coronaGeo = new THREE.PlaneGeometry(92, 92);
    const coronaMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv - 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          float d = length(vUv) * 2.0;
          float glow = exp(-d * d * 4.8) * 0.55 + exp(-max(0.0, d - 0.46) * 8.5) * 0.28;
          vec3 col = mix(vec3(0.78, 0.58, 1.0), vec3(0.55, 0.16, 0.68), smoothstep(0.25, 0.85, d));
          gl_FragColor = vec4(col, glow * smoothstep(1.0, 0.35, d));
        }
      `,
    });
    const corona = new THREE.Mesh(coronaGeo, coronaMat);
    corona.position.z = -3;
    moonGroup.add(corona);

    const moonGeo = new THREE.SphereGeometry(22, 64, 48);
    const moonMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.shaderUniforms.uTime },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vObjN;
        varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vObjN = normalize(normal);
          vP = position * 0.12;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vN;
        varying vec3 vObjN;
        varying vec3 vP;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise3(vec3 x) {
          vec3 i = floor(x), f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z
          );
        }
        float fbm(vec3 p) {
          float v = 0.0, a = 0.54;
          for (int i = 0; i < 5; i++) {
            v += a * noise3(p);
            p = p * 2.08 + vec3(2.1, -1.4, 1.3);
            a *= 0.5;
          }
          return v;
        }
        void main() {
          float maria = fbm(vObjN * 3.1);
          float detail = fbm(vObjN * 11.5);
          float micro = noise3(vObjN * 28.0);

          // Subtle bump normal for realistic lunar crater relief
          vec3 lightDir = normalize(vec3(-0.35, 0.42, 0.84));
          vec3 bumpN = normalize(vN + (detail - 0.5) * 0.28);
          float lit = smoothstep(-0.18, 0.82, dot(bumpN, lightDir));

          vec3 highland = vec3(0.82, 0.78, 0.95) * (0.86 + 0.26 * micro);
          vec3 mareCol = vec3(0.24, 0.19, 0.38) * (0.80 + 0.35 * detail);
          vec3 surface = mix(highland, mareCol, smoothstep(0.42, 0.66, maria));

          // Subtle glowing abyssal rift veins on the dark lunar maria
          float lunarRift = smoothstep(0.74, 0.88, detail) * smoothstep(0.50, 0.72, maria);
          vec3 shaded = surface * (0.22 + 0.88 * lit) + vec3(0.85, 0.22, 0.68) * lunarRift * 0.42;

          float fres = pow(1.0 - clamp(abs(vN.z), 0.0, 1.0), 2.4);
          vec3 rim = vec3(0.75, 0.52, 1.0) * fres * 0.65;
          gl_FragColor = vec4(shaded + rim, 1.0);
        }
      `,
    });
    moonGroup.add(new THREE.Mesh(moonGeo, moonMat));

    // Twin delicate astrolabe rings around the moon
    const ringMatA = new THREE.MeshBasicMaterial({
      color: 0xc5a3ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const moonRingA = new THREE.Mesh(new THREE.RingGeometry(25.2, 25.55, 96), ringMatA);
    moonRingA.rotation.set(0.32, -0.22, 0);

    const moonRingB = new THREE.Mesh(
      new THREE.RingGeometry(28.4, 28.65, 96),
      ringMatA.clone()
    );
    moonRingB.material.color.setHex(0xff6ba8);
    moonRingB.material.opacity = 0.16;
    moonRingB.rotation.set(-0.26, 0.30, 0.4);
    moonGroup.add(moonRingA, moonRingB);

    this.animatedObjects.push((dt, t) => {
      moonRingA.rotation.z = t * 0.14;
      moonRingB.rotation.z = -t * 0.09;
    });
    this.root.add(moonGroup);
  }

  buildAbyssOceanAndUnderworldFog() {
    // 1. Deep Abyssal Sea at y = -32 with animated violet/magenta caustics & central pillar reflection
    const seaGeo = new THREE.PlaneGeometry(520, 520, 1, 1);
    seaGeo.rotateX(-Math.PI / 2);
    const seaMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.shaderUniforms.uTime },
      vertexShader: `
        varying vec3 vWPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vWPos;

        float gyroid(vec3 p) {
          return dot(sin(p), cos(p.yzx));
        }

        float fbm(vec2 p, float t) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * abs(gyroid(vec3(p, t * 0.35)));
            p = p * 1.92 + vec2(1.7, -1.3);
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 p = vWPos.xz * 0.045;
          float n1 = fbm(p + vec2(uTime * 0.03, -uTime * 0.04), uTime);
          float n2 = fbm(p * 1.8 - vec2(uTime * 0.05, uTime * 0.02), uTime * 1.3);
          float caustic = pow(clamp(n1 * n2 * 1.45, 0.0, 1.0), 2.1);

          // Central sanctuary beam reflection column on the abyssal sea
          float rCenter = length(vWPos.xz - vec2(0.0, 5.1));
          float beamRefl = exp(-abs(vWPos.x) * 0.065) * exp(-abs(vWPos.z - 5.1) * 0.014);
          float ringWave = 0.5 + 0.5 * sin(rCenter * 0.35 - uTime * 2.6);
          float sanctuaryGlow = exp(-rCenter * 0.025) * (0.65 + 0.35 * ringWave);

          vec3 deepCol = vec3(0.010, 0.004, 0.025);
          vec3 violetCol = vec3(0.080, 0.012, 0.18);
          vec3 magentaCol = vec3(0.22, 0.025, 0.26);
          vec3 coreWhite = vec3(0.38, 0.16, 0.60);

          vec3 col = mix(deepCol, violetCol, clamp(n1 * 0.85, 0.0, 1.0));
          col += magentaCol * caustic * 0.28;
          col += mix(magentaCol, coreWhite, 0.35) * (beamRefl * 0.24 + sanctuaryGlow * 0.10);

          float edgeFade = 1.0-smoothstep(95.0,255.0,length(vWPos.xz));
          gl_FragColor = vec4(mix(vec3(.018,.010,.040),col,edgeFade),1.0);
        }
      `,
    });
    const seaMesh = new THREE.Mesh(seaGeo, seaMat);
    seaMesh.position.y = -32;
    this.root.add(seaMesh);

    // 2. Multi-layered Volumetric Underworld Fog Planes (y = -24 to y = 2.8)
    const fogHeights = [-34, -26, -19, -13, -8, -3.5, 1.5];
    fogHeights.forEach((h, idx) => {
      const fogGeo = new THREE.PlaneGeometry(350, 350, 20, 20);
      fogGeo.rotateX(-Math.PI / 2);
      const fogMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: this.shaderUniforms.uTime,
          uLayer: { value: idx / fogHeights.length },
          uOpacity: { value: idx === 6 ? 0.36 : idx > 3 ? 0.48 : 0.72 },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uLayer;
          varying vec3 vWPos;
          void main() {
            vec3 pos = position;
            pos.y += sin(pos.x * 0.05 + uTime * 0.18 + uLayer * 6.0) * cos(pos.z * 0.05 - uTime * 0.14) * 1.5;
            vec4 wp = modelMatrix * vec4(pos, 1.0);
            vWPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uLayer;
          uniform float uOpacity;
          varying vec3 vWPos;

          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
            float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
            float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
            float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }

          float fbm(vec2 p) {
            float v = 0.0;
            float amp = 0.55;
            for (int i = 0; i < 4; i++) {
              v += amp * noise(p);
              p = p * 2.03 + vec2(3.1, 1.7);
              amp *= 0.5;
            }
            return v;
          }

          void main() {
            vec2 drift = vec2(uTime * (0.35 + uLayer * 0.2), -uTime * 0.25);
            vec2 warp = vec2(fbm(vWPos.xz*.025+drift*.1+uLayer*7.0),fbm(vWPos.zx*.033-drift*.08+uLayer*5.0));
            float f = fbm(vWPos.xz * 0.042 + warp*2.3 + drift * 0.15 + uLayer * 4.3);
            float f2 = fbm(vWPos.xz * 0.095 - warp + drift * 0.12 + uLayer*8.0);
            float mist = smoothstep(0.27, 0.76, f * 0.74 + f2 * 0.52);

            float distCenter = length(vWPos.xz - vec2(0.0, 10.0));
            float radialFade = 1.0 - smoothstep(100.0, 220.0, distCenter);
            float coreBoost = exp(-length(vWPos.xz - vec2(0.0, 5.1)) * 0.028);

            vec3 col = mix(vec3(0.025, 0.004, 0.075), vec3(0.30, 0.09, 0.56), smoothstep(.27,.78,f2));
            col += vec3(0.045, 0.015, 0.09) * coreBoost;
            float alpha = mist * radialFade * uOpacity;
            gl_FragColor = vec4(col, alpha);
          }
        `,
      });
      const m = new THREE.Mesh(fogGeo, fogMat);
      m.position.y = h;
      this.root.add(m);
    });
  }

  buildSanctuaryCoreFX() {
    // Central Sanctuary Astral Core at (0, 12.1, 5.13) matching the reference illustration
    const coreGroup = new THREE.Group();
    coreGroup.position.set(0, 12.1, 5.13);
    this.root.add(coreGroup);

    // 1. Vertical Celestial Energy Beam shooting into the abyssal sky and down into the chasm
    const beamGeo = new THREE.CylinderGeometry(0.13, 0.25, 95, 16, 1, true);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: this.shaderUniforms.uTime },
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
          float pulse = 0.75 + 0.25 * sin(vUv.y * 28.0 - uTime * 6.5);
          float vertFade = sin(vUv.y * 3.14159);
          vec3 col = mix(vec3(0.46, 0.25, 0.78), vec3(0.82, 0.75, 1.0), pulse);
          gl_FragColor = vec4(col * 1.2, vertFade * (0.45 + 0.25 * pulse));
        }
      `,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 12;
    coreGroup.add(beam);

    // Outer soft halo cylinder
    const haloGeo = new THREE.CylinderGeometry(0.65, 0.9, 90, 16, 1, true);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x8965da,
      transparent: true,
      opacity: 0.065,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.y = 10;
    coreGroup.add(halo);

    // 2. Tilted Astral Compass Star & Concentric Runic Rings
    const glyphGroup = new THREE.Group();
    glyphGroup.scale.setScalar(0.72);
    glyphGroup.rotation.x = THREE.MathUtils.degToRad(36);
    coreGroup.add(glyphGroup);

    const ringRadii = [
      [2.2, 2.29, 0xd6c5ed, 0.12],
      [3.8, 3.9, 0xa27ac8, -0.09],
      [5.4, 5.52, 0x8d6ac5, 0.065],
    ];
    ringRadii.forEach(([rIn, rOut, col, spd]) => {
      const rg = new THREE.RingGeometry(rIn, rOut, 64);
      const rm = new THREE.MeshBasicMaterial({
        color: col,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(rg, rm);
      glyphGroup.add(mesh);
      this.animatedObjects.push((dt, t) => {
        mesh.rotation.z = t * spd;
      });
    });

    // 4-point cardinal star blades
    const starShape = new THREE.Shape();
    const R = 4.6;
    const r = 0.28;
    starShape.moveTo(0, R);
    starShape.lineTo(r, r);
    starShape.lineTo(R, 0);
    starShape.lineTo(r, -r);
    starShape.lineTo(0, -R);
    starShape.lineTo(-r, -r);
    starShape.lineTo(-R, 0);
    starShape.lineTo(-r, r);
    starShape.closePath();

    const starGeo = new THREE.ShapeGeometry(starShape);
    const starMat = new THREE.MeshBasicMaterial({
      color: 0xbaa0dc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.56,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const starA = new THREE.Mesh(starGeo, starMat);
    const starB = new THREE.Mesh(starGeo, starMat.clone());
    starB.material.color.setHex(0x8163ad);
    starB.scale.setScalar(0.68);
    starB.rotation.z = Math.PI / 4;
    glyphGroup.add(starA, starB);

    this.animatedObjects.push((dt, t) => {
      starA.rotation.z = Math.sin(t * 0.8) * 0.12;
      starB.rotation.z = Math.PI / 4 + t * 0.45;
      coreGroup.position.y = 12.1 + Math.sin(t * 1.6) * 0.28;
    });

    // 3. Floating Rotating Violet Crystals above every district medallion
    for (const med of this.worldData.medallions || []) {
      const [mx, my, mz] = med.c;
      const cryGeo = new THREE.OctahedronGeometry(0.24, 0);
      cryGeo.scale(0.65, 1.55, 0.65);
      const cryMat = new THREE.MeshStandardMaterial({
        color: 0x847293,
        emissive: 0x664599,
        emissiveIntensity: 0.65,
        roughness: 0.15,
        metalness: 0.2,
      });
      const cry = new THREE.Mesh(cryGeo, cryMat);
      cry.position.set(mx + med.r * 0.58, my + 0.85, mz);
      this.root.add(cry);

      // Ground rune ring around each medallion
      const rGeo = new THREE.RingGeometry(med.r * 0.72, med.r * 0.82, 48);
      rGeo.rotateX(-Math.PI / 2);
      const rMat = new THREE.MeshBasicMaterial({
        color: 0x7a699e,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.position.set(mx, my + 0.04, mz);
      this.root.add(rMesh);

      const phase = mx * 0.13 + mz * 0.17;
      this.animatedObjects.push((dt, t) => {
        cry.rotation.y = t * 0.6;
        cry.position.y = my + 0.85 + Math.sin(t * 1.4 + phase) * 0.1;
        rMesh.rotation.y -= dt * 0.05;
      });
    }
  }

  buildAdvancedVioletLights() {
    // Crisp moonlight reveals the carved stone relief; abyssal violet & crimson bounce
    // illuminate cliff crevices and gothic arches from below.
    const hemi = new THREE.HemisphereLight(0xaab8e4, 0x261538, 0.42);
    this.scene.add(hemi);

    const moonLight = new THREE.DirectionalLight(0xe4ecff, 3.15);
    moonLight.position.set(-45, 78, 35);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(2048, 2048);
    moonLight.shadow.camera.near = 1;
    moonLight.shadow.camera.far = 140;
    const d = 28;
    moonLight.shadow.camera.left = -d;
    moonLight.shadow.camera.right = d;
    moonLight.shadow.camera.top = d;
    moonLight.shadow.camera.bottom = -d;
    moonLight.shadow.bias = -0.00018;
    moonLight.shadow.normalBias = 0.032;
    this.scene.add(moonLight, moonLight.target);
    this.moonLight = moonLight;

    const fill = new THREE.DirectionalLight(0x889ed0, 0.42);
    fill.position.set(35, 24, 55);
    this.scene.add(fill);
    const abyssBounce = new THREE.DirectionalLight(0x9d34e8, 1.25);
    abyssBounce.position.set(0, -52, 10);
    this.scene.add(abyssBounce);
    const rim = new THREE.DirectionalLight(0xc874ff, 1.45);
    rim.position.set(20, 28, -45);
    this.scene.add(rim);

    // Dynamic pulsing point lights across the Sanctuary, Entrance & District Runes
    const keySpots = [
      { pos: [0, 13.5, 5.1], color: 0xc292ff, intensity: 22, dist: 28 },
      { pos: [0, 10.4, 79.8], color: 0xa47cff, intensity: 13, dist: 18 },
      { pos: [0, 10.2, 45.0], color: 0x9b82ff, intensity: 11, dist: 19 },
      { pos: [-57.7, 10.2, 25.9], color: 0xa46eff, intensity: 12, dist: 20 },
      { pos: [-46.8, 12.2, -19.7], color: 0xd46ca8, intensity: 15, dist: 20 },
      { pos: [60.4, 10.2, 44.6], color: 0xa46eff, intensity: 12, dist: 20 },
      { pos: [63.2, 12.2, -17.6], color: 0xd46ca8, intensity: 15, dist: 20 },
      { pos: [0, 10.5, -38.5], color: 0xa684ff, intensity: 15, dist: 20 },
    ];
    this.lightSources = keySpots.map(s => ({ ...s, position: new THREE.Vector3(...s.pos) }));
    this.lightSources.slice(0, 4).forEach((s, i) => {
      const light = new THREE.PointLight(s.color, s.intensity, s.dist, 1.85);
      light.position.set(...s.pos);
      this.root.add(light);
      this.violetLights.push({ light, source: s, base: s.intensity, phase: i * 1.1 });
    });
  }

  buildVioletParticles() {
    this.atmosphere = new AbyssAtmosphere(this.root, this.shaderUniforms.uTime, this.renderer);
    this.atmosphere.setQuality(window.__GAME__?.quality || 'balanced');
  }
  buildAstralBridgesAndPortals() {
    const links = [
      { from: [0, 8.15, -2.2], to: [0, 8.15, -31.5], width: 3.2, name: 'Puente Astral del Norte' },
      { from: [-19.5, 8.1, -0.5], to: [-33.5, 8.1, -4.5], width: 2.4, name: 'Pasarela Lateral Oeste' },
      { from: [19.2, 8.1, -0.5], to: [34.0, 8.1, -4.5], width: 2.4, name: 'Pasarela Lateral Este' },
      { from: [-41.0, 7.6, 59.5], to: [-35.5, 8.1, 35.0], width: 2.4, name: 'Puente Isla Oeste' },
      { from: [47.5, 7.6, 58.0], to: [35.5, 8.1, 34.0], width: 2.8, name: 'Puente Isla Este' },
    ];

    const bridgeMat = this.materials.stone_light;
    const curbMat = this.materials.trim;
    const inlayMat = new THREE.MeshBasicMaterial({
      color: 0xc26eff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const lk of links) {
      let a = this.findWalkablePosition(lk.from[0], lk.from[2], 4, 0.4, lk.from[1]) || new THREE.Vector3(...lk.from);
      let b = this.findWalkablePosition(lk.to[0], lk.to[2], 4, 0.4, lk.to[1]) || new THREE.Vector3(...lk.to);
      [a, b] = this.adjustWalkwayEndpoints(a, b);
      a.y += 0.035;
      b.y += 0.035;
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const bridgeGeo = new THREE.BoxGeometry(lk.width, 0.24, len);
      const mesh = new THREE.Mesh(bridgeGeo, bridgeMat);
      mesh.position.copy(mid);
      mesh.position.y -= 0.12;
      mesh.rotation.y = Math.atan2(dir.x, dir.z);
      mesh.rotation.x = -Math.asin(dir.y / len);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = lk.name;
      this.root.add(mesh);
      for (const side of [-1, 1]) {
        const curb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, len), curbMat);
        curb.position.set(side * (lk.width * 0.5 - 0.09), 0.18, 0);
        curb.castShadow = true;
        curb.receiveShadow = true;
        mesh.add(curb);

        const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.015, len * 0.96), inlayMat);
        inlay.position.set(side * (lk.width * 0.5 - 0.22), 0.128, 0);
        mesh.add(inlay);
      }

      this.walkwaySegments.push({ a: a.clone(), b: b.clone(), width: lk.width, name: lk.name });
      this.bakeWalkwaySegment(a, b, lk.width * 0.6);
      this.carveWalkablePassage(a, b, lk.width - 0.2, 3.0);
    }

    // Runic Fast-Travel / Impulse Nodes at key landmarks (press E to warp with astral flash)
    // Placed slightly ahead of spawn at (0, 8.2, 83.2) so it never covers the central Entrance star medallion!
    this.portals = [
      { name: 'Umbral de Entrada', pos: new THREE.Vector3(0, 8.2, 83.2), destIdx: 1 },
      { name: 'Santuario Central', pos: new THREE.Vector3(0, 8.2, 11.8), destIdx: 2 },
      { name: 'Corona del Oeste', pos: new THREE.Vector3(-46.84, 10.24, -19.67), destIdx: 3 },
      { name: 'Catedral del Este', pos: new THREE.Vector3(63.2, 10.2, -17.6), destIdx: 4 },
      { name: 'Santuario del Norte', pos: new THREE.Vector3(0, 8.2, -38.5), destIdx: 0 },
    ];
    const portalRune = new THREE.MeshBasicMaterial({
      color: 0xc864ff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const portalInnerMat = new THREE.MeshBasicMaterial({
      color: 0x6be6ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (const portal of this.portals) {
      const safe = this.findWalkablePosition(portal.pos.x, portal.pos.z, 6, 0.45, portal.pos.y);
      if (safe) portal.pos.copy(safe);
      const portalGroup = new THREE.Group();
      portalGroup.position.copy(portal.pos).add(new THREE.Vector3(0, 0.045, 0));

      const rune = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.98, 48), portalRune);
      rune.rotation.x = -Math.PI / 2;
      const innerRune = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.54, 6), portalInnerMat);
      innerRune.rotation.x = -Math.PI / 2;
      portalGroup.add(rune, innerRune);
      this.root.add(portalGroup);
      portal.marker = rune;
      this.animatedObjects.push((dt, t) => {
        rune.rotation.z = t * 0.65;
        innerRune.rotation.z = -t * 1.15;
      });
    }
  }

  cleanWalkabilityGrid() {
    if (!this.collision) return;
    const { x0, z0, cell, w, h, heights, flags } = this.collision;

    // 1. Clear overhead arch & rail flags along the entire Axial Spine, Entrance Plaza, Sanctuary Ring & Side Corridors
    for (let iz = 1; iz < h - 1; iz++) {
      const z = z0 + (iz + 0.5) * cell;
      for (let ix = 1; ix < w - 1; ix++) {
        const idx = iz * w + ix;
        const y = heights[idx];
        if (y < -1000) continue;
        const x = x0 + (ix + 0.5) * cell;

        // Axial bridge + Entrance + North nave spine
        if (Math.abs(x) <= 2.1 && z >= -42 && z <= 86) {
          flags[idx] = 0;
          continue;
        }
        // Entrance plaza & side galleries
        if (Math.abs(x) <= 16.0 && z >= 70.0 && z <= 86.0) {
          flags[idx] = 0;
          continue;
        }
        // Central Sanctuary Ring
        const distSanct = Math.hypot(x, z - 5.1);
        if (distSanct >= 3.2 && distSanct <= 21.0) {
          flags[idx] = 0;
          continue;
        }

        // General interior pavement: if at least 6 of 8 neighbors have valid floor height within 0.85m,
        // it's an interior walkway/stair cell (not a cliff edge), so clear spurious arch/curb flags.
        if (flags[idx] !== 0) {
          let validNeighbors = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dz === 0) continue;
              const nh = heights[(iz + dz) * w + (ix + dx)];
              if (nh > -1000 && Math.abs(nh - y) < 0.85) validNeighbors++;
            }
          }
          if (validNeighbors >= 6) {
            flags[idx] = 0;
          }
        }
      }
    }
  }

  bakeWalkwaySegment(a, b, halfWidth) {
    if (!this.collision) return;
    const { x0, z0, cell, w, h, heights, flags } = this.collision;
    const vx=b.x-a.x,vz=b.z-a.z,len2=vx*vx+vz*vz;
    const minX=Math.max(0,Math.floor((Math.min(a.x,b.x)-halfWidth-x0)/cell));
    const maxX=Math.min(w-1,Math.ceil((Math.max(a.x,b.x)+halfWidth-x0)/cell));
    const minZ=Math.max(0,Math.floor((Math.min(a.z,b.z)-halfWidth-z0)/cell));
    const maxZ=Math.min(h-1,Math.ceil((Math.max(a.z,b.z)+halfWidth-z0)/cell));
    for(let iz=minZ;iz<=maxZ;iz++) {
      for(let ix=minX;ix<=maxX;ix++) {
        const x=x0+(ix+.5)*cell,z=z0+(iz+.5)*cell;
        const t=((x-a.x)*vx+(z-a.z)*vz)/len2;
        if(t<0 || t>1) continue;
        const dx=x-(a.x+t*vx),dz=z-(a.z+t*vz);
        if(dx*dx+dz*dz>halfWidth*halfWidth) continue;
        const idx=iz*w+ix, deckY=THREE.MathUtils.lerp(a.y,b.y,t);
        // Keep existing walls/rails collidable instead of deleting them.
        if(heights[idx]<-1000) { heights[idx]=deckY; flags[idx]=0; }
      }
    }
  }

  adjustWalkwayEndpoints(a,b) {
    const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),nx=-dz/len,nz=dx/len;
    const offsets=[0,.5,-.5,1,-1,1.5,-1.5,2,-2,2.5,-2.5,3,-3,3.5,-3.5,4,-4];
    const pairs=[];
    for(const oa of offsets)for(const ob of offsets)pairs.push([oa,ob]);
    pairs.sort((p,q)=>Math.abs(p[0])+Math.abs(p[1])-Math.abs(q[0])-Math.abs(q[1]));
    const footprint=[[0,0],[.36,0],[-.36,0],[0,.36],[0,-.36]];
    for(const [oa,ob] of pairs) {
      const sa=this.findWalkablePosition(a.x+nx*oa,a.z+nz*oa,.1,.38,a.y);
      const sb=this.findWalkablePosition(b.x+nx*ob,b.z+nz*ob,.1,.38,b.y);
      if(!sa||!sb)continue;
      let clear=true;
      const steps=Math.ceil(sa.distanceTo(sb)/.16);
      for(let i=0;i<=steps&&clear;i++) {
        const t=i/steps,x=THREE.MathUtils.lerp(sa.x,sb.x,t),z=THREE.MathUtils.lerp(sa.z,sb.z,t),y=THREE.MathUtils.lerp(sa.y,sb.y,t);
        for(const [ox,oz] of footprint) {
          const g=this.sampleGround(x+ox,z+oz);
          if(g.height>-1000&&(g.blocked||Math.abs(g.height-y)>.8)) {clear=false;break;}
        }
      }
      if(clear)return[sa,sb];
    }
    return[a,b];
  }

  carveWalkablePassage(a,b,width,height=3.0) {
    const z=new THREE.Vector3().subVectors(b,a).normalize();
    const x=new THREE.Vector3(z.z,0,-z.x).normalize(),y=new THREE.Vector3().crossVectors(z,x).normalize();
    const midpoint=new THREE.Vector3().addVectors(a,b).multiplyScalar(.5);
    const inverse=new THREE.Matrix4().makeBasis(x,y,z).setPosition(midpoint).invert();
    this.root.updateMatrixWorld(true);
    let removed=0;
    for(const mesh of this.staticMeshes) {
      if(['stone','stone_light','trim','basalt','rubble','metal'].includes(mesh.userData.role))removed+=cutMasonryPassage(mesh,inverse,width,a.distanceTo(b),height);
    }
    const c=this.collision,half=width*.5,len=a.distanceTo(b);
    if(c) {
      const point=new THREE.Vector3();
      for(let iz=Math.max(0,Math.floor((Math.min(a.z,b.z)-half-c.z0)/c.cell));iz<=Math.min(c.h-1,Math.ceil((Math.max(a.z,b.z)+half-c.z0)/c.cell));iz++) {
        for(let ix=Math.max(0,Math.floor((Math.min(a.x,b.x)-half-c.x0)/c.cell));ix<=Math.min(c.w-1,Math.ceil((Math.max(a.x,b.x)+half-c.x0)/c.cell));ix++) {
          const i=iz*c.w+ix;
          if(c.heights[i]<-1000)continue;
          point.set(c.x0+(ix+.5)*c.cell,c.heights[i],c.z0+(iz+.5)*c.cell).applyMatrix4(inverse);
          if(Math.abs(point.x)<half&&Math.abs(point.z)<len*.5&&Math.abs(point.y)<.6)c.flags[i]=0;
        }
      }
    }
    this.passageTrianglesRemoved=(this.passageTrianglesRemoved||0)+removed;
  }

  sampleGround(x, z) {
    const c = this.collision;
    if (!c) return { height: 8.15, blocked: false, valid: true };
    const ix = Math.floor((x - c.x0) / c.cell);
    const iz = Math.floor((z - c.z0) / c.cell);
    if (ix < 0 || ix >= c.w || iz < 0 || iz >= c.h) {
      return { height: -9999, blocked: true, valid: false };
    }
    const idx = iz * c.w + ix;
    let h = c.heights[idx];
    const blocked = c.flags[idx] !== 0;
    // Interpolate cell-centre heights only on continuous, level ground. Never
    // average a void value into a floor, or smear a stair across its riser.
    if(h>-1000 && !blocked) {
      const gx=(x-c.x0)/c.cell-.5,gz=(z-c.z0)/c.cell-.5;
      const ax=Math.floor(gx),az=Math.floor(gz),fx=gx-ax,fz=gz-az;
      if(ax>=0&&az>=0&&ax+1<c.w&&az+1<c.h) {
        const ids=[az*c.w+ax,az*c.w+ax+1,(az+1)*c.w+ax,(az+1)*c.w+ax+1];
        if(ids.every(i=>c.heights[i]>-1000&&c.flags[i]===0&&Math.abs(c.heights[i]-h)<.4)) {
          h=THREE.MathUtils.lerp(THREE.MathUtils.lerp(c.heights[ids[0]],c.heights[ids[1]],fx),THREE.MathUtils.lerp(c.heights[ids[2]],c.heights[ids[3]],fx),fz);
        }
      }
    }
    return { height: h, blocked, valid: h > -1000 && !blocked };
  }

  findWalkablePosition(x,z,maxRadius=8,radius=.3,referenceY=8.2) {
    const clear=(px,pz)=>{
      const g=this.sampleGround(px,pz);
      if(!g.valid || Math.abs(g.height-referenceY)>2.6) return null;
      for(let i=0;i<8;i++) {
        const a=i*Math.PI/4,s=this.sampleGround(px+Math.cos(a)*radius,pz+Math.sin(a)*radius);
        if(!s.valid || Math.abs(s.height-g.height)>.45) return null;
      }
      return new THREE.Vector3(px,g.height,pz);
    };
    let found=clear(x,z);
    if(found) return found;
    for(let r=.25;r<=maxRadius;r+=.25) {
      const steps=Math.ceil(r*Math.PI*2/.3);
      for(let i=0;i<steps;i++) {
        const a=i/steps*Math.PI*2;
        found=clear(x+Math.cos(a)*r,z+Math.sin(a)*r);
        if(found) return found;
      }
    }
    return null;
  }

  traceCamera(from, to) {
    this.cameraTrace.copy(to);
    const g = this.sampleGround(to.x, to.z);
    if (g.height > -1000 && this.cameraTrace.y < g.height + 0.55) {
      this.cameraTrace.y = g.height + 0.55;
    }
    return this.cameraTrace;
  }

  getNearestDistrict(pos) {
    if (!this.worldData?.districts) return 'CIUDADELA DEL ABISMO';
    let best = 'CIUDADELA DEL ABISMO';
    let bestDist = Infinity;
    for (const d of this.worldData.districts) {
      const dx = pos.x - d.c[0];
      const dz = pos.z - d.c[2];
      const dist = Math.hypot(dx, dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = d.name.replace(/_/g, ' ');
      }
    }
    return best;
  }

  reset(playerPos) {
    this._lastLightSelection = -Infinity;
    this.update(0.2, 0, playerPos);
    for (const entry of this.violetLights) {
      if (!entry.source) continue;
      entry.light.position.copy(entry.source.position);
      entry.light.color.set(entry.source.color);
      entry.light.intensity = entry.source.intensity;
    }
  }

  update(dt, elapsed, playerPos) {
    this.shaderUniforms.uTime.value = elapsed;
    if (playerPos) {
      this.shaderUniforms.uPlayerPos.value.copy(playerPos);
    }

    for (const fn of this.animatedObjects) {
      fn(dt, elapsed);
    }

    if(playerPos && this.moonLight) {
      this.moonLight.position.set(playerPos.x-35,playerPos.y+55,playerPos.z+25);
      this.moonLight.target.position.copy(playerPos);
      if(elapsed-this._lastLightSelection>.5) {
        this._lastLightSelection=elapsed;
        const nearest=this.lightSources.slice().sort((a,b)=>a.position.distanceToSquared(playerPos)-b.position.distanceToSquared(playerPos));
        this.violetLights.forEach((v,i)=>v.source=nearest[i]);
        for(const mesh of this.staticMeshes) {
          const distance=Math.hypot(mesh.userData.chunkX-playerPos.x,mesh.userData.chunkZ-playerPos.z);
          const role=mesh.userData.role;
          mesh.castShadow=distance<44 && (role==='stone'||role==='trim');
        }
      }
    }
    for (const vl of this.violetLights) {
      vl.light.position.lerp(vl.source.position,1-Math.exp(-dt*4));
      vl.light.color.lerp(new THREE.Color(vl.source.color),1-Math.exp(-dt*4));
      vl.light.distance=vl.source.dist;
      vl.light.intensity=THREE.MathUtils.lerp(vl.light.intensity,vl.source.intensity*(.97+.03*Math.sin(elapsed*.9+vl.phase)),1-Math.exp(-dt*4));
    }
  }
}

