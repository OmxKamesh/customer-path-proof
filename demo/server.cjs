'use strict';
const http=require('node:http');
async function start({broken=true,mockReadback=false,sessionOnly=false,uploadBroken=false}={}) {
  let saved=[];let uploaded=Buffer.alloc(0);
  const sessions=new Map();
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(sessionOnly){let id=req.headers.cookie?.match(/cpp=([a-z0-9]+)/)?.[1];if(!id){id=require('node:crypto').randomBytes(8).toString('hex');res.setHeader('Set-Cookie','cpp='+id+'; HttpOnly; SameSite=Strict');}if(!sessions.has(id))sessions.set(id,[]);saved=sessions.get(id);}
    if(req.url==='/api/upload'&&req.method==='POST'){const chunks=[];let size=0;req.on('data',c=>{size+=c.length;if(size>1048576)req.destroy();else chunks.push(c);});req.on('end',()=>{const b=Buffer.concat(chunks);uploaded=uploadBroken?b.subarray(0,1):b;res.writeHead(201,{'Content-Type':'application/json'});res.end('{"saved":true}');});return;}
    if(req.url==='/api/upload'&&req.method==='GET'){res.setHeader('Content-Type','application/octet-stream');res.end(uploaded);return;}
    if(req.url==='/api/feedback'&&req.method==='POST'){
      let body='';req.on('data',chunk=>{body+=chunk;if(body.length>8192)req.destroy();});
      req.on('end',()=>{res.setHeader('Content-Type','application/json');let idea;
        try{idea=JSON.parse(body).idea;if(typeof idea!=='string'||!idea.trim())throw Error();}catch{res.statusCode=400;res.end('{"error":"idea required"}');return;}
        if(broken){res.statusCode=503;res.end('{"error":"storage unavailable"}');}
        else{saved.push(idea);res.statusCode=201;res.end('{"saved":true}');}
      });return;
    }
    if(req.url==='/api/feedback'&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:saved}));return;}
    if(req.url!=='/'){res.statusCode=404;res.end('Not found');return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><title>Signal Desk · synthetic demo</title><style>body{background:#ecf2f6;font:18px system-ui;color:#17283a;margin:0}main{max-width:680px;margin:75px auto;background:white;padding:42px;border-radius:20px;box-shadow:0 15px 50px #20365015}small{color:#52728d;text-transform:uppercase;letter-spacing:2px}h1{font-size:44px;margin:18px 0}textarea{display:block;box-sizing:border-box;width:100%;height:100px;border:1px solid #b3c7d7;border-radius:8px;padding:16px;font:inherit;margin:12px 0 20px}button{background:#0c7665;color:white;border:0;padding:15px 24px;border-radius:8px;font:inherit}#status{color:#0c7665;font-weight:700}footer{font-size:14px;color:#5e7485;margin-top:40px}</style><main><small>Signal Desk / synthetic demo</small><h1>Make the product better.</h1><p>Send one idea to the product team.</p><label for="idea">Your feedback</label><textarea id="idea"></textarea><button id="send">Send feedback</button><p id="status" hidden></p><p>Saved feedback: <span id="saved-items"></span></p><label for="attachment">Synthetic attachment</label><input id="attachment" type="file"><button id="upload">Upload</button><p id="upload-status" hidden></p><footer>Customer Path Proof · Kamesh Jindal / OMX Digital<br>No real customers, accounts, or external services.</footer></main><script>${mockReadback?"const nativeFetch=window.fetch;window.fetch=(url,opts)=>(!opts?.method||opts.method.toUpperCase()==='GET')?Promise.resolve(new Response(JSON.stringify({items:['Improve onboarding']}),{status:200})):nativeFetch(url,opts);":""}fetch('/api/feedback').then(r=>r.json()).then(x=>document.querySelector('#saved-items').textContent=x.items.join(', '));document.querySelector('#upload').onclick=async()=>{const f=document.querySelector('#attachment').files[0];const r=await fetch('/api/upload',{method:'POST',body:f});if(r.ok){document.querySelector('#upload-status').hidden=false;document.querySelector('#upload-status').textContent='File saved.';}};document.querySelector('#send').onclick=async()=>{const r=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idea:document.querySelector('#idea').value})});${broken?"console.error('Demo storage write rejected; UI ignores response status');":"if(!r.ok)throw Error('Save failed');"}document.querySelector('#status').hidden=false;document.querySelector('#status').textContent='Thanks! Your feedback was saved.';};</script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
module.exports={start};
