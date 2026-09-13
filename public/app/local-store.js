(function(window){
  'use strict';
  window.createLocalStore=function({newFamily,storage,onStatus}){
    const database=window.localStorage, prefix='remember-us:local-family:';
    let state=null, code=null, role=null, pending=0, version=0;
    const subscribers=new Set();
    function status(){if(onStatus)onStatus('synced');}
    function read(id){const raw=database.getItem(prefix+id);return raw?JSON.parse(raw):null;}
    function emit(){queueMicrotask(()=>subscribers.forEach(fn=>fn(state)));}
    function saveSelection(){storage.setItem('local-code',code);storage.setItem('local-role',role);}
    async function attach(id,nextRole){
      const found=read(String(id));
      if(!found)throw new Error('Family not found in this browser. Create a local family first.');
      code=String(id);role=nextRole;state=found;saveSelection();status();emit();return state;
    }
    async function create(lang){
      let id;
      do{id=String(Math.floor(100000+Math.random()*900000));}while(database.getItem(prefix+id));
      const fresh=newFamily(id,lang);database.setItem(prefix+id,JSON.stringify(fresh));
      await attach(id,'family');return id;
    }
    async function refresh(){
      if(!code||pending)return state;
      const next=read(code);
      if(JSON.stringify(next)!==JSON.stringify(state)){state=next;emit();}
      status();return state;
    }
    async function update(mutator){
      const selected=code;
      if(!selected||typeof mutator!=='function')throw new Error('Select a local family first.');
      const optimistic=structuredClone(state);mutator(optimistic);
      if(JSON.stringify(optimistic)===JSON.stringify(state))return state;
      const operation=++version;pending++;state=optimistic;emit();
      function write(){
        if(code!==selected)throw new Error('Local family selection changed.');
        const current=read(selected);if(!current)throw new Error('Local family is unavailable.');
        const draft=structuredClone(current);mutator(draft);
        if(JSON.stringify(draft)===JSON.stringify(current))return current;
        draft.rev=(current.rev||0)+1;
        // Persist before publishing: quota failures must not appear as saved.
        database.setItem(prefix+selected,JSON.stringify(draft));
        if(operation===version){state=draft;emit();}
        status();return draft;
      }
      try{return await (window.navigator?.locks?window.navigator.locks.request(prefix+selected,write):write());}
      finally{pending--;if(code===selected&&!pending)await refresh();}
    }
    function resetSession(){code=null;role=null;state=null;storage.removeItem('local-code');storage.removeItem('local-role');}
    window.addEventListener('storage',event=>{if(event.key===prefix+code)void refresh();});
    return {
      initialize:async()=>{status();return {id:'local-demo'};}, create,attach,update,refresh,
      restoreSelection:async()=>{const id=storage.getItem('local-code');return id&&read(id)?attach(id,storage.getItem('local-role')||'family'):null;},
      resetFamily:()=>update(draft=>{const fresh=newFamily(code,draft.lang);Object.keys(draft).forEach(k=>delete draft[k]);Object.assign(draft,fresh);}),
      resetSession,signOut:async()=>{resetSession();emit();status();},
      get:()=>state,familyId:()=>code,role:()=>role,
      subscribe:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);},
    };
  };
})(window);
