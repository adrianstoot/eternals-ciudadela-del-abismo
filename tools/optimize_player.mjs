import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, prune, dedup, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'public/models/aeren.glb');
const output = path.join(root, 'public/models/aeren-optimized.glb');
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(source);
const inspect = () => {
  const primitives = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  return { vertices: primitives.reduce((n, p) => n + p.getAttribute('POSITION').getCount(), 0), triangles: primitives.reduce((n, p) => n + p.getIndices().getCount() / 3, 0),
    skins: document.getRoot().listSkins().length, joints: document.getRoot().listSkins().reduce((n,s) => n + s.listJoints().length, 0),
    animations: document.getRoot().listAnimations().map(animation => animation.getName()), textures: document.getRoot().listTextures().length };
};
const before = inspect();
await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.45, error: 0.0015 }), resample(), dedup(), prune());
const after = inspect();
if (after.joints !== before.joints || after.animations.length !== before.animations.length || after.textures !== before.textures) throw new Error('Asset optimization changed the animation/texture contract');
await io.write(output, document);
const report = { source, output, before, after, sourceBytes: (await fs.stat(source)).size, outputBytes: (await fs.stat(output)).size, maxErrorFraction: 0.0015 };
await fs.mkdir(path.join(root, 'output/repair/player'), { recursive: true });
await fs.writeFile(path.join(root, 'output/repair/player/optimization-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
