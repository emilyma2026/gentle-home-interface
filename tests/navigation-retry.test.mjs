import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app/index.html',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
test('failed route does not retry recursively on render',async()=>{
  let calls=0;
  const c={App:{route:'elder'},St:{lang:'en',guide:{active:true}},homePoint:()=>({}),currentPoint:()=>({}),el:()=>null,D:{routeFailed:'failed'},shouldUseDemoFallback:()=>false,window:{Navigation:{distanceMeters:()=>900,routeHome:async()=>{calls++;throw Error('unavailable');}}}};
  vm.runInNewContext(section('function initGuideMap(){','function setHomeFromGps(){'),c);
  c.render=()=>c.initGuideMap();c.initGuideMap();c.initGuideMap();
  await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);assert.equal(c.App.guideRouteStatus,'error');
});
test('Singapore sample never starts real GPS',()=>{
  let started=false;
  const c={App:{},St:{demoScenario:'singapore'},window:{Navigation:{isWatching:()=>false}},ensureHomePointFromAddress:()=>{started=true;},render(){}};
  vm.runInNewContext(section('function startGps(){','function stopGps(){'),c);c.startGps();assert.equal(started,false);
});
