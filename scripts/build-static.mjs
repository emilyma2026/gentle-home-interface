import { cp, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),target=path.resolve(root,'dist');
if(target!==path.join(root,'dist'))throw new Error('Invalid build directory');
await rm(target,{recursive:true,force:true});await mkdir(path.join(target,'app'),{recursive:true});
const excluded=new Set(['supabase-config.js','supabase-store.js','maps-config.js','live-voice.js','voice.js','navigation.js']);
for(const entry of await readdir(path.join(root,'public','app'),{withFileTypes:true})){
 if(excluded.has(entry.name))continue;
 await cp(path.join(root,'public','app',entry.name),path.join(target,'app',entry.name),{recursive:true});
}
for(const file of ['index.html','_headers','favicon.ico','robots.txt'])await copyFile(path.join(root,'public',file),path.join(target,file));
// Remove the old Nitro pointer so Wrangler uses the static assets configuration.
const oldPointer=path.resolve(root,'.wrangler','deploy','config.json');
if(oldPointer===path.join(root,'.wrangler','deploy','config.json'))await rm(oldPointer,{force:true});
console.log('Built static demo in dist. No server runtime or API keys included.');
