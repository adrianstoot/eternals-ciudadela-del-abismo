import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { stat, mkdir, writeFile } from 'node:fs/promises';

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});
const source = 'public/models/aeren.glb';
const target = 'public/models/abyss-sentinel.glb';
const doc = await io.read(source);
const triangles = () => doc.getRoot().listMeshes().reduce((n,m) => n + m.listPrimitives().reduce((s,p) => s + (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3, 0), 0);
const before = triangles();
await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.10, error: 0.012 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 80 }),
  dedup(), prune(),
);
await io.write(target, doc);
const report = {
  source, target, sourceBytes: (await stat(source)).size, targetBytes: (await stat(target)).size,
  trianglesBefore: before, trianglesAfter: triangles(),
  animations: doc.getRoot().listAnimations().map(a=>a.getName()),
  joints: doc.getRoot().listSkins().map(s=>s.listJoints().length),
  textureSizes: doc.getRoot().listTextures().map(t=>({size:t.getSize(), mimeType:t.getMimeType()})),
  provenance: 'Derived from the existing Meshy-generated character provided with this project. Geometry and texture resources simplified for enemy reuse. No external generation performed.',
};
await mkdir('output/repair', {recursive:true});
await writeFile('output/repair/enemy-asset.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
