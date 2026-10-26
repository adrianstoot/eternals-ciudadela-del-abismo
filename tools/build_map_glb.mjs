// Builds public/models/map.glb (chunked, quantized, meshopt-compressed) from _work/map raw data,
// and converts the extracted textures into web-sized JPGs.
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, meshopt, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const work = path.join(root, '_work', 'map');
const out = path.join(root, 'public');
fs.mkdirSync(path.join(out, 'models'), { recursive: true });
fs.mkdirSync(path.join(out, 'textures'), { recursive: true });

const index = JSON.parse(fs.readFileSync(path.join(work, 'index.json'), 'utf8'));
const bin = fs.readFileSync(path.join(work, 'data.bin'));
const slice = (o, T) => { const a = bin.buffer.slice(bin.byteOffset + o[0], bin.byteOffset + o[0] + o[1]); return new T(a); };

await MeshoptEncoder.ready;
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('map');
const mats = {};
const mat = (role) => (mats[role] ??= doc.createMaterial(role));
for (const c of index.chunks) {
  const pos = slice(c.pos, Float32Array), nrm = slice(c.nrm, Float32Array), uv = slice(c.uv, Float32Array);
  const idx = slice(c.idx, Uint32Array);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
    .setMaterial(mat(c.role));
  const mesh = doc.createMesh(`${c.role}|${c.cx}|${c.cz}`).addPrimitive(prim);
  const node = doc.createNode(`${c.role}|${c.cx}|${c.cz}`).setMesh(mesh);
  scene.addChild(node);
}
await doc.transform(
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 16 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
await io.write(path.join(out, 'models', 'map.glb'), doc);
console.log('map.glb', (fs.statSync(path.join(out, 'models', 'map.glb')).size / 1048576).toFixed(1), 'MB');

// textures -> 2048 jpg
const texDir = path.join(work, 'tex');
for (const f of fs.readdirSync(texDir)) {
  const name = f.replace('_v2.png', '').replace(/_(2k|4k)/, '');
  const q = name.includes('normal') ? 92 : 90;
  await sharp(path.join(texDir, f)).resize(2048, 2048, { fit: 'fill' }).jpeg({ quality: q, mozjpeg: true }).toFile(path.join(out, 'textures', name + '.jpg'));
  console.log('tex', name);
}
