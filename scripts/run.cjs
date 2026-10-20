#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');

function validate(c, origin) {
  const u = new URL(origin);
  if (!['http:', 'https:'].includes(u.protocol) || u.origin !== origin || u.username || u.password) throw Error('Use an exact http(s) origin without credentials or a trailing slash');
  if (!c || c.version !== 1 || typeof c.name !== 'string' || !c.name.trim() || !Array.isArray(c.steps) || !c.steps.length || c.steps.length > 50) throw Error('Contract requires version 1, name, and 1–50 steps');
  const ids = new Set();
  for (const s of c.steps) {
    if (!s.id || typeof s.id !== 'string' || ids.has(s.id)) throw Error('Step IDs must be unique strings');
    ids.add(s.id);
    if (!['open','fill','click','visible','saved','refresh','newSession','upload','fileSaved'].includes(s.action)) throw Error('Unknown action: '+s.action);
    if (['open','saved','newSession','fileSaved'].includes(s.action)) {
      if (typeof s.path !== 'string' || !s.path.startsWith('/') || new URL(s.path,origin).origin !== origin) throw Error('Paths must remain on the authorized origin');
    }
    if (['fill','click','visible','upload'].includes(s.action) && (typeof s.selector !== 'string' || !s.selector)) throw Error('A selector is required');
    if (['fill','visible'].includes(s.action) && typeof s.value !== 'string') throw Error('A string value is required');
    if (s.action === 'saved' && (typeof s.field !== 'string' || !Object.hasOwn(s,'equals'))) throw Error('saved requires a field and equals value');
    if (['upload','fileSaved'].includes(s.action) && (typeof s.fixture !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(s.fixture))) throw Error('upload/fileSaved requires a fixture ID');
    if (s.action === 'fileSaved' && s.adapter !== 'bytes-sha256') throw Error('fileSaved requires the explicit bytes-sha256 adapter');
    if (s.action === 'saved' && s.adapter && s.adapter !== 'json-field') throw Error('Unknown saved adapter');
  }
  if (!c.steps.some(s=>['saved','fileSaved'].includes(s.action))) throw Error('At least one saved outcome check is required');
  return c;
}
function permitted(url, method, origin, writes=[]) {
  try {const u=new URL(url);return u.origin===origin && (['GET','HEAD'].includes(method) || writes.includes(method+':'+u.pathname));} catch {return false;}
}
// Bounded raw-byte adapter. No redirect following and no application JS execution.
async function readBytes(url, cookies=[], limit=1024*1024) {
  const target=new URL(url);
  const client=require(target.protocol==='https:'?'node:https':'node:http');
  return new Promise((resolve,reject)=>{
    const req=client.get(target,{headers:{'Cache-Control':'no-cache',Cookie:cookies.map(c=>c.name+'='+c.value).join('; ')}},res=>{
      if(res.statusCode>=300&&res.statusCode<400){res.resume();resolve({status:res.statusCode,bytes:Buffer.alloc(0)});return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>limit){req.destroy();reject(Error('File readback exceeds 1 MiB limit'));}else chunks.push(chunk);});
      res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(chunks)}));
      res.on('error',()=>reject(Error('File readback transport failed')));
    });
    req.setTimeout(4000,()=>{req.destroy();reject(Error('File readback transport timed out'));});
    req.on('error',()=>reject(Error('File readback transport failed')));
  });
}
const cleanUrl = url => {try {const u=new URL(url);return u.origin+u.pathname;}catch{return '[invalid URL]';}};
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(r) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Customer Path Proof</title><style>body{font:16px system-ui;background:#0c1425;color:#e8eefb;max-width:1000px;margin:40px auto;padding:24px}h1{font-size:44px}header,p{color:#aebdd7}strong{color:#63dfbe}article{background:#152239;padding:20px;margin:14px 0;border-radius:12px}img{width:100%;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#63dfbe}</style><header>OMX DIGITAL / KAMESH JINDAL</header><h1>Customer Path Proof</h1><p>${escape(r.name)}</p><h2>${escape(r.status.toUpperCase())}</h2>${r.error?`<pre>${escape(r.error)}</pre>`:''}<p>First divergence: ${escape(r.firstDivergence || 'none')}</p>${r.steps.map(s=>`<article><strong>${escape(s.id)} · ${escape(s.status)}</strong><pre>${escape(s.detail || '')}</pre>${s.screenshot?`<a href="${escape(s.screenshot)}"><img src="${escape(s.screenshot)}" alt="Browser evidence for ${escape(s.id)}"></a>`:''}</article>`).join('')}<h2>Observed network and console events</h2><pre>${escape(JSON.stringify(r.events,null,2))}</pre><p>Only the declared journey was checked. Passing does not establish overall application correctness. Screenshots can contain sensitive data.</p>`;
}
async function run({contract, origin, output, writes=[], channel, executablePath=process.env.CPP_BROWSER_EXECUTABLE, files={}}) {
  validate(contract,origin);
  for (const w of writes) if (!/^(POST|PUT|PATCH|DELETE):\/[^?#]*$/.test(w)) throw Error('Write allowance must be METHOD:/exact/path');
  const fixtures=Object.create(null);
  for(const id of new Set(contract.steps.filter(s=>s.fixture).map(s=>s.fixture))) {
    if(!Object.hasOwn(files,id)) throw Error('Fixture not explicitly allowed: '+id);
    const stat=await fs.stat(files[id]);
    if(!stat.isFile()||stat.size>1024*1024)throw Error('Fixture must be a regular file at most 1 MiB');
    const bytes=await fs.readFile(files[id]);
    if(bytes.length>1024*1024) throw Error('Fixtures must be at most 1 MiB');
    fixtures[id]={name:path.basename(files[id]),mimeType:'application/octet-stream',buffer:bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  await fs.mkdir(output,{recursive:false}); // Never overwrite an earlier evidence run.
  const report={version:1,name:contract.name,origin,startedAt:new Date().toISOString(),status:'incomplete',firstDivergence:null,steps:[],events:[],policy:{writes,serviceWorkers:'blocked',webSockets:'blocked'}};
  let browser,context,page;
  const events=report.events;
  let violation=false;
  try {
    const {chromium}=require('playwright');
    browser=await chromium.launch(executablePath?{executablePath}:channel?{channel}:{});
    let session=0;
    async function freshContext() {
    session++;
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
    }
    await freshContext();
    for (const [i,s] of contract.steps.entries()) {
      const observation={id:s.id,action:s.action,status:'passed',session};
      try {
        if(s.action==='open') {const r=await page.goto(new URL(s.path,origin).href);if(!r||r.status()>=400)throw Error('Navigation did not return a successful response');}
        if(s.action==='refresh') {const r=await page.reload();if(!r||r.status()>=400)throw Error('Refresh failed');}
        if(s.action==='newSession') {await context.close();await freshContext();observation.session=session;const r=await page.goto(new URL(s.path,origin).href);if(!r||r.status()>=400)throw Error('New-session navigation failed');}
        if(s.action==='upload') {const f=fixtures[s.fixture];await page.locator(s.selector).setInputFiles({name:f.name,mimeType:f.mimeType,buffer:f.buffer});observation.detail='Explicit synthetic fixture: '+s.fixture;}
        if(s.action==='fileSaved') {
          const url=new URL(s.path,origin).href;
          const response=await readBytes(url,await context.cookies(url));
          if(response.status>=300&&response.status<400){violation=true;events.push({type:'blocked-readback-redirect',url:cleanUrl(url)});throw Error('File readback redirect blocked');}
          const bytes=response.bytes;const sha256=createHash('sha256').update(bytes).digest('hex');
          observation.detail=JSON.stringify({adapter:s.adapter,httpStatus:response.status,bytes:bytes.length,expectedSha256:fixtures[s.fixture].sha256,observedSha256:sha256});
          if(response.status!==200||sha256!==fixtures[s.fixture].sha256)throw Error('Uploaded bytes differ. '+observation.detail);
        }
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
      } catch(e) {observation.status=violation?'blocked':/net::|Target.*closed|browser.*closed|Failed to fetch|transport failed|transport timed out/.test(e.message)?'incomplete':'failed';observation.detail=e.message;}
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
  const args=process.argv.slice(2), opts={writes:[],files:Object.create(null)};
  if(args.length===1&&args[0]==='--help'){console.log('Customer Path Proof: --contract FILE --origin URL --out NEW_DIR [--allow-write METHOD:/path] [--file ID=PATH] [--channel chrome | --executable PATH]\nExit: 0 passed; 1 assertion failed; 2 blocked/incomplete/invalid. Use synthetic data on authorized local/staging apps only.');return;}
  for(let i=0;i<args.length;i+=2){const k=args[i],v=args[i+1];if(!v)throw Error('Missing option value');if(k==='--contract')opts.contract=JSON.parse(await fs.readFile(v,'utf8'));else if(k==='--origin')opts.origin=v;else if(k==='--out')opts.output=v;else if(k==='--allow-write')opts.writes.push(v);else if(k==='--file'){const at=v.indexOf('=');if(at<1)throw Error('Use --file fixture-id=/path/to/synthetic-file');opts.files[v.slice(0,at)]=v.slice(at+1);}else if(k==='--executable')opts.executablePath=v;else if(k==='--channel')opts.channel=v;else throw Error('Unknown option '+k);}
  if(!opts.contract||!opts.origin||!opts.output)throw Error('Usage: node scripts/run.cjs --contract journey.json --origin http://127.0.0.1:3000 --out new-evidence-folder [--allow-write POST:/api/feedback] [--channel chrome]');
  const r=await run(opts);console.log(JSON.stringify({status:r.status,firstDivergence:r.firstDivergence,output:opts.output}));process.exitCode=r.status==='passed'?0:r.status==='failed'?1:2;
})().catch(e=>{console.error(e.message);process.exitCode=2;});
module.exports={run,validate,permitted,html,readBytes};
