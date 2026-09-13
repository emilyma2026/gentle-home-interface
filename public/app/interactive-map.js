(function(global){
  'use strict';
  // Fixed demonstration scale: changing the safe radius never moves the pin.
  const scale=6,homeX=420,homeY=333,rad=Math.PI/180;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function project(home,point){return {x:homeX+(point.lng-home.lng)*111320*Math.cos(home.lat*rad)/scale,y:homeY-(point.lat-home.lat)*111320/scale};}
  function unproject(home,p){return {lat:home.lat+(homeY-p.y)*scale/111320,lng:home.lng+(p.x-homeX)*scale/(111320*Math.cos(home.lat*rad))};}
  function distance(a,b){const x=(b.lat-a.lat)*rad,y=(b.lng-a.lng)*rad;return 12742000*Math.asin(Math.sqrt(Math.sin(x/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(y/2)**2));}
  function radius(v){return clamp(Math.round(v/10)*10,200,2000);}
  function markup(home,point,r,en){
    const p=project(home,point),d=Math.round(distance(home,point)),outside=d>r;
    return `<svg class="interactive-demo-map" data-demo-map viewBox="0 0 1000 667" role="group" aria-label="${en?'Interactive simulated map':'可交互模拟地图'}" style="width:100%;height:100%;display:block;touch-action:none">
      <image href="/app/singapore-map-base.png" width="1000" height="667" preserveAspectRatio="none"/>
      <circle data-safe-circle cx="${homeX}" cy="${homeY}" r="${r/scale}" fill="#76985b" fill-opacity=".18" stroke="#527946" stroke-width="5" stroke-dasharray="12 10"/>
      <text data-radius-label x="${homeX}" y="55" text-anchor="middle" fill="#35512e" font-size="28" font-weight="700" paint-order="stroke" stroke="#fffaf0" stroke-width="8">${en?'Safe area':'安全范围'} · ${r} m</text>
      <g transform="translate(${homeX} ${homeY})"><circle r="27" fill="#a17c50" stroke="white" stroke-width="4"/><path d="M-17 0 0-16 17 0M-12-3V16H12V-3" stroke="white" stroke-width="5" fill="none"/></g>
      <g data-map-radius role="slider" tabindex="0" aria-label="${en?'Safe radius':'安全范围'}" aria-valuemin="200" aria-valuemax="2000" aria-valuenow="${r}" transform="translate(${homeX+r/scale} ${homeY})" style="cursor:ew-resize"><circle r="46" fill="transparent"/><circle r="20" fill="#fffaf0" stroke="#527946" stroke-width="5"/><path d="M-8-7V7M0-7V7M8-7V7" stroke="#527946" stroke-width="3"/></g>
      <g data-map-pin role="slider" tabindex="0" aria-label="${en?'Elder location — drag or use arrow keys':'老人位置，拖动或使用方向键'}" aria-valuetext="${d} m" transform="translate(${p.x} ${p.y})" style="cursor:grab"><circle r="50" fill="transparent"/><path data-pin-shape d="M0 0C-13-20-30-33-30-51A30 30 0 0 1 30-51C30-33 13-20 0 0Z" fill="${outside?'#c26558':'#66866a'}" stroke="white" stroke-width="5"/><circle cy="-51" r="11" fill="white"/></g>
      <rect x="18" y="588" width="964" height="62" rx="22" fill="#fffaf0" fill-opacity=".94"/><text data-map-distance x="40" y="629" font-size="25" fill="#574734">${en?'Demo · drag the pin or circle handle':'模拟地图 · 可拖动位置标记或圆圈边缘'} · ${d} m</text>
    </svg>`;
  }
  function paint(svg,home,point,r,en){
    const p=project(home,point),d=Math.round(distance(home,point));
    svg.querySelector('[data-safe-circle]').setAttribute('r',r/scale);
    const handle=svg.querySelector('[data-map-radius]');handle.setAttribute('transform',`translate(${homeX+r/scale} ${homeY})`);handle.setAttribute('aria-valuenow',r);
    svg.querySelector('[data-radius-label]').textContent=(en?'Safe area':'安全范围')+' · '+r+' m';
    const pin=svg.querySelector('[data-map-pin]');pin.setAttribute('transform',`translate(${p.x} ${p.y})`);pin.setAttribute('aria-valuetext',d+' m');
    svg.querySelector('[data-pin-shape]').setAttribute('fill',d>r?'#c26558':'#66866a');
    svg.querySelector('[data-map-distance]').textContent=(en?'Demo · drag the pin or circle handle':'模拟地图 · 可拖动位置标记或圆圈边缘')+' · '+d+' m';
  }
  const api={project,unproject,distance,radius,markup,paint,dragging:false};
  api.bind=function(document,options){
    let drag=null;
    document.addEventListener('pointerdown',event=>{
      const control=event.target.closest('[data-map-pin],[data-map-radius]');if(!control)return;
      const svg=control.closest('[data-demo-map]'),s=options.state();if(!s)return;
      event.preventDefault();control.focus();svg.setPointerCapture(event.pointerId);
      drag={svg,home:s.home,point:s.point,r:s.radius,en:s.en,type:control.hasAttribute('data-map-pin')?'pin':'radius'};api.dragging=true;
    });
    document.addEventListener('pointermove',event=>{
      if(!drag)return;const pt=drag.svg.createSVGPoint();pt.x=event.clientX;pt.y=event.clientY;
      const p=pt.matrixTransform(drag.svg.getScreenCTM().inverse());
      if(drag.type==='pin')drag.point=unproject(drag.home,{x:clamp(p.x,45,955),y:clamp(p.y,80,570)});
      else drag.r=radius(Math.hypot(p.x-homeX,p.y-homeY)*scale);
      paint(drag.svg,drag.home,drag.point,drag.r,drag.en);
    });
    function finish(cancel){if(!drag)return;const last=drag;drag=null;api.dragging=false;if(cancel){options.cancel();return;}if(last.type==='pin')options.position(last.point);else options.radius(last.r);}
    document.addEventListener('pointerup',()=>finish(false));document.addEventListener('pointercancel',()=>finish(true));
    document.addEventListener('keydown',event=>{
      const control=event.target.closest('[data-map-pin],[data-map-radius]');if(!control||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const s=options.state();
      if(control.hasAttribute('data-map-radius'))options.radius(radius(s.radius+(['ArrowRight','ArrowUp'].includes(event.key)?100:-100)));
      else{const p=project(s.home,s.point);p.x+=(event.key==='ArrowRight'?100:event.key==='ArrowLeft'?-100:0)/scale;p.y+=(event.key==='ArrowDown'?100:event.key==='ArrowUp'?-100:0)/scale;options.position(unproject(s.home,p));}
    });
  };
  global.DemoMap=api;
})(typeof window==='undefined'?globalThis:window);
