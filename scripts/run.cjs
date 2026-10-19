#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {isDeepStrictEqual} = require('node:util');

function validate(c, origin) {
  const u = new URL(origin);
  if (!['http:', 'https:'].includes(u.protocol) || u.origin !== origin || u.username || u.password) throw Error('Use an exact http(s) origin without credentials or a trailing slash');
  if (!c || c.version !== 1 || typeof c.name !== 'string' || !c.name.trim() || !Array.isArray(c.steps) || !c.steps.length || c.steps.length > 50) throw Error('Contract requires version 1, name, and 1–50 steps');
  const ids = new Set();
  for (const s of c.steps) {
    if (!s.id || typeof s.id !== 'string' || ids.has(s.id)) throw Error('Step IDs must be unique strings');
    ids.add(s.id);
    if (!['open','fill','click','visible','saved'].includes(s.action)) throw Error('Unknown action: '+s.action);
    if (['open','saved'].includes(s.action)) {
      if (typeof s.path !== 'string' || !s.path.startsWith('/') || new URL(s.path,origin).origin !== origin) throw Error('Paths must remain on the authorized origin');
    }
    if (['fill','click','visible'].includes(s.action) && (typeof s.selector !== 'string' || !s.selector)) throw Error('A selector is required');
    if (['fill','visible'].includes(s.action) && typeof s.value !== 'string') throw Error('A string value is required');
    if (s.action === 'saved' && (typeof s.field !== 'string' || !Object.hasOwn(s,'equals'))) throw Error('saved requires a field and equals value');
  }
  if (!c.steps.some(s=>s.action==='saved')) throw Error('At least one saved outcome check is required');
  return c;
}
function permitted(url, method, origin, writes=[]) {
  try {const u=new URL(url);return u.origin===origin && (['GET','HEAD'].includes(method) || writes.includes(method+':'+u.pathname));} catch {return false;}
}
const cleanUrl = url => {try {const u=new URL(url);return u.origin+u.pathname;}catch{return '[invalid URL]';}};
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(r) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Customer Path Proof</title><style>body{font:16px system-ui;background:#0c1425;color:#e8eefb;max-width:1000px;margin:40px auto;padding:24px}h1{font-size:44px}header,p{color:#aebdd7}strong{color:#63dfbe}article{background:#152239;padding:20px;margin:14px 0;border-radius:12px}img{width:100%;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#63dfbe}</style><header>OMX DIGITAL / KAMESH JINDAL</header><h1>Customer Path Proof</h1><p>${escape(r.name)}</p><h2>${escape(r.status.toUpperCase())}</h2><p>First divergence: ${escape(r.firstDivergence || 'none')}</p>${r.steps.map(s=>`<article><strong>${escape(s.id)} · ${escape(s.status)}</strong><pre>${escape(s.detail || '')}</pre>${s.screenshot?`<a href="${escape(s.screenshot)}"><img src="${escape(s.screenshot)}" alt="Browser evidence for ${escape(s.id)}"></a>`:''}</article>`).join('')}<h2>Observed network and console events</h2><pre>${escape(JSON.stringify(r.events,null,2))}</pre><p>Only the declared journey was checked. Passing does not establish overall application correctness. Screenshots can contain sensitive data.</p>`;
}
async function run({contract, origin, output, writes=[], channel}) {
  validate(contract,origin);
  for (const w of writes) if (!/^(POST|PUT|PATCH|DELETE):\/[^?#]*$/.test(w)) throw Error('Write allowance must be METHOD:/exact/path');
  await fs.mkdir(output,{recursive:false}); // Never overwrite an earlier evidence run.
  const report={version:1,name:contract.name,origin,startedAt:new Date().toISOString(),status:'incomplete',firstDivergence:null,steps:[],events:[],policy:{writes,serviceWorkers:'blocked',webSockets:'blocked'}};
  let browser,context,page;
  const events=report.events;
  let violation=false;
  try {
    const {chromium}=require('playwright');
    browser=await chromium.launch(channel?{channel}:{});
    context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:1100,height:720}});
    await context.route('**/*',async route=>{
      const q=route.request();
      if (!permitted(q.url(),q.method(),origin,writes)) {violation=true;events.push({type:'blocked-request',method:q.method(),url:cleanUrl(q.url())});await route.abort();}
      else {
        try {
          const response=await route.fetch({maxRedirects:0,timeout:10000});
          if(response.status()>=300&&response.status()<400){violation=true;events.push({type:'blocked-redirect',url:cleanUrl(q.url())});await route.abort();}
          else await route.fulfill({response});
        } catch {events.push({type:'transport-error',url:cleanUrl(q.url())});await route.abort().catch(()=>{});}
      }
    });
    await context.routeWebSocket('**/*', ws=>{violation=true;events.push({type:'blocked-websocket',url:cleanUrl(ws.url())});ws.close();});
    page=await context.newPage();
    context.on('page',p=>{if(p!==page){violation=true;events.push({type:'blocked-popup'});p.close().catch(()=>{});}});
    page.setDefaultTimeout(4000);
    page.on('console',m=>{if(['error','warning'].includes(m.type())) events.push({type:'console-'+m.type(),text:m.text().slice(0,1000)});});
    page.on('pageerror',e=>events.push({type:'page-error',text:e.message.slice(0,1000)}));
    page.on('response',r=>{if(r.status()>=400) events.push({type:'http-error',status:r.status(),url:cleanUrl(r.url())});});
    page.on('requestfailed',r=>events.push({type:'request-failed',url:cleanUrl(r.url())}));
    for (const [i,s] of contract.steps.entries()) {
      const observation={id:s.id,action:s.action,status:'passed'};
      try {
        if(s.action==='open') {const r=await page.goto(new URL(s.path,origin).href);if(!r||r.status()>=400)throw Error('Navigation did not return a successful response');}
        if(s.action==='fill') await page.locator(s.selector).fill(s.value);
        if(s.action==='click') await page.locator(s.selector).click();
        if(s.action==='visible') {const l=page.locator(s.selector);await l.waitFor({state:'visible'});const text=await l.innerText();if(text!==s.value)throw Error('Visible text differs: '+JSON.stringify({expected:s.value,observed:text}));}
        if(s.action==='saved') {
          // Independent client: application JS cannot mock this readback. Exact-origin
          // paths were validated; no redirect hops are followed by this client.
          const response=await context.request.get(new URL(s.path,origin).href,{maxRedirects:0,timeout:4000,headers:{'Cache-Control':'no-cache'}});
          if(response.status()>=300&&response.status()<400){violation=true;events.push({type:'blocked-readback-redirect',url:cleanUrl(response.url())});throw Error('Readback redirect blocked');}
          const result={status:response.status(),body:await response.json()};
          const actual=result.body?.[s.field];
          observation.detail=JSON.stringify({httpStatus:result.status,field:s.field,expected:s.equals,observed:actual??null});
          if(result.status!==200 || !isDeepStrictEqual(actual,s.equals))throw Error('Persisted outcome differs. '+observation.detail);
        }
      } catch(e) {observation.status=violation?'blocked':/net::|Target.*closed|browser.*closed|Failed to fetch/.test(e.message)?'incomplete':'failed';observation.detail=e.message;}
      if(violation){observation.status='blocked';observation.detail='A browser request exceeded the authorized scope. Review events.';}
      try {observation.screenshot=`step-${String(i+1).padStart(2,'0')}.png`;await page.screenshot({path:path.join(output,observation.screenshot)});}catch{delete observation.screenshot;observation.status='incomplete';observation.detail=(observation.detail||'')+' Screenshot capture failed';}
      report.steps.push(observation);
      if(observation.status!=='passed'){report.status=observation.status;report.firstDivergence=s.id;break;}
    }
    if(report.steps.length===contract.steps.length && report.steps.every(s=>s.status==='passed')) report.status=violation?'blocked':'passed';
  } catch(e) {report.status='incomplete';report.error=e.message;}
  finally {if(browser)await browser.close().catch(()=>{});}
  report.finishedAt=new Date().toISOString();
  report.unexecuted=contract.steps.slice(report.steps.length).map(s=>s.id);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(output,'report.html'),html(report));
  return report;
}
if(require.main===module) (async()=>{
  const args=process.argv.slice(2), opts={writes:[]};
  for(let i=0;i<args.length;i+=2){const k=args[i],v=args[i+1];if(!v)throw Error('Missing option value');if(k==='--contract')opts.contract=JSON.parse(await fs.readFile(v,'utf8'));else if(k==='--origin')opts.origin=v;else if(k==='--out')opts.output=v;else if(k==='--allow-write')opts.writes.push(v);else if(k==='--channel')opts.channel=v;else throw Error('Unknown option '+k);}
  if(!opts.contract||!opts.origin||!opts.output)throw Error('Usage: node scripts/run.cjs --contract journey.json --origin http://127.0.0.1:3000 --out new-evidence-folder [--allow-write POST:/api/feedback] [--channel chrome]');
  const r=await run(opts);console.log(JSON.stringify({status:r.status,firstDivergence:r.firstDivergence,output:opts.output}));process.exitCode=r.status==='passed'?0:r.status==='failed'?1:2;
})().catch(e=>{console.error(e.message);process.exitCode=2;});
module.exports={run,validate,permitted,html};
