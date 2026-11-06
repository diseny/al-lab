// Run locally only. Private source files must remain outside this repository.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const [templatePath,htmlPath,overridesPath]=process.argv.slice(2);
if(!templatePath||!htmlPath)throw Error('Usage: node export-aggregates.cjs TEMPLATE PRIVATE_HTML [TEXT_OVERRIDES]');
const source=fs.readFileSync(templatePath,'utf8'),html=fs.readFileSync(htmlPath,'utf8');
const script=[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const privateViews=JSON.parse(scripts.at(-1)[1].slice(6,-1));
class Element{constructor(){this.children=[];this.style={};this.dataset={};this.attrs={};this.checked=false;this.value='';this.textContent='';}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}setAttribute(k,v){this.attrs[k]=v;}}
const elements={};const document={getElementById:id=>elements[id]??(elements[id]=new Element()),createElement:()=>new Element(),createElementNS:()=>new Element(),querySelectorAll:()=>[],body:new Element()};
const context={document,localStorage:{getItem:()=>null},console};vm.createContext(context);
const exposed=script.replace(' pick(unit.unit,unit.cohort);',` this.aggregateHelpers={data,spreadStats,describe,majorPools,relatedCoursePool,majorKeywords,submajorKeywords,setView:v=>unit=v,setCommon:v=>get('common').checked=v};`);
vm.runInContext(exposed,context);context.start(privateViews);
const h=context.aggregateHelpers;
function cells(rows,mode){
  // Start with coarse spatial bins, then merge small bins until every released
  // cell contains at least five students. No membership or individual XY leaves here.
  const bins=new Map();for(const r of rows){const [x,y]=r[mode],key=Math.floor((x+1.3)*2)+':'+Math.floor((y+1.3)*2);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(r);}
  const groups=[...bins.values()];
  const center=g=>[g.reduce((a,r)=>a+r[mode][0],0)/g.length,g.reduce((a,r)=>a+r[mode][1],0)/g.length];
  while(groups.length>1){const index=groups.findIndex(g=>g.length<5);if(index<0)break;const small=groups.splice(index,1)[0],c=center(small);let nearest=0,distance=Infinity;groups.forEach((g,i)=>{const p=center(g),d=(p[0]-c[0])**2+(p[1]-c[1])**2;if(d<distance){nearest=i;distance=d;}});groups[nearest].push(...small);}
  return groups.filter(g=>g.length>=5).map(g=>{const p=center(g),major=g.every(r=>r.major===g[0].major)?g[0].major:'여러 전공 혼합';return {x:Math.round(p[0]*10)/10,y:Math.round(p[1]*10)/10,n:g.length,major:major||'전공 구분 없음'};});
}
const views=[];
for(const view of privateViews){h.setView(view);const output={unit:view.unit,cohort:view.cohort,keywords:h.majorKeywords[view.unit],estimates:(view.estimates||[]).filter(r=>!r.target.endsWith(' 포함')).map(r=>({target:r.target,mean:r.mean_probability,scored:r.scored,unresolved:r.unresolved})),stages:[],submajors:[]};
  for(const stage of view.stages){const item={number:stage.number,n:stage.rows.length};for(const [mode,reduced] of [['all',false],['reduced',true]]){h.setCommon(reduced);elements.major.checked=false;item[mode]={overlap:h.spreadStats(stage).overlap,spread:h.spreadStats(stage,h.majorPools.get(view)).adjusted,pool:h.spreadStats(stage,h.majorPools.get(view)).pool,cells:cells(stage.rows,mode),reading:h.describe(stage,false)};}output.stages.push(item);}
  if(!view.unit.includes('바이오')){const stages=view.stages.filter(s=>s.number>=3),both=new Set(stages.length===2?stages[0].rows.filter(r=>stages[1].rows.some(q=>q.i===r.i)).map(r=>r.i):[]);
    for(const matched of [false,true])for(const stage of stages){const rows=stage.rows.filter(r=>!matched||both.has(r.i));const groups=[];for(const major of [...new Set(rows.map(r=>r.major))].filter(m=>m&&m!=='학부명 기록').sort()){const members=rows.filter(r=>r.major===major&&r.courses.length),p=h.relatedCoursePool(view,major);if(members.length<5){groups.push({major,n:null,mean:null,topOutside:[],keys:p.keys,reviewed:p.reviewed});continue;}
      const mean=members.reduce((sum,r)=>sum+r.courses.filter(c=>!p.ids.has(c)).length/r.courses.length,0)/members.length;
      const counts=new Map();members.forEach(r=>r.courses.filter(c=>!p.ids.has(c)).forEach(c=>counts.set(c,(counts.get(c)||0)+1)));
      const topOutside=[...counts].filter(([c,n])=>n>=5).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([c,n])=>({title:view.titles[c-1],n,rate:n/members.length}));
      groups.push({major,n:members.length,mean,topOutside,keys:p.keys,reviewed:p.reviewed});}
      output.submajors.push({number:stage.number,matched,groups});}
  }views.push(output);
}
const texts=overridesPath?JSON.parse(fs.readFileSync(overridesPath,'utf8')).texts:{};
const payload={version:'1.0.0',releasedOn:'2026-11-06',privacy:{minimumCellSize:5,individualRecords:false},texts,views};
// Check actual released cell/group granularity, not merely field labels.
for(const v of views){for(const s of v.stages)for(const m of ['all','reduced']){assert(s[m].cells.every(c=>c.n>=5));assert.equal(s[m].cells.reduce((n,c)=>n+c.n,0),s.n);}for(const s of v.submajors)for(const g of s.groups){assert(g.n===null||g.n>=5);assert(g.topOutside.every(c=>c.n>=5));}}
const serialized=JSON.stringify(payload,null,2);assert(!/research_id|raw_title|"rows"|"courses"|"current_major"|"all":\s*\[|"reduced":\s*\[/.test(serialized));
const outputPath=path.join(__dirname,'data.json');fs.writeFileSync(outputPath,serialized+'\n');console.log('Aggregate-only data generated:',views.length,'views;',Buffer.byteLength(serialized),'bytes; all released cells >=5.');
