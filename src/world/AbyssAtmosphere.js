import * as THREE from 'three';

// Three GPU fields: drifting violet embers, orbiting astral fragments and stars.
// Simulation is analytic in the vertex shader; there is no per-particle JS loop.
export class AbyssAtmosphere {
  constructor(parent, sharedTime, renderer) {
    this.group = new THREE.Group();
    this.group.name = 'Abyss_Atmosphere_GPU';
    parent.add(this.group);
    this.renderer = renderer;
    this.uniforms = {
      uTime: sharedTime, uFocus: { value: new THREE.Vector3(0, 9, 80) },
      uPointScale: { value: 40 }, uReducedMotion: { value: 0 },
    };
    this.fields = [];
    this.addField(15000, 0);
    this.addField(2600, 1);
    this.addField(3800, 2);
  }

  addField(count, mode) {
    const positions = new Float32Array(count * 3), seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      if (mode === 0) {
        positions[i * 3] = (Math.random() - .5) * 210;
        positions[i * 3 + 1] = Math.random() * 48;
        positions[i * 3 + 2] = Math.random() * 184 - 65;
      } else if (mode === 1) {
        positions[i * 3] = Math.random() * 30 + 3;
        positions[i * 3 + 1] = Math.random() * Math.PI * 2;
        positions[i * 3 + 2] = Math.random() * 42;
      } else {
        const angle = Math.random() * Math.PI * 2, elevation = .1 + Math.random() * 1.25;
        positions[i * 3] = Math.cos(angle) * Math.cos(elevation) * 235;
        positions[i * 3 + 1] = Math.sin(elevation) * 235;
        positions[i * 3 + 2] = Math.sin(angle) * Math.cos(elevation) * 235;
      }
      seeds.set([Math.random() * 6.283, .3 + Math.random(), .075 + Math.random() ** 3 * .23, Math.random()], i * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, defines: { FIELD_MODE: mode }, transparent: true,
      depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime, uPointScale, uReducedMotion;
        uniform vec3 uFocus;
        varying vec3 vColor;
        varying float vAlpha, vStar;
        void main() {
          float t = uTime * mix(1.0,.15,uReducedMotion), phase = aSeed.x;
          vec3 p = position;
          if (FIELD_MODE == 0) {
            p.y = 5.0 + mod(p.y + t * (.24 + aSeed.y * .46), 26.0);
            if(aSeed.w>.72) {
              p.xz=uFocus.xz+mod(position.xz+vec2(105.0),vec2(32.0))-vec2(16.0);
              p.y=uFocus.y+mod(position.y+t*.5,16.0);
            }
            vec3 q = p * .09 + vec3(t*.07,phase,t*.045);
            p += vec3(sin(q.y+q.z)+cos(q.y*1.3),sin(q.z+q.x),cos(q.x+q.y)-sin(q.z)) * 1.7;
          } else if (FIELD_MODE == 1) {
            float a = p.y + t * (.035+aSeed.y*.025);
            float r = p.x + sin(t*.2+phase)*1.2;
            p = vec3(cos(a)*r, 1.0+mod(p.z+t*.8,42.0),5.1+sin(a)*r);
            // A quarter of the fragments also follow the player's district.
            if (aSeed.w > .75) p.xz += uFocus.xz * .85;
          }
          float pulse = .72 + .28*sin(t*(.45+aSeed.y)+phase*7.0);
          vAlpha = pulse;
          if (FIELD_MODE != 2) {
            vAlpha *= smoothstep(2.0,8.0,p.y)*(1.0-smoothstep(35.0,51.0,p.y));
            vAlpha *= mix(.35,1.0,1.0-smoothstep(8.0,95.0,distance(p.xz,uFocus.xz)));
          }
          vStar = aSeed.w;
          vColor = mix(vec3(.42,.08,1.2),vec3(.85,.35,1.7),aSeed.w);
          if (aSeed.w > .93) vColor = vec3(.65,.65,1.2);
          if (FIELD_MODE == 2) vColor = mix(vec3(.45,.44,.92),vec3(.85,.70,1.0),aSeed.w);
          vec4 view = modelViewMatrix*vec4(p,1.0);
          float size = aSeed.z * uPointScale;
          if (FIELD_MODE == 1) size *= 1.4;
          if (FIELD_MODE == 2) size = 1.1 + aSeed.w * 2.2;
          gl_PointSize = clamp(size,1.0,FIELD_MODE == 2 ? 4.0 : 11.0);
          gl_Position = projectionMatrix*view;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha,vStar;
        void main() {
          vec2 p=gl_PointCoord-.5;
          float r=length(p);
          if(r>.5) discard;
          float halo=exp(-r*r*15.0)*(1.0-smoothstep(.32,.5,r));
          float core=exp(-r*r*160.0);
          float crossGlow=exp(-abs(p.x)*90.0-abs(p.y)*9.0)+exp(-abs(p.y)*90.0-abs(p.x)*9.0);
          float alpha=(halo*.50+core*.85+crossGlow*.20*step(.83,vStar))*vAlpha;
          gl_FragColor=vec4(vColor*.95+vec3(.85,.65,1.15)*core,alpha*.92);
        }
      `,
    });
    const points = new THREE.Points(geometry, material);
    points.name = ['Violet_Curl_Embers', 'Astral_Ascending_Fragments', 'Abyss_Stars'][mode];
    points.frustumCulled = false;
    points.renderOrder = mode === 2 ? -10 : 5;
    this.group.add(points);
    this.fields.push({ points, count });
  }

  setQuality(quality) {
    const fraction = quality === 'performance' ? .45 : quality === 'high' ? 1 : .8;
    for (const field of this.fields) field.points.geometry.setDrawRange(0, Math.floor(field.count * fraction));
  }

  update(playerPosition, camera, reducedMotion = false) {
    if (playerPosition) this.uniforms.uFocus.value.copy(playerPosition);
    const height = camera?.isOrthographicCamera ? (camera.top - camera.bottom) / camera.zoom : 25;
    this.uniforms.uPointScale.value = innerHeight * Math.min(devicePixelRatio, 1.5) / height;
    this.uniforms.uReducedMotion.value = reducedMotion ? 1 : 0;
  }
}
