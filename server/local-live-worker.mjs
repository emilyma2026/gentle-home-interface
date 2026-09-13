import {handleLiveRequest} from './live-runtime.mjs';

export default {
  async fetch(request,env){
    if(new URL(request.url).pathname.startsWith('/api/live/')){
      if(env.LIVE_LIMITER){
        const {success}=await env.LIVE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});
        if(!success)return Response.json({error:'LIVE_RATE_LIMITED'},{status:429});
      }
      return handleLiveRequest(request,{...env,LOCAL_FAMILY_MODE:'true'});
    }
    return env.ASSETS.fetch(request);
  }
};
