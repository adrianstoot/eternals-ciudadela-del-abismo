import * as THREE from 'three';

// Cut a doorway from the actual imported masonry. Keeping only a collision
// exception would let the character visibly walk through a solid parapet.
export function cutMasonryPassage(mesh, worldToPassage, width, length, height) {
  const source=mesh.geometry;
  if(!source.index || !source.attributes.normal)return 0;
  source.computeBoundingBox();
  const transform=new THREE.Matrix4().multiplyMatrices(worldToPassage,mesh.matrixWorld);
  const bounds=source.boundingBox.clone().applyMatrix4(transform);
  const cutBox=new THREE.Box3(new THREE.Vector3(-width*.5,.16,-length*.5),new THREE.Vector3(width*.5,height,length*.5));
  if(!bounds.intersectsBox(cutBox))return 0;
  const p=source.attributes.position,n=source.attributes.normal,u=source.attributes.uv||{getX:()=>0,getY:()=>0};
  const coords=new Float32Array(p.count*3),v=new THREE.Vector3();
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(transform);coords[i*3]=v.x;coords[i*3+1]=v.y;coords[i*3+2]=v.z;}
  const indices=[],newVertices=[];
  const vertex=i=>({c:[coords[i*3],coords[i*3+1],coords[i*3+2]],p:[p.getX(i),p.getY(i),p.getZ(i)],n:[n.getX(i),n.getY(i),n.getZ(i)],uv:[u.getX(i),u.getY(i)]});
  const mix=(a,b,t)=>({c:a.c.map((v,i)=>THREE.MathUtils.lerp(v,b.c[i],t)),p:a.p.map((v,i)=>THREE.MathUtils.lerp(v,b.p[i],t)),n:a.n.map((v,i)=>THREE.MathUtils.lerp(v,b.n[i],t)),uv:a.uv.map((v,i)=>THREE.MathUtils.lerp(v,b.uv[i],t))});
  const split=(poly,axis,value,greater)=>{
    const inside=[],outside=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=greater?a.c[axis]-value:value-a.c[axis],db=greater?b.c[axis]-value:value-b.c[axis];
      const ina=da>=-1e-7,inb=db>=-1e-7;
      (ina?inside:outside).push(a);
      if(ina!==inb){const edge=mix(a,b,da/(da-db));inside.push(edge);outside.push(edge);}
    }
    return[inside,outside];
  };
  const planes=[[0,-width*.5,true],[0,width*.5,false],[1,.16,true],[1,height,false],[2,-length*.5,true],[2,length*.5,false]];
  let changed=0;
  for(let k=0;k<source.index.count;k+=3){
    const ids=[source.index.getX(k),source.index.getX(k+1),source.index.getX(k+2)];
    let overlaps=true;
    for(let axis=0;axis<3;axis++){
      const aa=coords[ids[0]*3+axis],bb=coords[ids[1]*3+axis],cc=coords[ids[2]*3+axis];
      if(Math.max(aa,bb,cc)<cutBox.min.getComponent(axis)||Math.min(aa,bb,cc)>cutBox.max.getComponent(axis)){overlaps=false;break;}
    }
    if(!overlaps){indices.push(...ids);continue;}
    let remainder=ids.map(vertex);const outside=[];
    for(const [axis,value,greater]of planes){
      if(remainder.length<3)break;
      const [keep,drop]=split(remainder,axis,value,greater);
      if(drop.length>=3)outside.push(drop);
      remainder=keep;
    }
    if(remainder.length<3){indices.push(...ids);continue;}
    changed++;
    for(const poly of outside)for(let i=1;i<poly.length-1;i++)for(const vert of [poly[0],poly[i],poly[i+1]]){
      indices.push(p.count+newVertices.length);newVertices.push(vert);
    }
  }
  if(!changed)return 0;
  const positions=new Float32Array((p.count+newVertices.length)*3),normals=new Float32Array(positions.length),uvs=new Float32Array((p.count+newVertices.length)*2);
  for(let i=0;i<p.count;i++){positions.set([p.getX(i),p.getY(i),p.getZ(i)],i*3);normals.set([n.getX(i),n.getY(i),n.getZ(i)],i*3);uvs.set([u.getX(i),u.getY(i)],i*2);}
  newVertices.forEach((vert,i)=>{const at=p.count+i;positions.set(vert.p,at*3);v.set(...vert.n).normalize();normals.set([v.x,v.y,v.z],at*3);uvs.set(vert.uv,at*2);});
  const result=new THREE.BufferGeometry();
  result.setAttribute('position',new THREE.BufferAttribute(positions,3));result.setAttribute('normal',new THREE.BufferAttribute(normals,3));result.setAttribute('uv',new THREE.BufferAttribute(uvs,2));result.setIndex(indices);
  result.computeBoundingSphere();result.computeBoundingBox();mesh.geometry=result;source.dispose();return changed;
}
