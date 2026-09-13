import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
test('all inline application and shell scripts compile',()=>{
 for(const file of ['public/index.html','public/app/index.html']){
  const html=readFileSync(new URL(file,root),'utf8');
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1],{filename:file});
 }
});
test('static app loads only local demo scripts and contains no configuration keys',()=>{
 const html=readFileSync(new URL('dist/app/index.html',root),'utf8');
 const sources=Array.from(html.matchAll(/<script[^>]*src="([^"]+)"/g),m=>m[1]);
 assert.deepEqual(sources,['/app/local-store.js','/app/local-demo.js']);
 assert.doesNotMatch(html,/sb_publishable_|sk-proj-/);
 for(const name of ['maps-config.js','supabase-config.js','supabase-store.js','live-voice.js','voice.js','navigation.js'])assert.equal(existsSync(new URL('dist/app/'+name,root)),false);
 const config=JSON.parse(readFileSync(new URL('wrangler.json',root),'utf8'));
 assert.equal(config.main,undefined);assert.equal(config.assets.directory,'./dist');
 assert.match(readFileSync(new URL('dist/_headers',root),'utf8'),/connect-src 'none'/);
});
