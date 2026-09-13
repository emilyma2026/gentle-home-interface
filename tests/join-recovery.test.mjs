import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../public/app/index.html',import.meta.url),'utf8');
function fixture(){
 let finish,expire;
 const pending=new Promise(r=>finish=r);
 const c={Connection:{pendingAction:false,authenticated:true},App:{route:'join',joinAs:'family'},D:{joinErr:'Invalid'},lang:'en',EMBED_ROLE:'',St:null,
  Store:{attach:()=>pending,get:()=>({people:[]}),resetSession(){c.resets++}},resets:0,
  syncActionAvailability(){},render(){},setConnectionStatus(s){c.Connection.state=s;},reportStoreError(){},rememberDevice(){},newPerson:()=>({id:'p'}),persistUpdate:async()=>{},clearDevice(){},
  setTimeout(fn){expire=fn;return 1},clearTimeout(){}};
 const start=html.indexOf('async function pair(code){');
 vm.runInNewContext(html.slice(start,html.indexOf('async function startElderDevice()',start)),c);
 return {c,finish,expire:()=>expire()};
}
test('join deadline restores Next and preserves entered code; late completion cannot navigate',async()=>{
 const f=fixture();const action=f.c.pair('825992');f.expire();await action;
 assert.equal(f.c.Connection.pendingAction,false);assert.equal(f.c.App.joinCode,'825992');assert.match(f.c.App.err,/timed out/i);
 f.finish();await Promise.resolve();await Promise.resolve();assert.equal(f.c.App.route,'join');
});
test('Back cancels join immediately and late completion cannot move to onboarding',async()=>{
 const f=fixture();const action=f.c.pair('825992');f.c.cancelJoin();await action;
 assert.equal(f.c.Connection.pendingAction,false);assert.equal(f.c.App.route,'familyStart');
 f.finish();await Promise.resolve();await Promise.resolve();assert.equal(f.c.App.route,'familyStart');
});

test('successful join opens onboarding and releases Next',async()=>{
 const f=fixture();const action=f.c.pair('825992');f.finish();await action;
 assert.equal(f.c.App.route,'obMe');assert.equal(f.c.Connection.pendingAction,false);assert.equal(f.c.Connection.authenticated,true);
});
test('cancelled attempt cannot clear the retry busy flag',async()=>{
 const f=fixture();const old=f.c.pair('825992');f.c.cancelJoin();
 f.c.App.route='join';const retry=f.c.pair('825992');await old;
 assert.equal(f.c.Connection.pendingAction,true);
 f.finish();await retry;assert.equal(f.c.App.route,'obMe');
});
