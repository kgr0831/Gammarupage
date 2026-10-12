/* Pixel silhouettes stay on their grid; motion is interpolated in elapsed time. */
(() => {
  'use strict';
  const SCALE = 3;
  const FRAME_MS = 1000 / 30;
  const C = { ink:'#f0e7db', paper:'#d4c5bf', edge:'#8f819d', shade:'#59465f', dark:'#211c2a', deep:'#111016', pink:'#ef88bf', rose:'#b4518b', plum:'#703e68', green:'#b8d4a0', leaf:'#739378', blue:'#92adbd', sky:'#414b6a', gold:'#d2b889' };
  let ctx;
  function r(x,y,w,h,color) {
    if(w<=0||h<=0) return;
    ctx.fillStyle=C[color]||color;
    ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));
  }
  function at(x,y,draw) {
    ctx.save();
    ctx.translate(Math.round(x*SCALE)/SCALE,Math.round(y*SCALE)/SCALE);
    draw();ctx.restore();
  }
  function clip(x,y,w,h,draw) {
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();draw();ctx.restore();
  }
  function line(x0,y0,x1,y1,color='edge') {
    x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
    const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;
    let error=dx+dy;
    while(true){r(x0,y0,1,1,color);if(x0===x1&&y0===y1)break;const e=error*2;if(e>=dy){error+=dy;x0+=sx;}if(e<=dx){error+=dx;y0+=sy;}}
  }
  function box(x,y,w,h,fill='dark',edge='edge') {
    r(x+2,y+2,w,h,'deep');r(x+1,y,w-2,h,edge);r(x,y+1,w,h-2,edge);
    r(x+1,y+1,w-2,h-2,fill);r(x+2,y+1,w-4,1,'shade');
  }
  function dither(x,y,w,h,color,step=4) {
    for(let yy=y;yy<y+h;yy+=2)for(let xx=x+(yy%4?2:0);xx<x+w;xx+=step)r(xx,yy,1,1,color);
  }
  function sprite(rows,x,y,palette,scale=1) {
    rows.forEach((row,yy)=>[...row].forEach((key,xx)=>{if(palette[key])r(x+xx*scale,y+yy*scale,scale,scale,palette[key]);}));
  }
  const actor=['...EEEE...','..EIIIPE..','.EIIIIIP..','.EIIDIIP..','..EIIIPE..','...SSSS...','..SPPPPS..','.SSPPPPSS.','...PPPP...','...SSSS...','...II.II..','...II.II..','...II.....'];
  const actorColors={E:'edge',I:'ink',P:'pink',D:'dark',S:'rose'};
  const cursor=['I.........','II........','IPI.......','IPPI......','IPPPI.....','IPPPPI....','IPPPPPI...','IPPPPPPPI.','IPPPPIIIII','IPIPPI....','II.IPPI...','I..IPPI...','....II....'];
  function pointer(x,y){at(x,y,()=>sprite(cursor,0,0,{I:'ink',P:'dark'}));}
  // The pencil's graphite tip is exactly (x,y), including on the return stroke.
  function pencil(x,y) {
    at(x,y,()=>{
      r(0,0,1,1,'ink');r(1,-2,2,2,'paper');
      for(let i=3;i<18;i++){r(i,-i,3,3,'pink');r(i+2,-i,1,2,'rose');}
      r(18,-20,4,3,'paper');r(18,-17,3,1,'edge');
    });
  }
  function player(x,y,time) {
    at(x,y,()=>{
      sprite(actor.slice(0,10),0,0,actorColors);
      const feet=Math.floor(time*6)%2;
      r(3,10,2,feet?2:3,'ink');r(6,10,2,feet?3:2,'ink');
    });
  }
  function flag(x,y,time) {
    r(x,y,1,18,'ink');r(x+1,y,10,6,'rose');
    r(x+1,y+(Math.sin(time*2.5)>0?0:1),8,4,'pink');r(x-2,y+18,5,1,'shade');
  }
  function cloud(x,y,color='shade'){r(x+5,y,14,3,color);r(x+2,y+3,22,4,color);r(x,y+7,29,3,color);}
  function tree(x,y){r(x+8,y+14,4,17,'shade');r(x+6,y+8,8,11,'leaf');r(x+2,y+10,16,6,'leaf');r(x,y+5,20,7,'green');r(x+4,y,13,7,'green');r(x+5,y+3,4,2,'ink');r(x+14,y+9,4,3,'leaf');}
  const mix=(a,b,t)=>a+(b-a)*t;
  const ease=t=>t*t*(3-2*t);
  // Arc length gives the nib and its mark one shared, constant-speed path.
  function route(points) {
    let length=0;
    const nodes=points.map((point,index)=>{
      if(index)length+=Math.hypot(point.x-points[index-1].x,point.y-points[index-1].y);
      return {...point,distance:length};
    });
    return {nodes,length};
  }
  function pointAt(path,progress) {
    const distance=Math.max(0,Math.min(1,progress))*path.length;
    let index=0;
    while(index<path.nodes.length-1&&path.nodes[index+1].distance<=distance)index++;
    const a=path.nodes[index],b=path.nodes[index+1]||a;
    const fraction=b.distance===a.distance?0:(distance-a.distance)/(b.distance-a.distance);
    return {x:mix(a.x,b.x,fraction),y:mix(a.y,b.y,fraction),index};
  }
  function penCycle(path,time,duration) {
    const hold=.8,back=1.6,phase=time%(duration+hold+back);
    if(phase<=duration+hold) {
      const progress=Math.min(1,phase/duration);
      return {tip:pointAt(path,progress),progress,opacity:1};
    }
    const u=(phase-duration-hold)/back,start=path.nodes[0],end=path.nodes.at(-1);
    const lift=Math.min(18,Math.min(start.y,end.y)*.4);
    return {tip:{x:mix(end.x,start.x,ease(u)),y:mix(end.y,start.y,ease(u))-Math.sin(u*Math.PI)*lift},progress:1,opacity:1-ease(u)};
  }
  const planPath=route(Array.from({length:65},(_,i)=>({x:59+i,y:83-Math.sin(i/64*Math.PI)*25})));
  const artPath=route(actor.flatMap((row,yy)=>{
    const cells=[...row].map((key,xx)=>({x:33+xx*4,y:24+yy*4,color:actorColors[key]}));
    if(yy%2)cells.reverse();return cells.filter(cell=>cell.color);
  }));
  function terrainBase(x,y,w,h,decor=true) {
    clip(x,y,w,h,()=>{
      r(x,y,w,h,'deep');
      if(decor){cloud(x+8,y+8,'dark');cloud(x+w-40,y+4,'dark');for(let i=0;i<w;i+=2){const hill=Math.round(7+Math.sin(i*.07)*5+Math.sin(i*.15)*2);r(x+i,y+h-24-hill,2,hill+24,'dark');}}
      const ground=y+h-10;
      r(x,ground,w,10,'shade');r(x,ground,w,2,'pink');r(x,ground+2,w,2,'rose');dither(x,ground+5,w,5,'plum');
    });
  }
  function terrainMotion(x,y,w,h,time) {
    clip(x,y,w,h,()=>{
      const phase=(time%6)/6,travel=w-22;
      const px=x+5+travel*phase,ground=y+h-10;
      const hop=phase>.32&&phase<.7?Math.sin((phase-.32)/.38*Math.PI)*10:0;
      player(px,ground-13-hop,time);
      if(w>75)flag(x+w-20,ground-18,time);
    });
  }
  const definitions={
    world:{width:384,height:160,
      base(){
        // No opaque panel or full-width ground: only transparent scene fragments.
        for(let i=0;i<22;i++)r(18+(i*43)%345,15+(i*29)%122,1,1,i%4?'shade':'edge');
        cloud(28,43,'dark');cloud(273,28,'dark');
        r(53,110,147,2,'rose');r(59,112,133,6,'plum');r(73,118,108,4,'dark');r(91,122,71,4,'dark');
        dither(60,113,128,5,'shade',7);tree(72,79);
        r(231,84,86,2,'pink');r(235,86,78,6,'plum');r(246,92,57,5,'dark');r(259,97,31,4,'dark');
        dither(238,88,71,3,'shade',7);
        r(15,145,28,1,'shade');r(216,135,42,1,'shade');
      },
      motion(time){
        flag(288,66,time);
        const phase=time%8;
        let x,y;
        if(phase<2){x=mix(106,162,phase/2);y=97;}
        else if(phase<3.8){const u=(phase-2)/1.8;x=mix(162,248,u);y=mix(97,71,u)-Math.sin(u*Math.PI)*28;}
        else{x=mix(248,274,Math.min(1,(phase-3.8)/1.1));y=71;}
        ctx.save();ctx.globalAlpha=phase>6?1-ease((phase-6)/2):Math.min(1,phase*3);player(x,y,time);ctx.restore();
        at(Math.sin(time*.2)*5,0,()=>cloud(159,38,'shade'));
      }
    },
    planning:{width:160,height:112,stillTime:5.1,
      base(){
        box(8,7,107,83,'shade','edge');box(12,11,99,75,'dark','paper');
        for(let x=18;x<106;x+=8)line(x,18,x,80,'shade');for(let y=18;y<81;y+=8)line(17,y,105,y,'shade');
        r(20,24,20,2,'paper');r(20,29,34,1,'edge');
        line(21,63,38,46,'paper');line(38,46,54,60,'paper');line(54,60,73,35,'paper');line(73,35,96,62,'paper');
        box(44,37,106,67,'dark','paper');r(49,43,42,2,'pink');r(49,48,22,1,'edge');
        line(51,92,68,92,'ink');line(68,92,68,86,'ink');line(68,86,84,86,'ink');line(84,86,84,92,'ink');line(84,92,103,92,'ink');line(103,92,103,86,'ink');line(103,86,140,86,'ink');
        r(53,98,8,1,'edge');r(116,98,22,1,'edge');
      },
      motion(time){
        flag(132,68,time);
        const cycle=penCycle(planPath,time,4.8),head=pointAt(planPath,cycle.progress);
        ctx.save();ctx.globalAlpha=cycle.opacity;
        for(let i=1;i<=head.index;i++)line(planPath.nodes[i-1].x,planPath.nodes[i-1].y,planPath.nodes[i].x,planPath.nodes[i].y,'pink');
        const tail=planPath.nodes[head.index];line(tail.x,tail.y,head.x,head.y,'pink');ctx.restore();
        pencil(cycle.tip.x,cycle.tip.y);
      }
    },
    programming:{width:160,height:112,
      base(){
        box(8,7,119,79,'shade','paper');box(13,12,109,65,'deep','edge');r(55,86,24,10,'shade');r(47,96,40,3,'edge');
        [23,31,39,47,55,63].forEach(y=>r(18,y,2,1,'shade'));
        box(94,66,58,42,'dark','paper');terrainBase(98,70,50,34,false);
        r(12,103,72,6,'shade');for(let x=16;x<80;x+=5)r(x,104,3,2,'edge');
        line(134,35,144,35,'rose');line(144,35,144,57,'rose');r(142,55,5,1,'pink');r(143,56,3,1,'pink');r(144,57,1,1,'pink');
      },
      motion(time){
        const phase=time%10,rows=[[24,23,29,'pink'],[31,31,55,'paper'],[31,39,39,'blue'],[31,47,50,'paper'],[31,55,20,'pink'],[24,63,15,'edge']];
        rows.forEach(([x,y,w,color],i)=>r(x,y,w*Math.min(1,Math.max(0,(phase-i*.7)/.7)),2,color));
        const index=Math.min(5,Math.floor(phase/.7)),[x,y,w]=rows[index];
        if(Math.floor(time*2)%2===0)r(x+w*Math.min(1,Math.max(0,(phase-index*.7)/.7))+2,y-1,1,4,'pink');
        terrainMotion(98,70,50,34,time);
      }
    },
    art:{width:160,height:112,stillTime:7.4,
      base(){
        box(8,7,101,96,'shade','paper');
        clip(14,13,89,76,()=>{for(let y=13;y<89;y+=4)for(let x=14;x<103;x+=4)r(x,y,4,4,((x-14)/4+(y-13)/4)%2?'#b6a5b4':'#c5b6c1');});
        r(18,95,14,3,'rose');r(36,95,14,3,'pink');r(54,95,14,3,'paper');r(72,95,14,3,'blue');
        box(119,43,32,45,'dark','edge');
        [['pink',124,49],['rose',137,49],['paper',124,62],['green',137,62],['blue',124,75],['gold',137,75]].forEach(([color,x,y])=>{r(x,y,8,7,color);r(x+1,y,6,1,'ink');});
      },
      motion(time){
        const cycle=penCycle(artPath,time,7),head=pointAt(artPath,cycle.progress);
        ctx.save();ctx.globalAlpha=cycle.opacity;
        for(let i=0;i<=head.index;i++){const cell=artPath.nodes[i];r(cell.x-2,cell.y-2,4,4,cell.color);}
        ctx.restore();pencil(cycle.tip.x,cycle.tip.y);
      }
    },
    sound:{width:160,height:112,
      base(){
        box(10,16,140,74,'dark','paper');r(16,23,127,9,'shade');r(20,26,21,2,'paper');r(48,26,10,2,'pink');line(17,53,143,53,'shade');
        r(22,79,37,1,'edge');r(97,79,38,1,'edge');r(106,76,3,7,'pink');r(124,76,3,7,'paper');
        r(14,75,4,23,'paper');r(18,71,4,7,'paper');r(22,68,17,4,'paper');r(39,71,4,7,'paper');r(43,75,4,23,'paper');
        box(9,88,12,17,'rose','pink');box(40,88,12,17,'rose','pink');line(46,105,46,109,'edge');line(28,109,46,109,'edge');
      },
      motion(time){
        for(let i=0;i<41;i++){const height=3+Math.round(Math.abs(Math.sin(i*.71)*Math.cos(i*.29))*31*(.8+Math.sin(time*2+i)*.2));r(20+i*3,53-Math.floor(height/2),2,height,i%8===0?'paper':'pink');}
        at(20+(time*14)%119,0,()=>{r(0,35,1,37,'ink');r(-2,34,5,2,'ink');});
        at(0,4+Math.sin(time*2),()=>{r(132,0,2,10,'rose');r(126,9,7,3,'pink');r(133,0,9,2,'pink');});
      }
    },
    studio:{width:240,height:152,
      base(){
        r(6,5,228,118,'dark');r(9,8,222,111,'#181520');
        clip(9,8,222,111,()=>{for(let y=10;y<118;y+=12){line(10,y,230,y,'dark');for(let x=10+(y%24?16:0);x<230;x+=32)line(x,y,x,y+11,'dark');}});
        clip(8,123,224,23,()=>{for(let x=8;x<232;x+=16)for(let y=123;y<146;y+=8)r(x,y,16,8,((x+y)%32)?'#241e2d':'#2c2433');});
        box(14,17,42,60,'shade','edge');r(18,21,34,51,'deep');r(18,47,34,3,'edge');
        [20,25,30,35,41,46].forEach((x,i)=>{r(x,25+(i%3),4,19-(i%3),['pink','paper','sky','rose','gold','edge'][i]);r(x+1,29+(i%3),2,1,'ink');});
        box(25,55,18,10,'plum','rose');r(28,58,12,2,'pink');
        box(66,31,111,70,'shade','paper');box(71,36,101,56,'deep','edge');terrainBase(74,39,95,50);
        r(112,101,19,9,'shade');r(104,110,35,3,'edge');
        r(47,115,164,6,'paper');r(48,121,163,6,'shade');r(54,127,6,20,'edge');r(199,127,6,20,'edge');
        box(84,112,61,6,'shade','edge');for(let x=87;x<142;x+=5)r(x,114,3,1,'paper');
        box(157,112,9,7,'shade','edge');r(161,113,1,3,'pink');line(161,111,164,106,'edge');
        box(188,49,23,55,'deep','edge');r(191,52,17,3,'shade');
        [65,88].forEach(y=>{r(192,y-5,15,11,'shade');r(195,y-8,9,17,'shade');r(196,y-3,7,7,'edge');r(198,y-1,3,3,'deep');});
        r(52,101,13,13,'paper');r(54,103,9,10,'plum');r(65,104,4,7,'paper');r(66,106,2,3,'dark');
        r(187,109,12,5,'gold');r(187,107,12,2,'paper');r(190,104,13,3,'rose');
        tree(210,72);box(213,99,16,15,'rose','pink');dither(215,102,12,10,'plum');
        box(17,91,25,32,'shade','edge');r(22,97,15,2,'paper');r(22,104,15,2,'paper');r(22,112,15,2,'paper');
        r(70,16,18,2,'pink');r(70,18,2,6,'pink');r(87,18,2,6,'pink');r(102,16,12,2,'edge');
      },
      motion(time){
        terrainMotion(74,39,95,50,time);
        clip(74,39,95,50,()=>pointer(104+Math.sin(time*.45)*15,55+Math.cos(time*.6)*6));
        at(Math.sin(time)*.7,-(time*2)%5,()=>{r(56,94,1,4,'edge');r(59,90,2,4,'shade');});
      }
    }
  };
  // One renderer serves both the full-document landing and client-side routes.
  // Detached hosts are released, so navigating or changing roles cannot leave
  // invisible animation loops and canvas buffers behind.
  const scenes=new Map(),hosts=new Map();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const still=()=>reduced.matches||navigator.connection?.saveData||document.documentElement.classList.contains('motion-paused');
  const obscured=()=>document.hidden||document.body.matches('.menu-open,.dialog-open');
  const active=scene=>scene.visible&&!scene.canvas.hidden&&scene.canvas.isConnected;
  const hasActive=()=>[...scenes.values()].some(active);
  function draw(scene,time) {
    if(!scene.background){
      scene.background=document.createElement('canvas');scene.background.width=scene.canvas.width;scene.background.height=scene.canvas.height;
      ctx=scene.background.getContext('2d');ctx.setTransform(SCALE,0,0,SCALE,0,0);scene.def.base();
    }
    ctx=scene.context;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,scene.canvas.width,scene.canvas.height);
    ctx.drawImage(scene.background,0,0);ctx.setTransform(SCALE,0,0,SCALE,0,0);scene.def.motion(time);
  }
  let request=0,previous=0;
  function frame(now) {
    request=0;
    if(still()||obscured()||!hasActive())return;
    if(!previous)previous=now;
    const delta=now-previous;
    if(delta>=FRAME_MS-.5){
      previous=now;
      scenes.forEach(scene=>{if(active(scene)){scene.time+=Math.min(delta,100)/1000;draw(scene,scene.time);}});
    }
    request=requestAnimationFrame(frame);
  }
  function sync() {
    cancelAnimationFrame(request);request=0;previous=0;
    if(obscured())return;
    scenes.forEach(scene=>{if(active(scene))draw(scene,still()?(scene.def.stillTime??4.5):scene.time);});
    if(!still()&&hasActive())request=requestAnimationFrame(frame);
  }
  const observer='IntersectionObserver' in window?new IntersectionObserver(entries=>{
    entries.forEach(entry=>{const scene=scenes.get(entry.target);if(scene)scene.visible=entry.isIntersecting;});sync();
  },{threshold:.01}):null;
  function mount(host,name,role=false) {
    const def=definitions[name],canvas=document.createElement('canvas');
    canvas.width=def.width*SCALE;canvas.height=def.height*SCALE;
    canvas.className='pixel-canvas';canvas.dataset.scene=name;canvas.setAttribute('aria-hidden','true');
    if(role){canvas.dataset.roleArt=name;canvas.hidden=name!=='planning';}
    host.append(canvas);
    const context=canvas.getContext('2d');if(!context)return;
    context.imageSmoothingEnabled=false;
    scenes.set(canvas,{canvas,host,context,def,visible:!observer,time:0,background:null});
    observer?.observe(canvas);
  }
  function reconcile() {
    hosts.forEach((name,host)=>{
      if(host.isConnected&&host.dataset.illustration===name)return;
      scenes.forEach((scene,canvas)=>{
        if(scene.host!==host)return;
        observer?.unobserve(canvas);scenes.delete(canvas);canvas.remove();
      });
      hosts.delete(host);
    });
    document.querySelectorAll('[data-illustration]').forEach(host=>{
      if(hosts.has(host))return;
      const name=host.dataset.illustration;
      if(name!=='roles'&&!Object.hasOwn(definitions,name))return;
      hosts.set(host,name);
      if(name==='roles')['planning','programming','art','sound'].forEach(role=>mount(host,role,true));
      else mount(host,name);
    });
    sync();
  }
  // afterInteractive runs only once; observe later Next page/role mounts too.
  const mounts=new MutationObserver(reconcile);
  mounts.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-illustration']});
  const overlays=new MutationObserver(sync);
  overlays.observe(document.body,{attributes:true,attributeFilter:['class']});
  overlays.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  reconcile();
  addEventListener('gammaru:rolechange',event=>{
    scenes.forEach(scene=>{
      if(!scene.canvas.hasAttribute('data-role-art'))return;
      scene.canvas.hidden=scene.canvas.dataset.roleArt!==event.detail;
      if(scene.canvas.hidden)scene.visible=false;
      else{const bounds=scene.canvas.getBoundingClientRect();scene.visible=bounds.bottom>0&&bounds.top<innerHeight;scene.time=0;}
    });sync();
  });
  addEventListener('gammaru:motionchange',sync);
  addEventListener('gammaru:overlaychange',sync);
  document.addEventListener('visibilitychange',sync);
  reduced.addEventListener('change',sync);
  navigator.connection?.addEventListener('change',sync);
})();
