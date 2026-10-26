import * as THREE from 'three';
const ISO_PITCH = Math.atan(1 / Math.sqrt(2));
// A medium tactical framing: enough room to read the arena without making
// Aeren feel tiny. Smaller orthographic heights mean a tighter zoom.
const DEFAULT_HEIGHT = 23;

export class KHCamera {
  constructor(camera, domElement) {
    this.camera=camera; this.domElement=domElement;
    this.yaw=Math.PI/4; this.pitch=ISO_PITCH;
    this.distance=75; this.targetDistance=75;
    this.viewHeight=DEFAULT_HEIGHT; this.targetViewHeight=DEFAULT_HEIGHT;
    this.shoulderOffset=0; this.pivotHeight=.9;
    this.currentPivot=new THREE.Vector3(); this.currentPos=new THREE.Vector3(); this.lookTarget=new THREE.Vector3();
    this.trauma=0; this.dragging=false; this.enabled=true; this.initialized=false;
    this.manualTimer=0; this.presetIndex=0;
    // V only changes how much of the arena is visible. Every view remains
    // player-centered, as in an action RPG camera.
    this.presets=[
      {name:'ISOMÉTRICA · SEGUIMIENTO',height:23},
      {name:'ISOMÉTRICA · COMBATE',height:26},
      {name:'ISOMÉTRICA · ARENA',height:32},
      {name:'ISOMÉTRICA · AMPLIA',height:39},
    ];
    this._desired=new THREE.Vector3(); this._pivot=new THREE.Vector3(); this._look=new THREE.Vector3();
    this.initInput();
  }
  initInput(){
    this.domElement.addEventListener('mousedown',e=>{if(this.enabled&&(e.button===1||e.button===2)){this.dragging=true;e.preventDefault();}});
    addEventListener('mouseup',()=>{this.dragging=false;});
    addEventListener('blur',()=>{this.dragging=false;});
    addEventListener('mousemove',e=>{if(this.enabled&&this.dragging)this.yaw-=e.movementX*.004;});
    this.domElement.addEventListener('wheel',e=>{
      if(!this.enabled)return;e.preventDefault();
      this.targetViewHeight=THREE.MathUtils.clamp(this.targetViewHeight*Math.exp(e.deltaY*.0013),23,65);
    },{passive:false});
  }
  resize(width=this.domElement.parentElement.clientWidth || innerWidth,height=this.domElement.parentElement.clientHeight || innerHeight){
    const aspect=width/height;
    this.camera.aspect=aspect;
    const framing=this.viewHeight*(aspect<.8?1.12:1);
    this.camera.left=-framing*aspect/2;this.camera.right=framing*aspect/2;
    this.camera.top=framing/2;this.camera.bottom=-framing/2;
    this.camera.updateProjectionMatrix();
  }
  cyclePreset(){
    this.presetIndex=(this.presetIndex+1)%this.presets.length;
    this.targetViewHeight=this.presets[this.presetIndex].height;
    return this.presets[this.presetIndex].name;
  }
  reset(player){this.snapTo(player);}
  snapTo(player){
    this.yaw=Math.PI/4;this.pitch=ISO_PITCH;this.trauma=0;this.dragging=false;
    this.presetIndex=0;this.viewHeight=this.targetViewHeight=DEFAULT_HEIGHT;
    this.currentPivot.copy(player.position);this.currentPivot.y+=.9;
    this._positionFor(this.currentPivot,this.currentPos);
    this.lookTarget.copy(this.currentPivot);this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.lookTarget);this.resize();this.initialized=true;
  }
  _positionFor(pivot,out){
    const distance=Math.max(75,this.viewHeight*1.8);
    const horizontal=Math.cos(ISO_PITCH)*distance;
    return out.set(pivot.x+Math.sin(this.yaw)*horizontal,pivot.y+Math.sin(ISO_PITCH)*distance,pivot.z+Math.cos(this.yaw)*horizontal);
  }
  addShake(amount=.12){this.trauma=Math.min(.38,this.trauma+amount);}
  getForwardXZ(){return new THREE.Vector3(-Math.sin(this.yaw),0,-Math.cos(this.yaw));}
  getRightXZ(){return new THREE.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw));}
  update(dt,elapsed,player,lockedEnemy,mapScene){
    if(!this.initialized)this.snapTo(player);
    this.pitch=ISO_PITCH;
    this._pivot.copy(player.position);
    this._pivot.y+=.9;
    // Responsive, buttery follow with a small cinematic lag; never parks on
    // a world landmark, even while changing camera presets or moving fast.
    this.currentPivot.lerp(this._pivot,1-Math.exp(-dt*14));
    this.viewHeight=THREE.MathUtils.lerp(this.viewHeight,this.targetViewHeight,1-Math.exp(-dt*7));
    this._positionFor(this.currentPivot,this._desired);
    this.currentPos.lerp(this._desired,1-Math.exp(-dt*16));
    this.camera.position.copy(this.currentPos);
    this.lookTarget.copy(this.currentPivot);
    if(this.trauma>0){
      const shake=this.trauma*this.trauma*.18;
      this.camera.position.x+=Math.sin(elapsed*48)*shake;
      this.camera.position.y+=Math.cos(elapsed*55)*shake;
      this.trauma=Math.max(0,this.trauma-dt*2.7);
    }
    this.camera.lookAt(this.lookTarget);this.resize();
  }
}

