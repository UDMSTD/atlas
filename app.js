(() => {
  'use strict';
  const $ = id => document.getElementById(id), NS = 'http://www.w3.org/2000/svg';
  const el = (tag, cls, text) => { const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=String(text);return x; };
  const svg = (tag,attrs={}) => {const x=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>x.setAttribute(k,String(v)));return x;};
  const arr = x => Array.isArray(x)?x:[];
  const D = window.PUBLIC_ATLAS || {}, groups=arr(D.groups).filter(g=>g&&typeof g.id==='string');
  const groupMap=new Map(groups.map(g=>[g.id,g])), nodeMap=new Map();
  for(const n of arr(D.nodes))if(n&&typeof n.id==='string'&&groupMap.has(n.group)&&!nodeMap.has(n.id))nodeMap.set(n.id,n);
  const nodes=[...nodeMap.values()], edges=arr(D.edges).filter(e=>e&&nodeMap.has(e.from)&&nodeMap.has(e.to));
  const centralNode = nodes.find(n=>n.kind==='core' && n.overview) || nodes.find(n=>n.overview) || nodes[0];
  const journeys=arr(D.journeys).filter(j=>j&&arr(j.steps).length&&j.steps.every(s=>nodeMap.has(s.node))), meta=D.meta||{};
  const snapshotDate=/^\d{4}-\d{2}-\d{2}/.test(meta.updatedAt||'')?meta.updatedAt.slice(0,10):'';
  const state={mode:'overview',group:null,selected:null,journey:null,step:0,z:1,x:0,y:0,fitted:true};
  let positions=new Map(),layouts=[],visible=[],shownEdges=[],bounds={x:0,y:0,w:1800,h:1100},raf=0,toastTimer=0,paintedZoom=NaN,viewSize=null;
  const documentState={text:null,loading:false};
  const mobileLayout=matchMedia('(max-width:640px)');
  const desktopPointer=matchMedia('(hover: hover) and (pointer: fine) and (min-width: 641px)');
  const panels={top:true,left:!mobileLayout.matches,right:false,full:false,saved:null};
  let panelZones=[],edgePointer=null;
  const isDiagram=()=>state.mode==='overview'||state.mode==='detailed';
  const viewport=$('viewport'),world=$('world'),nodeLayer=$('node-layer'),groupLayer=$('group-layer');
  const buttons=new Map(),paths=new Map();
  const kindLabel={data:'数据',control:'控制',storage:'存储',optional:'可选'};
  function toast(s){$('toast').textContent=s;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
  function announce(s){$('announce').textContent=s;}
  function btn(text,fn,cls=''){const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;}
  function visibleNodes(){return nodes.filter(n=>(state.mode!=='overview'||n.overview||n.id===state.selected));}
  function layout(){
    visible=visibleNodes();positions=new Map();layouts=[];
    const byGroup=new Map(groups.map(g=>[g.id,visible.filter(n=>n.group===g.id)]));
    const overview=state.mode==='overview',header=overview?64:78,step=overview?88:124,gap=overview?52:100;
    const rowHeights=[0,0,0];
    groups.forEach((g,i)=>{const row=Math.floor(i/3);rowHeights[row]=Math.max(rowHeights[row]||0,header+Math.ceil(byGroup.get(g.id).length/2)*step);});
    let ys=[50];for(let i=1;i<rowHeights.length;i++)ys.push(ys[i-1]+rowHeights[i-1]+gap);
    groups.forEach((g,i)=>{
      const ns=byGroup.get(g.id),col=i%3,row=Math.floor(i/3),x=70+col*650,y=ys[row]||70;
      const box={...g,x,y,w:570,h:Math.max(overview?152:195,header+Math.ceil(ns.length/2)*step)};layouts.push(box);
      ns.forEach((n,j)=>positions.set(n.id,{x:x+25+(j%2)*272,y:y+(overview?57:67)+Math.floor(j/2)*step,w:248,h:overview?76:103,group:g.id,col:j%2}));
    });
    bounds={x:0,y:0,w:1940,h:Math.max(...layouts.map(g=>g.y+g.h))+60};
    shownEdges=edges.filter(e=>positions.has(e.from)&&positions.has(e.to));
  }
  function route(e,i=0){
    const a=positions.get(e.from),b=positions.get(e.to);if(!a||!b)return null;
    const ax=a.x+a.w/2,ay=a.y+a.h/2,bx=b.x+b.w/2,by=b.y+b.h/2;
    const horizontal=Math.abs(bx-ax)>=Math.abs(by-ay)*.75;
    let s,t,c1,c2;
    if(horizontal){const sign=bx>=ax?1:-1;s={x:ax+sign*a.w/2,y:ay};t={x:bx-sign*b.w/2,y:by};const bend=Math.max(45,Math.abs(t.x-s.x)*.48);c1={x:s.x+sign*bend,y:s.y};c2={x:t.x-sign*bend,y:t.y};}
    else{const sign=by>=ay?1:-1;s={x:ax,y:ay+sign*a.h/2};t={x:bx,y:by-sign*b.h/2};const bend=Math.max(45,Math.abs(t.y-s.y)*.48);c1={x:s.x,y:s.y+sign*bend};c2={x:t.x,y:t.y-sign*bend};}
    const reverse=edges.some(x=>x.from===e.to&&x.to===e.from);
    if(reverse){const side=e.from.localeCompare(e.to)>0?1:-1;if(horizontal){c1.y+=side*26;c2.y+=side*26;}else{c1.x+=side*26;c2.x+=side*26;}}
    return {d:`M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${t.x},${t.y}`,mid:{x:(s.x+3*c1.x+3*c2.x+t.x)/8,y:(s.y+3*c1.y+3*c2.y+t.y)/8}};
  }
  function render(){
    stopEdgePan();
    ['overview','detailed','list-mode','document-mode'].forEach(id=>{const on=state.mode===id.replace('-mode','');$(id).classList.toggle('active',on);$(id).setAttribute('aria-pressed',String(on));});
    const reading=state.mode==='document';
    $('architecture-document').hidden=!reading;$('node-list').hidden=state.mode!=='list';world.hidden=!isDiagram();
    $('minimap-wrap').hidden=!isDiagram();document.querySelector('.canvas-controls').hidden=!isDiagram();document.querySelector('.map-note').hidden=!isDiagram();
    $('fit-mobile').hidden=!isDiagram();updateFollowControl();
    if(reading){$('footer-info').textContent='同一份架构资料 · Markdown 原文 · 可复制与下载';loadDocument();return;}
    paintedZoom=NaN;layout();buttons.clear();paths.clear();nodeLayer.replaceChildren();groupLayer.replaceChildren();$('edge-paths').replaceChildren();$('edge-labels').replaceChildren();
    world.style.width=bounds.w+'px';world.style.height=bounds.h+'px';world.classList.toggle('overview-depth',state.mode==='overview');$('connections').setAttribute('viewBox',`0 0 ${bounds.w} ${bounds.h}`);
    layouts.forEach(g=>{const box=el('div','group-frame'+(g.id===centralNode?.group?' core-group':''));Object.assign(box.style,{left:g.x+'px',top:g.y+'px',width:g.w+'px',height:g.h+'px'});box.dataset.group=g.id;const title=el('div','group-heading');title.append(el('strong','',g.label),el('small','',g.en||''));box.append(title);groupLayer.append(box);});
    shownEdges.forEach((e,i)=>{const r=route(e,i),p=svg('path',{d:r.d,class:`edge ${e.kind||'data'}`,'data-edge':e.id});$('edge-paths').append(p);paths.set(e.id,p);});
    visible.forEach(n=>{const p=positions.get(n.id),b=btn('',()=>select(n.id),'node'+(n.kind==='core'?' core-node':''));b.dataset.node=n.id;b.setAttribute('aria-label',`${n.label}，${n.subtitle||''}，${n.statusText||''}`);b.setAttribute('aria-pressed','false');b.title=n.label+' · '+n.subtitle;Object.assign(b.style,{left:p.x+'px',top:p.y+'px'});const h=el('span','node-head');h.append(el('i','status-dot '+n.status),el('span','',n.id.toUpperCase().replaceAll('-',' / ')));b.append(h,el('span','node-title',n.label),el('span','node-subtitle',n.subtitle||''));nodeLayer.append(b);buttons.set(n.id,b);});
    $('visible-count').textContent=visible.length;$('counts').textContent=`${nodes.length} MODULES / ${edges.length} CONNECTIONS`;
    renderList();highlight();updateTransform();updateFollowControl();
  }
  async function loadDocument(){
    if(documentState.text!==null||documentState.loading)return;
    documentState.loading=true;$('document-retry').hidden=true;$('document-status').textContent='正在读取 Markdown…';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch('./architecture.md',{signal:controller.signal,cache:'no-cache'});
      if(!response.ok)throw new Error('http_'+response.status);
      const text=await response.text();
      if(!/^#\s+\S/m.test(text)||text.length>2*1024*1024)throw new Error('invalid_document');
      documentState.text=text;$('document-text').textContent=text;$('document-copy').disabled=false;
      $('document-status').textContent=`${nodes.length} 个模块 · ${edges.length} 条关系 · ${journeys.length} 条工作流`;
    }catch(_){$('document-status').textContent='文档暂时未能加载，请重试。';$('document-retry').hidden=false;}
    finally{clearTimeout(timer);documentState.loading=false;}
  }
  async function copyDocument(){
    if(documentState.text===null)return;
    try{await navigator.clipboard.writeText(documentState.text);toast('完整 Markdown 已复制。');}
    catch(_){const selection=window.getSelection(),range=document.createRange();range.selectNodeContents($('document-text'));selection.removeAllRanges();selection.addRange(range);toast('正文已选中，按 Ctrl+C 或长按复制。');}
  }
  function renderList(){
    const list=$('node-list');list.replaceChildren();if(state.mode!=='list')return;
    groups.filter(g=>!state.group||g.id===state.group).forEach(g=>{const ns=visible.filter(n=>n.group===g.id);if(!ns.length)return;const section=el('section','list-group');section.append(el('h2','',g.label));const grid=el('div','list-grid');ns.forEach(n=>{const b=btn('',()=>select(n.id,{center:false}),'list-node');b.dataset.listNode=n.id;const title=el('strong');title.append(el('i','status-dot '+n.status),document.createTextNode(n.label));b.append(title,el('p','',n.summary),el('small','',`${n.statusText} · 查看详情 →`));grid.append(b);});section.append(grid);list.append(section);});
  }
  function highlight(){
    const related=new Set(state.selected?[state.selected]:[]),selectedEdges=new Set(),journeyNodes=new Set(),journeyEdges=new Set();
    edges.forEach(e=>{if(state.selected&&(e.from===state.selected||e.to===state.selected)){related.add(e.from);related.add(e.to);selectedEdges.add(e.id);}});
    if(state.journey){state.journey.steps.forEach(s=>journeyNodes.add(s.node));for(let i=1;i<state.journey.steps.length;i++){const a=state.journey.steps[i-1].node,b=state.journey.steps[i].node;edges.filter(e=>(e.from===a&&e.to===b)||(e.from===b&&e.to===a)).forEach(e=>journeyEdges.add(e.id));}}
    buttons.forEach((b,id)=>{const n=nodeMap.get(id),sel=id===state.selected;let dim=state.selected&&!related.has(id);if(state.group)dim=n.group!==state.group&&!related.has(id);if(journeyNodes.has(id))dim=false;b.classList.toggle('selected',sel);b.classList.toggle('related',related.has(id)&&!sel);b.classList.toggle('dim',!!dim);b.classList.toggle('journey-node',journeyNodes.has(id));b.setAttribute('aria-pressed',String(sel));});
    shownEdges.forEach(e=>{const p=paths.get(e.id);let dim=state.selected&&!selectedEdges.has(e.id);if(state.group&&!state.selected)dim=nodeMap.get(e.from).group!==state.group&&nodeMap.get(e.to).group!==state.group;if(journeyEdges.has(e.id))dim=false;p.classList.toggle('dim',!!dim);p.classList.toggle('highlight',selectedEdges.has(e.id));p.classList.toggle('journey-edge',journeyEdges.has(e.id));});
    groupLayer.querySelectorAll('.group-frame').forEach(g=>g.classList.toggle('dim',!!state.group&&g.dataset.group!==state.group));
    $('edge-labels').replaceChildren();const occupied=[];
    shownEdges.filter(e=>selectedEdges.has(e.id)).forEach((e,i)=>{const r=route(e),w=Math.min(220,e.label.length*13+20),h=25;let x=r.mid.x,y=r.mid.y;
      // Keep labels off cards and each other; each selected relationship remains in the detail list.
      let placed=false;for(const dy of [0,-34,34,-68,68,-102,102]){let yy=y+dy;const box={x:x-w/2,y:yy-h/2,w,h};const collide=b=>box.x<b.x+b.w+5&&box.x+box.w>b.x-5&&box.y<b.y+b.h+5&&box.y+box.h>b.y-5;if(![...positions.values(),...occupied].some(collide)){y=yy;occupied.push(box);placed=true;break;}}if(!placed)return;
      const g=svg('g',{class:'edge-label',transform:`translate(${x},${y})`});g.append(svg('rect',{x:-w/2,y:-h/2,width:w,height:h,rx:4}));const t=svg('text',{'text-anchor':'middle','dominant-baseline':'central'});t.textContent=e.label;g.append(t);$('edge-labels').append(g);
    });
    document.querySelectorAll('.domain-btn').forEach(b=>b.classList.toggle('active',(b.dataset.domain||null)===state.group));
    document.querySelectorAll('.journey-button').forEach(b=>b.classList.toggle('active',b.dataset.journey===state.journey?.id));drawMinimap();
  }
  function rect(){return viewport.getBoundingClientRect();}
  function updateTransform(){
    if(raf)return;
    raf=requestAnimationFrame(()=>{
      raf=0;
      // Lay out at the displayed size. Text is rasterized afresh at each zoom,
      // rather than magnifying a composited bitmap of the complete board.
      const z=state.z,px=v=>Math.round(v*devicePixelRatio)/devicePixelRatio;
      world.style.transform='none';world.style.left=px(state.x)+'px';world.style.top=px(state.y)+'px';
      if(paintedZoom!==z){
      paintedZoom=z;
      world.style.width=px(bounds.w*z)+'px';world.style.height=px(bounds.h*z)+'px';
      world.classList.toggle('compact-scale',z<.78);world.classList.toggle('map-scale',z<.32);
      world.style.setProperty('--node-title-size',Math.max(15,Math.round(22*z))+'px');
      world.style.setProperty('--node-core-size',Math.max(17,Math.round(26*z))+'px');
      world.style.setProperty('--node-subtitle-size',Math.max(14,Math.round(15*z))+'px');
      world.style.setProperty('--node-id-size',Math.max(11,Math.round(11*z))+'px');
      world.style.setProperty('--node-pad',Math.max(6,Math.round(15*z))+'px');
      world.style.setProperty('--group-title-size',Math.max(17,Math.round(23*z))+'px');
      world.style.setProperty('--group-pad-x',Math.max(8,Math.round(22*z))+'px');
      world.style.setProperty('--group-pad-y',Math.max(5,Math.round(15*z))+'px');
      groupLayer.querySelectorAll('.group-frame').forEach(box=>{
        const g=layouts.find(g=>g.id===box.dataset.group);if(!g)return;
        Object.assign(box.style,{left:px(g.x*z)+'px',top:px(g.y*z)+'px',width:px(g.w*z)+'px',height:px(g.h*z)+'px'});
      });
      buttons.forEach((button,id)=>{const p=positions.get(id);Object.assign(button.style,{left:px(p.x*z)+'px',top:px(p.y*z)+'px',width:px(p.w*z)+'px',height:px(p.h*z)+'px'});});
      $('edge-labels').style.visibility=z<.62?'hidden':'visible';
      $('zoom-value').textContent=Math.round(z*100)+'%';
      }
      updateMinimapView();
    });
  }
  function availableSize(){const r=rect();let w=r.width,h=r.height;if(! $('inspector').hidden&&innerWidth<=640)h=Math.max(110,Math.min(h,$('inspector').getBoundingClientRect().top-r.top-20));else if(!$('inspector').hidden&&innerWidth<=900)w=Math.max(150,w-$('inspector').getBoundingClientRect().width);return {w,h};}
  function fitBox(b,pad=40){stopEdgePan();const {w,h}=availableSize();viewSize={w,h};const bottom=state.journey?220:60;state.z=Math.max(.14,Math.min(1.4,(w-pad*2)/b.w,(h-bottom-pad)/b.h));state.x=(w-b.w*state.z)/2-b.x*state.z;state.y=(h-bottom-b.h*state.z)/2-b.y*state.z+10;state.fitted=true;updateTransform();}
  function fit(){if(state.mode==='list')setMode('overview');fitBox(bounds);}
  function centerNode(id,z){stopEdgePan();const p=positions.get(id);if(!p)return;const {w,h}=availableSize();viewSize={w,h};state.z=Math.max(.32,Math.min(1.65,z??(innerWidth<=640?.92:1.05)));state.x=w/2-(p.x+p.w/2)*state.z;state.y=(state.journey?h*.30:h*.46)-(p.y+p.h/2)*state.z;state.fitted=false;updateTransform();}
  function zoomAt(factor,x,y){stopEdgePan();const old=state.z,z=Math.max(.14,Math.min(2.5,old*factor));state.x=x-(x-state.x)*z/old;state.y=y-(y-state.y)*z/old;state.z=z;state.fitted=false;updateTransform();}
  function drawMinimap(){
    const mini=$('minimap');mini.replaceChildren();const s=Math.min(200/bounds.w,116/bounds.h),ox=(210-bounds.w*s)/2,oy=(124-bounds.h*s)/2;mini.dataset.scale=s;mini.dataset.ox=ox;mini.dataset.oy=oy;
    layouts.forEach(g=>mini.append(svg('rect',{x:g.x*s+ox,y:g.y*s+oy,width:g.w*s,height:g.h*s,rx:2,fill:'#112e43',stroke:'#234b67','stroke-width':.4})));
    visible.forEach(n=>{const p=positions.get(n.id);mini.append(svg('rect',{x:p.x*s+ox,y:p.y*s+oy,width:p.w*s,height:p.h*s,class:'minimap-node'+(n.id===centralNode?.id?' core':'')+(n.id===state.selected?' selected':'')}));});
    const r=rect();mini.append(svg('rect',{x:-state.x/state.z*s+ox,y:-state.y/state.z*s+oy,width:r.width/state.z*s,height:r.height/state.z*s,rx:1,class:'minimap-view'}));
  }
  function updateMinimapView(){
    const mini=$('minimap'),view=mini.querySelector('.minimap-view');if(!view)return;
    const scale=+mini.dataset.scale,ox=+mini.dataset.ox,oy=+mini.dataset.oy,r=rect();
    Object.entries({x:-state.x/state.z*scale+ox,y:-state.y/state.z*scale+oy,width:r.width/state.z*scale,height:r.height/state.z*scale}).forEach(([key,value])=>view.setAttribute(key,value));
  }
  function syncPanels(){
    stopEdgePan();
    document.body.classList.toggle('top-collapsed',!panels.top);
    document.body.classList.toggle('left-collapsed',!panels.left);
    document.body.classList.toggle('inspecting',panels.right);
    document.body.classList.toggle('canvas-fullscreen',panels.full);
    $('inspector').hidden=!panels.right;
    for(const [name,label] of [['top','顶部'],['left','左侧目录'],['right','右侧详情']]){
      const button=$('toggle-'+name);button.setAttribute('aria-expanded',String(panels[name]));
      button.classList.toggle('active',panels[name]);button.title=(panels[name]?'收起':'展开')+label;
      button.setAttribute('aria-label',button.title);
      const handle=$('panel-edge-'+name);handle.setAttribute('aria-expanded',String(panels[name]));
      handle.setAttribute('aria-label',button.title);handle.title=button.title;
    }
    $('mobile-nav').setAttribute('aria-expanded',String(panels.left));
    $('fullscreen-label').textContent=panels.full?'恢复布局':'全屏画布';
    $('toggle-fullscreen').setAttribute('aria-pressed',String(panels.full));
    $('toggle-fullscreen').title=panels.full?'恢复之前的顶部和侧栏（Esc / F）':'收起顶部与两侧面板（F）';
    // A sidebar may overlay the viewport without changing its measured box.
    requestAnimationFrame(()=>{resizeView();positionPanelHandles();});
  }
  function insidePanelZone(x,y,zone){return x>=zone.x&&x<=zone.x+zone.w&&y>=zone.y&&y<=zone.y+zone.h;}
  function nearPanelHandle(x,y){return desktopPointer.matches&&panelZones.some(zone=>insidePanelZone(x,y,zone));}
  function revealPanelHandles(){
    let near=false;
    for(const name of ['left','right','top']){
      const zone=panelZones.find(z=>z.name===name);
      const show=!!(desktopPointer.matches&&edgePointer&&zone&&insidePanelZone(edgePointer.x,edgePointer.y,zone));
      $('panel-edge-'+name).classList.toggle('is-near',show);near=near||show;
    }
    if(near)stopEdgePan();
  }
  function positionPanelHandles(){
    panelZones=[];
    if(!desktopPointer.matches){revealPanelHandles();return;}
    const r=rect(),left=panels.left?$('domain-rail').getBoundingClientRect().right:0;
    const right=panels.right?$('inspector').getBoundingClientRect().left:innerWidth;
    const middle=Math.max(48,Math.min(innerHeight-48,r.top+r.height/2));
    const center=Math.max(36,Math.min(innerWidth-36,(left+right)/2)),top=panels.top?r.top:0;
    function place(name,x,y,zone){const button=$('panel-edge-'+name);button.style.left=x+'px';button.style.top=y+'px';panelZones.push({name,...zone});}
    place('left',Math.max(0,left-1),middle-36,{x:left-18,y:middle-70,w:72,h:140});
    place('right',Math.max(0,right-28),middle-36,{x:right-54,y:middle-70,w:72,h:140});
    place('top',center-36,Math.max(0,top-1),{x:center-70,y:top-16,w:140,h:62});
    revealPanelHandles();
  }
  function clearPanelHover(){edgePointer=null;revealPanelHandles();}
  function trackPanelHover(e){
    edgePointer=e.pointerType==='mouse'&&!e.buttons?{x:e.clientX,y:e.clientY}:null;
    revealPanelHandles();
  }
  function togglePanel(name){
    if(isDiagram()){viewSize=availableSize();state.fitted=false;}
    if(name==='right'&&!panels.right){
      if(!$('inspector-content').hasChildNodes()){showAbout();return;}
    }
    panels[name]=!panels[name];
    if(name==='top'&&!panels.top){closeSearch();$('export-menu').hidden=true;$('export').setAttribute('aria-expanded','false');}
    syncPanels();
  }
  function toggleFullscreen(){
    if(isDiagram()){viewSize=availableSize();state.fitted=false;}
    if(panels.full){Object.assign(panels,panels.saved);panels.saved=null;panels.full=false;}
    else{panels.saved={top:panels.top,left:panels.left,right:panels.right};panels.top=panels.left=panels.right=false;panels.full=true;closeSearch();}
    syncPanels();announce(panels.full?'画布已铺满页面，可分别展开面板。':'已恢复之前的布局。');
  }
  function openInspector(){panels.right=true;syncPanels();}
  function closeInspector(clear=true){panels.right=false;syncPanels();if(clear){state.selected=null;replaceHash(null);highlight();$('footer-info').textContent='选择节点，查看它的上下游。';}}
  function replaceHash(id){try{history.replaceState(null,'',location.pathname+(id?'#node='+encodeURIComponent(id):''));}catch(_){/* Read-only embeds can disallow history; the graph remains usable. */}}
  function select(id,{center=true,inspect=true,hash=true,keepJourney=false}={}){
    const n=nodeMap.get(id);if(!n){toast('没有找到这个模块，可以试试搜索。');return;}
    if(!keepJourney)endJourney(false);let rebuild=false;state.selected=id;state.group=null;
    if(state.mode==='document'){state.mode=n.overview?'overview':'detailed';rebuild=true;}
    if(state.mode==='overview'&&!n.overview){state.mode='detailed';rebuild=true;}
    if(rebuild)render();else{highlight();if(state.mode==='list')renderList();}if(inspect){openInspector();renderInspector(n);}if(hash)replaceHash(id);
    $('footer-info').textContent=`${n.label} · ${edges.filter(e=>e.from===id||e.to===id).length} 条关联`;
    announce('已选择 '+n.label);closeSearch();closeNav();requestAnimationFrame(()=>{if(center&&state.mode!=='list')centerNode(id);});
  }
  function renderInspector(n){
    const box=$('inspector-content');box.replaceChildren();box.scrollTop=0;box.append(el('div','inspector-eyebrow',groupMap.get(n.group)?.en||n.group),el('h2','',n.label),el('p','inspector-subtitle',n.subtitle||''));const badge=el('span','status-badge');badge.append(el('i','status-dot '+n.status),document.createTextNode(n.statusText||'功能模块'));box.append(badge,el('p','inspector-summary',n.summary||''));
    if(arr(n.facts).length){const fs=el('div','facts');n.facts.forEach(f=>{const q=el('div','fact');q.append(el('small','',f.label),el('strong','',f.value));fs.append(q);});box.append(fs);}
    arr(n.details).forEach(d=>{const s=el('section','detail-section');s.append(el('h3','',d.title),el('p','',d.text));box.append(s);});
    const links=edges.filter(e=>e.from===n.id||e.to===n.id);if(links.length){box.append(el('h3','inspector-heading',`CONNECTED / ${links.length} 条关联`));links.forEach(e=>{const outgoing=e.from===n.id,other=nodeMap.get(outgoing?e.to:e.from),b=btn('',()=>select(other.id),'relation'),body=el('span','relation-body');body.append(el('strong','',other.label),el('small','',`${outgoing?'通往':'来自'} · ${e.label} · ${kindLabel[e.kind]||'数据'}`));b.append(el('span','relation-arrow',outgoing?'↗':'↙'),body);box.append(b);});}
    if(arr(n.tags).length){const tags=el('div','tags');n.tags.forEach(t=>tags.append(el('span','',t)));box.append(tags);}
    const acts=el('div','inspector-actions');acts.append(btn('定位到画布',()=>{if(state.mode==='list'){state.mode=n.overview?'overview':'detailed';render();}centerNode(n.id);}),btn('复制节点链接',()=>copyLink(n.id)));box.append(acts);
  }
  async function copyLink(id){replaceHash(id);try{await navigator.clipboard.writeText(location.origin+location.pathname+location.hash);toast('节点链接已复制。');}catch(_){toast('节点已定位，复制地址栏即可分享。');}}
  function showAbout(){openInspector();const box=$('inspector-content');box.replaceChildren();box.append(el('div','about-logo','a·'),el('div','inspector-eyebrow','THE CONNECTED SYSTEM'),el('h2','','智能系统架构图'),el('p','inspector-subtitle',meta.version||snapshotDate),el('p','inspector-summary',`${groups.length} 个领域、${nodes.length} 个模块、${edges.length} 条关系。点击模块可以查看输入、输出和相邻环节。`));
    if(arr(meta.changes).length){const s=el('section','detail-section');s.append(el('h3','','本次更新'),el('p','',meta.changes.join(' ')));box.append(s);}
    [['如何探索','拖动画布、滚轮或双指缩放。选择一个节点，沿连接进入它的上下游；左侧领域和路线可以带你逐步浏览。'],['阅读连线','箭头从给出信息的模块指向使用信息的模块。点开详情，可以沿上下游继续探索。']].forEach(([t,v])=>{const s=el('section','detail-section');s.append(el('h3','',t),el('p','',v));box.append(s);});const a=el('div','inspector-actions');a.append(btn('回到全景',reset),btn('保存公开数据',exportJSON));box.append(a);
  }
  function setMode(mode){
    if(mode==='document'){endJourney(false);closeInspector();closeNav();}
    state.mode=mode;render();
    if(mode==='document'){try{history.replaceState(null,'',location.pathname+'#document');}catch(_){}announce('已打开架构文档');return;}
    if(location.hash==='#document')replaceHash(state.selected);
    if(isDiagram()){state.group?focusDomain(state.group):innerWidth<=640?centerNode(state.selected||centralNode?.id,.92):fit();}
    announce(mode==='list'?'已切换模块目录':mode==='overview'?'已切换全景':'已展开详细模块');
  }
  function focusDomain(id){endJourney(false);state.group=id;state.selected=null;closeInspector(false);replaceHash(null);if(state.mode==='document')state.mode=id?'detailed':'overview';if(id&&state.mode==='overview')state.mode='detailed';render();closeNav();const g=layouts.find(g=>g.id===id);$('board-caption').textContent=g?g.description:'从一次对话，到记忆、声音与创作。';if(state.mode!=='list')requestAnimationFrame(()=>g?fitBox(g,50):fit());}
  function reset(){state.mode='overview';state.group=null;state.selected=null;endJourney(false);closeInspector(false);closeNav();replaceHash(null);$('search').value='';closeSearch();$('board-caption').textContent='从一次对话，到记忆、声音与创作。';render();requestAnimationFrame(()=>innerWidth<=640?centerNode(centralNode?.id,.92):fit());}
  function closeNav(){if(mobileLayout.matches&&panels.left){panels.left=false;syncPanels();}}
  function startJourney(id){const j=journeys.find(x=>x.id===id);if(!j)return;closeInspector(false);state.mode='detailed';state.group=null;state.journey=j;state.step=0;render();closeNav();showStep();}
  function showStep(){const j=state.journey;if(!j)return;const s=j.steps[state.step];$('journey-card').hidden=false;$('journey-name').textContent=j.title;$('journey-step').textContent=s.title;$('journey-text').textContent=s.text;$('journey-progress').textContent=String(state.step+1).padStart(2,'0')+' / '+String(j.steps.length).padStart(2,'0');$('journey-prev').disabled=state.step===0;$('journey-next').textContent=state.step===j.steps.length-1?'完成探索 ✓':'下一步 →';select(s.node,{inspect:false,keepJourney:true});highlight();}
  function endJourney(redraw=true){state.journey=null;state.step=0;$('journey-card').hidden=true;if(redraw)highlight();}
  function closeSearch(){$('search-results').hidden=true;$('search').setAttribute('aria-expanded','false');}
  function search(){const q=$('search').value.trim().toLocaleLowerCase(),box=$('search-results');box.replaceChildren();if(!q){closeSearch();return;}const results=nodes.filter(n=>[n.label,n.id,n.subtitle,n.summary,...arr(n.tags)].join(' ').toLocaleLowerCase().includes(q)).slice(0,12);if(!results.length)box.append(el('p','','没有匹配的模块。可以试试“语音”或“记忆”。'));results.forEach(n=>{const b=btn('',()=>{select(n.id);$('search').blur();});b.append(el('span','',n.label),el('small','',`${groupMap.get(n.group).label} · ${n.subtitle}`));box.append(b);});box.hidden=false;$('search').setAttribute('aria-expanded','true');}
  function download(name,type,content){const url=URL.createObjectURL(new Blob([content],{type}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);$('export-menu').hidden=true;$('export').setAttribute('aria-expanded','false');}
  function exportJSON(){download(`system-atlas.json`,'application/json;charset=utf-8',JSON.stringify(D,null,2));toast('公开架构数据已导出。');}
  function exportSVG(){
    const s=svg('svg',{xmlns:NS,width:bounds.w,height:bounds.h+100,viewBox:`0 -100 ${bounds.w} ${bounds.h+100}`}),defs=svg('defs'),marker=svg('marker',{id:'export-arrow',viewBox:'0 0 8 8',refX:7,refY:4,markerWidth:5,markerHeight:5,orient:'auto-start-reverse'});marker.append(svg('path',{d:'M0 0 8 4 0 8',fill:'context-stroke'}));defs.append(marker);s.append(defs);s.append(svg('rect',{x:0,y:-100,width:bounds.w,height:bounds.h+100,fill:'#07121f'}));
    function text(x,y,value,size=18,color='#d3e8f8'){const t=svg('text',{x,y,fill:color,'font-family':'Segoe UI, Microsoft YaHei, sans-serif','font-size':size});t.textContent=value;return t;}
    s.append(text(70,-43,'SYSTEM ATLAS   智能系统全景',30),text(70,-15,`${snapshotDate} · 概念图谱 · 数据实线 / 控制虚线 / 存储点线 / 可选细虚线`,14,'#7baccb'));
    layouts.forEach(g=>{s.append(svg('rect',{x:g.x,y:g.y,width:g.w,height:g.h,rx:14,fill:'#0b1c2c',stroke:'#294c65'}));s.append(text(g.x+22,g.y+38,g.label,22,'#8fc7e8'));});
    shownEdges.forEach(e=>{const colors={data:'#366a8a',control:'#427da3',storage:'#647dac',optional:'#776b90'},p=svg('path',{d:route(e).d,fill:'none',stroke:colors[e.kind]||colors.data,'stroke-width':2,'marker-end':'url(#export-arrow)'});if(e.kind!=='data')p.setAttribute('stroke-dasharray',e.kind==='storage'?'2 5':'7 6');s.append(p);});
    visible.forEach(n=>{const p=positions.get(n.id);s.append(svg('rect',{x:p.x,y:p.y,width:p.w,height:p.h,rx:8,fill:n.kind==='core'?'#174567':'#102c42',stroke:n.id===state.selected?'#9cddff':'#396885','stroke-width':1.5}));
      const lines=[''];let used=0;for(const ch of n.label){const units=/[\x00-\xff]/.test(ch)?.56:1;if(used+units>11.5&&lines.length<2){lines.push('');used=0;}lines[lines.length-1]+=ch;used+=units;}
      const start=p.y+(p.h<100?26:43);if(p.h>=100)s.append(text(p.x+15,p.y+20,n.id.toUpperCase(),10,'#77a9c7'));
      lines.forEach((line,i)=>s.append(text(p.x+15,start+i*22,line,19)));
      s.append(text(p.x+15,p.y+p.h-12,(n.subtitle||'').slice(0,23),12,'#91b6cf'));
    });
    download(`system-atlas.svg`,'image/svg+xml;charset=utf-8','<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(s));toast('当前层级的架构图已导出。');
  }
  function readHash(){try{if(location.hash==='#document'){setMode('document');return;}if(location.hash.length>180)return;const p=new URLSearchParams(location.hash.slice(1)),id=p.get('node');if(id){if(nodeMap.has(id))select(id,{hash:false});else toast('链接中的模块暂未收录，可以从全景继续探索。');}}catch(_){toast('链接格式有误，仍可从全景继续探索。');}}

  // Controls operate only on this static diagram.
  $('reload').onclick=()=>location.reload();$('about').onclick=showAbout;$('close-inspector').onclick=()=>togglePanel('right');$('overview').onclick=()=>setMode('overview');$('detailed').onclick=()=>setMode('detailed');$('list-mode').onclick=()=>setMode('list');$('reset').onclick=reset;
  $('document-mode').onclick=()=>setMode('document');$('document-retry').onclick=loadDocument;$('document-copy').onclick=copyDocument;
  $('fit').onclick=fit;$('fit-mobile').onclick=fit;$('center').onclick=()=>{if(state.mode==='list')setMode('overview');centerNode(centralNode?.id);};
  $('zoom-in').onclick=()=>{const r=rect();zoomAt(1.22,r.width/2,r.height/2);};$('zoom-out').onclick=()=>{const r=rect();zoomAt(1/1.22,r.width/2,r.height/2);};
  $('mobile-nav').onclick=()=>togglePanel('left');
  for(const name of ['top','left','right']){
    $('toggle-'+name).onclick=()=>togglePanel(name);
    $('panel-edge-'+name).onclick=()=>togglePanel(name);
    $('panel-edge-'+name).addEventListener('focus',stopEdgePan);
  }
  document.addEventListener('pointermove',trackPanelHover,{passive:true});
  document.addEventListener('pointerup',trackPanelHover,{passive:true});
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.panel-edge'))clearPanelHover();},{passive:true});
  document.addEventListener('pointerleave',clearPanelHover);
  window.addEventListener('blur',clearPanelHover);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearPanelHover();});
  $('toggle-fullscreen').onclick=toggleFullscreen;
  mobileLayout.addEventListener('change',()=>{if(mobileLayout.matches)panels.left=false;syncPanels();});
  $('search').addEventListener('input',search);$('search').addEventListener('focus',()=>{if($('search').value)search();});$('search').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();$('search-results').querySelector('button')?.focus();}if(e.key==='Enter')$('search-results').querySelector('button')?.click();});
  $('export').onclick=()=>{const open=$('export-menu').hidden;$('export-menu').hidden=!open;$('export').setAttribute('aria-expanded',String(open));};$('export-json').onclick=exportJSON;$('export-svg').onclick=exportSVG;
  $('journey-close').onclick=()=>{endJourney();state.selected=null;highlight();};$('journey-prev').onclick=()=>{if(state.journey&&state.step>0){state.step--;showStep();}};$('journey-next').onclick=()=>{if(!state.journey)return;if(state.step<state.journey.steps.length-1){state.step++;showStep();}else{endJourney();toast('路线已走完，可以继续选择节点探索。');}};
  document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();reset();});
  document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))closeSearch();if(!e.target.closest('.export-wrap')){$('export-menu').hidden=true;$('export').setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',e=>{
    const input=e.target.closest('input,textarea,select,[contenteditable="true"]');
    if(e.key==='/'&&!input&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();if(!panels.top){panels.top=true;syncPanels();}$('search').focus();}
    if(e.key.toLowerCase()==='f'&&!input&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.repeat){e.preventDefault();toggleFullscreen();}
    if(e.key==='Escape'){if(input){$('search').value='';closeSearch();$('search').blur();}else if(panels.full){toggleFullscreen();}else{closeNav();endJourney();closeInspector();}}
  });
  const excluded='.bottom-dock,.panel-edge,.follow-control,.minimap-wrap,.journey-card,#node-list,#architecture-document,.empty';
  const pointers=new Map();let gestureDragged=false,suppressClick=false;
  const follow={enabled:!matchMedia('(prefers-reduced-motion: reduce)').matches,frame:0,time:0,vx:0,vy:0,tx:0,ty:0};
  try{const saved=localStorage.getItem('system-atlas-edge-pan');if(saved==='on'||saved==='off')follow.enabled=saved==='on';}catch(_){/* Browsing remains usable when storage is unavailable. */}
  function stopEdgePan(){if(follow.frame)cancelAnimationFrame(follow.frame);follow.frame=0;follow.time=0;follow.vx=follow.vy=follow.tx=follow.ty=0;}
  function edgeSpeed(position,size){
    const band=Math.min(110,Math.max(48,size*.18));
    if(position<band)return 240*Math.pow(Math.max(0,Math.min(1,(band-position)/band)),2);
    if(position>size-band)return -240*Math.pow(Math.max(0,Math.min(1,(position-size+band)/band)),2);
    return 0;
  }
  function advanceAxis(value,delta,viewSize,worldSize){
    if(worldSize<=viewSize-64)return value;
    const low=viewSize-40-worldSize,high=40;
    if(value<low)return delta>0?Math.min(high,value+delta):value;
    if(value>high)return delta<0?Math.max(low,value+delta):value;
    return Math.max(low,Math.min(high,value+delta));
  }
  function edgePanFrame(time){
    follow.frame=0;
    if(!follow.enabled||!desktopPointer.matches||document.hidden||pointers.size||!isDiagram())return stopEdgePan();
    const dt=follow.time?Math.min(.05,(time-follow.time)/1000):1/60;follow.time=time;
    const blend=1-Math.exp(-dt/.12);follow.vx+=(follow.tx-follow.vx)*blend;follow.vy+=(follow.ty-follow.vy)*blend;
    const r=rect(),x=advanceAxis(state.x,follow.vx*dt,r.width,bounds.w*state.z),y=advanceAxis(state.y,follow.vy*dt,r.height,bounds.h*state.z);
    if(Math.abs(x-state.x)+Math.abs(y-state.y)<.0001)return stopEdgePan();
    state.x=x;state.y=y;state.fitted=false;updateTransform();follow.frame=requestAnimationFrame(edgePanFrame);
  }
  function followPointer(e){
    if(e.pointerType!=='mouse'||e.buttons||!follow.enabled||!desktopPointer.matches||!isDiagram()||e.target.closest(excluded)||nearPanelHandle(e.clientX,e.clientY))return stopEdgePan();
    const r=rect();follow.tx=edgeSpeed(e.clientX-r.left,r.width);follow.ty=edgeSpeed(e.clientY-r.top,r.height);
    if(!follow.tx&&!follow.ty)return stopEdgePan();
    if(!follow.frame)follow.frame=requestAnimationFrame(edgePanFrame);
  }
  function updateFollowControl(){
    const button=$('edge-follow');button.hidden=!desktopPointer.matches||!isDiagram();
    button.setAttribute('aria-pressed',String(follow.enabled));button.classList.toggle('active',follow.enabled);
    button.textContent='边缘漫游 '+(follow.enabled?'开':'关');
    button.title='放大画布后，鼠标靠近边缘可缓慢平移；回到中央或移出画布即停止。';
    $('map-note').textContent=desktopPointer.matches&&follow.enabled?'拖动探索 · 滚轮缩放 · 靠近边缘漫游':'拖动探索 · 滚轮缩放 · 点击节点追踪连接';
  }
  $('edge-follow').onclick=()=>{
    follow.enabled=!follow.enabled;stopEdgePan();updateFollowControl();
    try{localStorage.setItem('system-atlas-edge-pan',follow.enabled?'on':'off');}catch(_){}
    announce('边缘漫游已'+(follow.enabled?'开启':'关闭'));
  };
  desktopPointer.addEventListener('change',()=>{stopEdgePan();updateFollowControl();positionPanelHandles();});
  function releasePointer(id){
    const p=pointers.get(id);if(!p)return;
    pointers.delete(id);
    try{if(p.capture.hasPointerCapture(id))p.capture.releasePointerCapture(id);}catch(_){}
    if(!pointers.size)viewport.classList.remove('dragging');
  }
  function cancelGesture(){
    if(gestureDragged)suppressClick=true;
    for(const id of [...pointers.keys()])releasePointer(id);
    gestureDragged=false;stopEdgePan();cancelMinimap();
  }
  viewport.addEventListener('keydown',e=>{
    if(e.key==='Escape')cancelGesture();if(e.target!==viewport||!isDiagram())return;
    const d={ArrowLeft:[60,0],ArrowRight:[-60,0],ArrowUp:[0,60],ArrowDown:[0,-60]}[e.key];
    if(d){e.preventDefault();stopEdgePan();state.x+=d[0];state.y+=d[1];state.fitted=false;updateTransform();}
  });
  viewport.addEventListener('wheel',e=>{
    if(e.target.closest('#node-list,.journey-card,#architecture-document'))return;
    e.preventDefault();const r=rect();zoomAt(Math.exp(-Math.max(-250,Math.min(250,e.deltaY))*.0015),e.clientX-r.left,e.clientY-r.top);
  },{passive:false});
  viewport.addEventListener('pointerdown',e=>{
    stopEdgePan();
    if(e.button!==0&&!(e.pointerType==='mouse'&&e.button===1))return;
    if(!pointers.size){gestureDragged=false;suppressClick=false;}
    if(e.target.closest(excluded))return;
    const r=rect(),capture=e.target.closest('.node')||viewport,x=e.clientX-r.left,y=e.clientY-r.top;
    pointers.set(e.pointerId,{x,y,startX:x,startY:y,type:e.pointerType,capture});
    try{capture.setPointerCapture(e.pointerId);}catch(_){/* Window listeners still finish an interrupted gesture. */}
    if(e.button===1)e.preventDefault();
    if(pointers.size>1){gestureDragged=true;suppressClick=true;}
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove',e=>{
    const p=pointers.get(e.pointerId);if(!p)return followPointer(e);
    if(p.type==='mouse'&&!e.buttons){releasePointer(e.pointerId);return;}
    const r=rect(),next={x:e.clientX-r.left,y:e.clientY-r.top},dx=next.x-p.x,dy=next.y-p.y;
    if(pointers.size>=2){
      const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)[1];
      const oldDist=Math.hypot(p.x-other.x,p.y-other.y),newDist=Math.hypot(next.x-other.x,next.y-other.y);
      const oldMid={x:(p.x+other.x)/2,y:(p.y+other.y)/2},newMid={x:(next.x+other.x)/2,y:(next.y+other.y)/2};
      if(oldDist>1){zoomAt(newDist/oldDist,oldMid.x,oldMid.y);state.x+=newMid.x-oldMid.x;state.y+=newMid.y-oldMid.y;}
      gestureDragged=true;
    }else if(gestureDragged){state.x+=dx;state.y+=dy;}
    else if(Math.hypot(next.x-p.startX,next.y-p.startY)>=3){
      state.x+=next.x-p.startX;state.y+=next.y-p.startY;gestureDragged=true;
    }
    p.x=next.x;p.y=next.y;
    if(gestureDragged){if(e.cancelable)e.preventDefault();suppressClick=true;state.fitted=false;updateTransform();}
  });
  function pointerEnd(e){
    if(!pointers.has(e.pointerId))return;
    if(gestureDragged)suppressClick=true;
    releasePointer(e.pointerId);
    // A remaining finger continues from its current position after a pinch.
    for(const p of pointers.values()){p.startX=p.x;p.startY=p.y;}
  }
  window.addEventListener('pointerup',pointerEnd);window.addEventListener('pointercancel',pointerEnd);
  viewport.addEventListener('lostpointercapture',pointerEnd);
  viewport.addEventListener('pointerleave',()=>{if(!pointers.size)stopEdgePan();});
  window.addEventListener('blur',cancelGesture);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelGesture();});
  viewport.addEventListener('dragstart',e=>{if(!e.target.closest('#node-list,.journey-card,#architecture-document'))e.preventDefault();});
  viewport.addEventListener('click',e=>{
    if(suppressClick&&e.detail>0){suppressClick=false;e.preventDefault();e.stopImmediatePropagation();}
  },true);
  viewport.addEventListener('click',e=>{
    if(!e.target.closest('button,.journey-card,.minimap-wrap,#node-list,#architecture-document')){state.selected=null;closeInspector();}
  });
  viewport.addEventListener('auxclick',e=>{if(e.button===1&&!e.target.closest(excluded))e.preventDefault();});
  updateFollowControl();
  let miniPointer=null;
  function positionFromMinimap(e){
    const mini=$('minimap'),r=mini.getBoundingClientRect(),x=(e.clientX-r.left)*210/r.width,y=(e.clientY-r.top)*132/r.height;
    const s=+mini.dataset.scale,wx=Math.max(0,Math.min(bounds.w,(x-+mini.dataset.ox)/s)),wy=Math.max(0,Math.min(bounds.h,(y-+mini.dataset.oy)/s)),v=rect();
    state.x=v.width/2-wx*state.z;state.y=v.height/2-wy*state.z;state.fitted=false;updateTransform();
  }
  $('minimap').addEventListener('pointerdown',e=>{if(e.button!==0)return;stopEdgePan();e.preventDefault();miniPointer=e.pointerId;$('minimap').setPointerCapture(e.pointerId);positionFromMinimap(e);});
  $('minimap').addEventListener('pointermove',e=>{if(e.pointerId===miniPointer){if(e.pointerType==='mouse'&&!e.buttons)return cancelMinimap();e.preventDefault();positionFromMinimap(e);}});
  function cancelMinimap(){if(miniPointer!==null){const id=miniPointer;miniPointer=null;try{if($('minimap').hasPointerCapture(id))$('minimap').releasePointerCapture(id);}catch(_){}}}
  function endMini(e){if(e.pointerId===miniPointer)cancelMinimap();}
  $('minimap').addEventListener('pointerup',endMini);$('minimap').addEventListener('pointercancel',endMini);$('minimap').addEventListener('lostpointercapture',endMini);
  window.addEventListener('hashchange',readHash);
  function resizeView(){
    stopEdgePan();const next=availableSize();
    if(viewSize&&next.w===viewSize.w&&next.h===viewSize.h)return;
    if(state.fitted&&isDiagram())fitBox(state.group?layouts.find(g=>g.id===state.group)||bounds:bounds);
    else if(isDiagram()){
      if(viewSize){state.x+=(next.w-viewSize.w)/2;state.y+=(next.h-viewSize.h)/2;}
      updateTransform();
    }
    viewSize=next;
  }
  new ResizeObserver(()=>{resizeView();positionPanelHandles();}).observe(viewport);
  new ResizeObserver(()=>{document.querySelector('.board').style.setProperty('--dock-height',$('bottom-dock').getBoundingClientRect().height+'px');}).observe($('bottom-dock'));
  const all=btn('',()=>focusDomain(null),'domain-btn active');all.dataset.domain='';all.append(el('span','domain-number','◎'),el('span','','全部领域'),el('span','domain-count',nodes.length));$('domains').append(all);
  groups.forEach(g=>{const b=btn('',()=>focusDomain(g.id),'domain-btn');b.dataset.domain=g.id;b.append(el('span','domain-number',(g.en||'').slice(0,2)),el('span','',g.label),el('span','domain-count',nodes.filter(n=>n.group===g.id).length));$('domains').append(b);});
  journeys.forEach((j,i)=>{const b=btn('',()=>startJourney(j.id),'journey-button');b.dataset.journey=j.id;b.append(el('span','journey-index',String(i+1).padStart(2,'0')),el('span','',j.title));$('journeys').append(b);});
  if(!nodes.length){$('empty').hidden=false;return;}
  $('snapshot-time').textContent=snapshotDate.replaceAll('-','.');
  if(snapshotDate)$('snapshot-time').dateTime=snapshotDate;
  else $('snapshot-time').hidden=true;
  const edition=document.querySelector('.edition b');if(edition)edition.textContent=snapshotDate?snapshotDate.slice(0,7).replace('-',' / '):'ATLAS';
  const documentDownload=document.querySelector('.document-actions a[download]');if(documentDownload)documentDownload.download=`architecture.md`;
  syncPanels();render();requestAnimationFrame(()=>{innerWidth<=640?centerNode(centralNode?.id,.92):fit();readHash();});
})();
