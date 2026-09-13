import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
const app=fs.readFileSync(new URL('../public/app/index.html',import.meta.url),'utf8');
const source=app.slice(app.indexOf('var ElderLive ='),app.indexOf('async function matchFreeQuestion('));
function fixture(persist){
  const state={lang:'zh',pending:[],thread:[],facts:[]};
  const context={Set,Date,Math,AbortSignal,window:{addEventListener(){}},document:{addEventListener(){}},Store:{familyId:()=> 'f'},aiAccessToken:async()=> 'token',
    fetch:async()=>Response.json({question:'Where are my keys?',needsFamily:true}),persistUpdate:async(fn)=>{fn(state);if(persist)await persist();},St:state,App:{route:'elder',qa:true},elderScreen:()=> 'qa'};
  vm.runInNewContext(source,context);context.ElderLive.family='f';context.ElderLive.lang='zh';context.ElderLive.client={commentary:()=>true};
  return {context,state,task:{isCurrent:()=>true,transcript:[{role:'user',text:'Where are my keys?'}]}};
}
test('live delegation confirms sending only after the family question is saved',async()=>{
  let complete; const wait=new Promise(r=>{complete=r;});const f=fixture(()=>wait);
  let resolved=false;const result=f.context.lookupElderLive(f.task).then(r=>{resolved=true;return r;});
  await new Promise(r=>setTimeout(r,0));assert.equal(resolved,false);complete();
  assert.match(await result,/successfully saved/);assert.equal(f.state.pending.length,1);
  await f.context.lookupElderLive(f.task);assert.equal(f.state.pending.length,1);
});
test('failed family persistence cannot return a successful live confirmation',async()=>{
  const f=fixture(async()=>{throw Error('offline');});
  await assert.rejects(f.context.lookupElderLive(f.task),/offline/);
  assert.equal(f.context.ElderLive.waiting.size,0);
});
test('a stale live request cannot create a family pending item',async()=>{
  const f=fixture();f.task.isCurrent=()=>false;
  assert.equal(await f.context.lookupElderLive(f.task),null);assert.equal(f.state.pending.length,0);
});
