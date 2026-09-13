(function(window){
  'use strict';
  window.Voice={speak:function(text,options){
    if(!window.speechSynthesis)return Promise.resolve();
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(String(text));
    utterance.lang=options?.lang==='en'?'en-US':'zh-CN';utterance.rate=.85;
    window.speechSynthesis.speak(utterance);return Promise.resolve();
  }};
  function distance(a,b){
    const r=Math.PI/180,lat=(b.lat-a.lat)*r,lng=(b.lng-a.lng)*r;
    return 6371000*2*Math.asin(Math.sqrt(Math.sin(lat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(lng/2)**2));
  }
  function unavailable(){return Promise.reject({code:'maps_key_missing',message:'Local schematic map · simulated location'});}
  window.Navigation={distanceMeters:distance,isWatching:()=>false,start:()=>false,stop(){},
    locate:(_ok,fail)=>fail({code:'demo_location'}),createMap:unavailable,loadMaps:unavailable,
    routeHome:unavailable,findNearbyPlaces:()=>Promise.resolve([]),geocodeAddress:unavailable};
})(window);
