import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const context={};vm.runInNewContext(readFileSync(new URL('../public/app/interactive-map.js',import.meta.url),'utf8'),context);const map=context.DemoMap;
test('map coordinates round trip without moving home',()=>{const home={lat:1.3327,lng:103.8475},point={lat:1.34,lng:103.86};const result=map.unproject(home,map.project(home,point));assert.ok(Math.abs(result.lat-point.lat)<1e-9);assert.ok(Math.abs(result.lng-point.lng)<1e-9);});
test('safe circle scales while elder pin stays fixed',()=>{const h={lat:1.3327,lng:103.8475},p=map.unproject(h,{x:600,y:333});const small=map.markup(h,p,400,true),large=map.markup(h,p,1200,true);assert.ok(map.distance(h,p)>400&&map.distance(h,p)<1200);assert.match(small,/r="66.666/);assert.match(large,/r="200"/);assert.match(small,/translate\(600/);assert.match(large,/translate\(600/);assert.equal(map.radius(9999),2000);assert.equal(map.radius(-10),200);});

test('crossing and resizing the safe area updates warnings without duplicate alerts',()=>{
 const source=readFileSync(new URL('../public/app/index.html',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function applyDemoRisk(s)'),source.indexOf('function setDemoPoint(point)'));
 const home={lat:1.3327,lng:103.8475};const c={DemoMap:map,homeOf:()=>home,locOf:s=>s.loc,rangeM:s=>s.radius,clockNow:()=> '12:00',todayKey:()=> '2026-09-13',requestBoundaryAlert:s=>{s.guide.pending=true;}};
 vm.runInNewContext(fn,c);
 const s={loc:map.unproject(home,{x:600,y:333}),radius:800,guide:{},risk:{state:'safe'},timeline:[]};
 c.applyDemoRisk(s);assert.equal(s.guide.pending,true);assert.equal(s.risk.state,'leaving');assert.equal(s.timeline.length,1);
 c.applyDemoRisk(s);assert.equal(s.timeline.length,1);
 s.radius=1400;c.applyDemoRisk(s);assert.equal(s.risk.state,'safe');assert.equal(s.guide.pending,false);
 s.radius=400;c.applyDemoRisk(s);assert.equal(s.guide.pending,true);
 s.loc=home;c.applyDemoRisk(s);assert.equal(s.risk.distanceM,0);assert.equal(s.guide.pending,false);assert.equal(s.alertCleared,true);
});
