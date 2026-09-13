import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app/index.html',import.meta.url),'utf8');
test('comparison roles cannot overwrite or clear each other authentication and selection',()=>{
  const start=source.indexOf('function roleSessionStorage(');
  const factory=vm.runInNewContext(source.slice(start,source.indexOf('\ntry{',start))+'\nroleSessionStorage;');
  const map=new Map();
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const family=factory(storage,'family'),elder=factory(storage,'elder');
  for(const key of ['auth-token','alz:code']){
    family.setItem(key,'family-value'); elder.setItem(key,'elder-value');
    assert.equal(family.getItem(key),'family-value');
    elder.removeItem(key);
    assert.equal(family.getItem(key),'family-value');
    assert.equal(elder.getItem(key),null);
  }
  assert.equal(factory(storage,''),storage);
});
