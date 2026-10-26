import {NodeIO} from '@gltf-transform/core';
import {EXTMeshoptCompression,KHRMeshQuantization} from '@gltf-transform/extensions';
import {weld,simplify,meshopt,prune,normals} from '@gltf-transform/functions';
import {MeshoptEncoder,MeshoptDecoder,MeshoptSimplifier} from 'meshoptimizer';
import fs from 'node:fs';
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready,MeshoptSimplifier.ready]);
const io=new NodeIO().registerExtensions([EXTMeshoptCompression,KHRMeshQuantization]).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const input='public/models/map.glb',output='public/models/map-optimized.glb';
const document=await io.read(input);
const count=()=>document.getRoot().listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3,0),0);
const before=count(),names=document.getRoot().listMeshes().map(m=>m.getName());
// Masonry now uses world-space textures. Remove redundant UV/normal splits
// before geometric simplification, retaining hard face normals afterwards.
const masonryRoles=new Set(['basalt','rubble']);
const regenerated=[];
for(const mesh of document.getRoot().listMeshes())if(masonryRoles.has(mesh.getName().split('|')[0]))for(const prim of mesh.listPrimitives()){
  prim.setAttribute('NORMAL',null);prim.setAttribute('TEXCOORD_0',null);regenerated.push(prim);
}
await document.transform(weld({}),simplify({simplifier:MeshoptSimplifier,ratio:.58,error:.0008,lockBorder:true}),normals());
for(const prim of regenerated){
  const uv=document.createAccessor().setType('VEC2').setArray(new Float32Array(prim.getAttribute('POSITION').getCount()*2)).setBuffer(document.getRoot().listBuffers()[0]);
  prim.setAttribute('TEXCOORD_0',uv);
}
await document.transform(weld({}),prune({keepLeaves:true}),meshopt({encoder:MeshoptEncoder,level:'medium'}));
const after=count();
await io.write(output,document);
const result={source:input,output,beforeTriangles:before,afterTriangles:after,retainedRatio:after/before,beforeBytes:fs.statSync(input).size,afterBytes:fs.statSync(output).size,meshNamesPreserved:names.every(name=>document.getRoot().listMeshes().some(m=>m.getName()===name)),error:.0008,lockBorder:true,masonryNormals:'regenerated hard face normals',masonryUV:'world-space projection in runtime'};
fs.writeFileSync('output/repair/world-optimization.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
