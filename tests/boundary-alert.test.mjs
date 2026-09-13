import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/app/index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function enforceEmbeddedRole(){'),html.indexOf('/* 已确认的待办里'));
function setup(){
  const St={setup:true,lang:'en',guide:{active:false,done:false},risk:{},call:{phase:'idle'}};
  const c={St,App:{route:'elder',paired:true},EMBED_ROLE:'family',Connection:{authenticated:true},isOut:()=>true,callDir:()=>'',homePoint:()=>({}),currentPoint:()=>({}),render(){},showNotice(){},Date,persistUpdate:async fn=>fn(St)};
  vm.runInNewContext(source,c);return c;
}
test('family comparison ignores a stale elder route and paired state',()=>{
  const c=setup();c.enforceEmbeddedRole();assert.equal(c.App.route,'family');assert.equal(c.App.paired,false);assert.equal(c.App.joinAs,'family');
});
test('crossing the boundary raises an alert without starting navigation',()=>{
  const c=setup();c.App.paired=false;c.requestBoundaryAlert(c.St);
  assert.equal(c.St.guide.active,false);assert.equal(c.St.risk.state,'leaving');assert.equal(c.elderScreen(),'boundary');
});
test('confirmation starts guidance and records family notification',async()=>{
  const c=setup();c.App.paired=false;c.requestBoundaryAlert(c.St);await c.confirmBoundaryNavigation();
  assert.equal(c.St.guide.active,true);assert.equal(c.St.guide.pending,false);assert.ok(c.St.risk.familyNotifiedAt);assert.equal(c.elderScreen(),'guide');
});
test('failed persistence keeps the elder on the boundary alert even after optimistic mutation',async()=>{
  const c=setup();c.App.paired=false;c.requestBoundaryAlert(c.St);c.persistUpdate=async fn=>{fn(c.St);throw Error('offline');};
  await c.confirmBoundaryNavigation();assert.equal(c.elderScreen(),'boundary');assert.equal(c.App.boundarySyncFailed,true);
});
test('returning inside the range hides the pending alert; active calls take priority',()=>{
  const c=setup();c.App.paired=false;c.requestBoundaryAlert(c.St);c.isOut=()=>false;assert.equal(c.elderScreen(),'standby');
  c.isOut=()=>true;c.St.call.phase='talking';assert.equal(c.elderScreen(),'talking');
});
