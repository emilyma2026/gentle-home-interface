import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app/local-store.js', import.meta.url), 'utf8');
function fixture() {
  const data = new Map();
  let lock=Promise.resolve();
  const storage = {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  function client() {
    const window = {addEventListener(){},localStorage:storage,navigator:{locks:{request:(_name,fn)=>{const next=lock.then(fn);lock=next.catch(()=>{});return next;}}}};
    vm.runInNewContext(source,{window,structuredClone,queueMicrotask});
    const session = new Map();
    return window.createLocalStore({newFamily:(code,lang)=>({code,lang,rev:0,facts:[]}),
      storage:{getItem:k=>session.get(k),setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)}});
  }
  return {client,data};
}
test('local family survives reload, supports two roles, and merges sequential edits', async()=>{
  const {client}=fixture(), family=client(), elder=client();
  await family.initialize(); const code=await family.create('en');
  await elder.attach(code,'elder');
  await family.update(s=>s.facts.push('family reminder'));
  await elder.update(s=>s.paired=true);
  await family.refresh();
  assert.deepEqual(Array.from(family.get().facts),['family reminder']);
  assert.equal(family.get().paired,true);
  assert.equal(elder.role(),'elder');
  const reload=client(); await reload.attach(code,'family');
  assert.equal(reload.get().paired,true);
  await elder.signOut();
  assert.equal(elder.get(),null);
  assert.equal(family.get().paired,true);
  await assert.rejects(elder.attach('000000','elder'),/browser/);
});
test('unchanged local updates do not increment revision or trigger subscribers',async()=>{
  const {client}=fixture(), store=client(); await store.create('en');
  let events=0; store.subscribe(()=>events++);
  await store.update(()=>{}); await Promise.resolve();
  assert.equal(store.get().rev,0); assert.equal(events,0);
});
test('form edits are visible immediately while the storage lock is pending',async()=>{
 const {client}=fixture(),store=client();await store.create('en');
 const first=store.update(s=>s.time='5 pm');
 assert.equal(store.get().time,'5 pm');
 const second=store.update(s=>s.what='Drink water');
 assert.equal(store.get().what,'Drink water');
 await Promise.all([first,second]);
 assert.equal(store.get().time,'5 pm');assert.equal(store.get().what,'Drink water');
});
