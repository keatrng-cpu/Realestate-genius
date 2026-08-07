import * as THREE from "three";

// Ray-cast a grid of screen points against the arc, report % of screen covered.
function coverage({thetaStart, thetaLength, height, lookZOffset, drag, aspect, radius=4}) {
  const geo = new THREE.CylinderGeometry(radius,radius,height,96,1,true,thetaStart,thetaLength);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({side:THREE.BackSide}));
  mesh.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
  cam.position.set(0,0,0.0001);
  cam.lookAt(new THREE.Vector3(Math.sin(drag)*3, 0, Math.cos(drag)*3 + lookZOffset));
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const rc = new THREE.Raycaster();
  let hit=0, n=0;
  for (let i=0;i<=20;i++) for (let j=0;j<=20;j++){
    const ndc = new THREE.Vector2(-1 + i/10, -1 + j/10);
    rc.setFromCamera(ndc, cam);
    n++;
    if (rc.intersectObject(mesh, false).length) hit++;
  }
  return Math.round(100*hit/n);
}

const drags=[0,0.35,0.7,1.1,1.4,1.6];
const aspects={ultrawide:2560/494, desktop:1150/494, tablet:720/500, mobile:327/503};

console.log("SCREEN COVERAGE %  (100 = no void visible)\n");
for (const [nm,asp] of Object.entries(aspects)) {
  const cur = drags.map(d=>coverage({thetaStart:-Math.PI/2.2,thetaLength:Math.PI/1.1,height:4.6,lookZOffset:-3,drag:d,aspect:asp}));
  console.log(`CURRENT  ${nm.padEnd(10)} drag ${drags.join('  ')} -> ${cur.join('%  ')}%`);
}
console.log("");
for (const [nm,asp] of Object.entries(aspects)) {
  // FIX: arc 252deg centred on +Z, height 8, lookAt on camera-centred circle, clamped by aspect
  const ARC_HALF = Math.PI*0.7;
  const cur = drags.map(d=>{
    const halfH = THREE.MathUtils.degToRad(75)/2;
    const halfW = Math.atan(Math.tan(halfH)*asp);
    const lim = Math.max(0, ARC_HALF - halfW);
    const dd = THREE.MathUtils.clamp(d,-lim,lim);
    return coverage({thetaStart:-ARC_HALF,thetaLength:ARC_HALF*2,height:8,lookZOffset:0,drag:dd,aspect:asp});
  });
  console.log(`FIXED    ${nm.padEnd(10)} drag ${drags.join('  ')} -> ${cur.join('%  ')}%`);
}
