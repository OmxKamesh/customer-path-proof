'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {run,validate}=require('../scripts/run.cjs');
const {start}=require('../demo/server.cjs');
const persistence=require('../demo/persistence.json');
const upload=require('../demo/upload.json');
const origin='http://127.0.0.1:3000';
const fixture=path.resolve(__dirname,'../demo/fixtures/sample.txt');
test('explicit adapters validate; unknown adapters and fixture paths do not',()=>{
  assert.equal(validate(persistence,origin),persistence);assert.equal(validate(upload,origin),upload);
  for(const change of [{adapter:'execute-script'},{fixture:'../../private'}]) {
    const c=structuredClone(upload);Object.assign(c.steps.at(-1),change);assert.throws(()=>validate(c,origin));
  }
  const c=structuredClone(persistence);c.steps.at(-1).adapter='unknown';assert.throws(()=>validate(c,origin));
});
test('upload needs explicit local file authorization before creating output',async()=>{
  const root=await fs.mkdtemp('/tmp/cpp-fixture-test-');const out=path.join(root,'absent');
  await assert.rejects(()=>run({contract:upload,origin,output:out}),/not explicitly allowed/);
  await assert.rejects(()=>fs.stat(out));
});
test('browser: refresh succeeds but session-only storage fails a clean-session readback',{skip:!process.env.CPP_BROWSER_TESTS},async()=>{
  for(const sessionOnly of [true,false]) {
    const server=await start({broken:false,sessionOnly});const root=await fs.mkdtemp('/tmp/cpp-session-');
    try {const r=await run({contract:persistence,origin:server.origin,output:path.join(root,'report'),writes:['POST:/api/feedback'],channel:process.env.CPP_BROWSER_CHANNEL});
      assert.equal(r.status,sessionOnly?'failed':'passed',JSON.stringify(r));
      assert.equal(r.steps.find(s=>s.id==='refresh-readback').status,'passed');
      assert.equal(r.steps.at(-1).session,2);
      assert.equal(r.firstDivergence,sessionOnly?'new-session-readback':null);
    }finally{await server.close();}
  }
});
test('browser: upload receipt is insufficient; byte readback detects corruption',{skip:!process.env.CPP_BROWSER_TESTS},async()=>{
  for(const uploadBroken of [true,false]) {
    const server=await start({broken:false,uploadBroken});const root=await fs.mkdtemp('/tmp/cpp-upload-');
    try{const r=await run({contract:upload,origin:server.origin,output:path.join(root,'report'),writes:['POST:/api/upload'],files:{sample:fixture},channel:process.env.CPP_BROWSER_CHANNEL});
      assert.equal(r.status,uploadBroken?'failed':'passed',JSON.stringify(r));assert.equal(r.steps[3].status,'passed');
      assert.equal(r.firstDivergence,uploadBroken?'uploaded-bytes':null);
      assert.match(r.steps.at(-1).detail,/observedSha256/);
    }finally{await server.close();}
  }
});
test('browser: a clean session preserves denied-write policy',{skip:!process.env.CPP_BROWSER_TESTS},async()=>{
  const server=await start({broken:false});const root=await fs.mkdtemp('/tmp/cpp-policy-');
  try{const c=structuredClone(persistence);c.steps.splice(1,0,{id:'another-session',action:'newSession',path:'/'});
    const r=await run({contract:c,origin:server.origin,output:path.join(root,'report'),channel:process.env.CPP_BROWSER_CHANNEL});assert.equal(r.status,'blocked');assert.ok(r.events.some(e=>e.type==='blocked-request'));
  }finally{await server.close();}
});
test('raw-byte adapter bounds readback, preserves bytes, and never follows redirects',async()=>{
  const {readBytes}=require('../scripts/run.cjs');const http=require('node:http');let escaped=0;
  const server=http.createServer((req,res)=>{
    if(req.url==='/bytes'){res.end(Buffer.from([0,255,128,10]));}
    else if(req.url==='/big'){res.end(Buffer.alloc(1024*1024+1));}
    else if(req.url==='/redirect'){res.writeHead(302,{Location:'/escape'});res.end();}
    else {escaped++;res.end();}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  try{assert.deepEqual((await readBytes(base+'/bytes')).bytes,Buffer.from([0,255,128,10]));await assert.rejects(()=>readBytes(base+'/big'),/limit/);assert.equal((await readBytes(base+'/redirect')).status,302);assert.equal(escaped,0);}finally{await new Promise(r=>server.close(r));}
});
test('demo fixtures really lose session-only state and corrupt uploaded bytes',async()=>{
  for(const broken of [true,false]){
    const server=await start({broken:false,sessionOnly:broken,uploadBroken:broken});
    try{
      const visit=await fetch(server.origin);const cookie=visit.headers.get('set-cookie')?.split(';')[0]||'';const headers={cookie,'Content-Type':'application/json'};
      await fetch(server.origin+'/api/feedback',{method:'POST',headers,body:JSON.stringify({idea:'synthetic-test'})});
      assert.deepEqual((await (await fetch(server.origin+'/api/feedback',{headers})).json()).items,['synthetic-test']);
      assert.deepEqual((await (await fetch(server.origin+'/api/feedback')).json()).items,broken?[]:['synthetic-test']);
      await fetch(server.origin+'/api/upload',{method:'POST',body:'synthetic-file'});
      assert.equal(await (await fetch(server.origin+'/api/upload')).text(),broken?'s':'synthetic-file');
    }finally{await server.close();}
  }
});
test('CLI help is successful, invalid invocation exits 2',()=>{
  const {spawnSync}=require('node:child_process');const cli=path.resolve(__dirname,'../scripts/run.cjs');
  const help=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8'});assert.equal(help.status,0);assert.match(help.stdout,/synthetic/);
  const invalid=spawnSync(process.execPath,[cli,'--unknown','x'],{encoding:'utf8'});assert.equal(invalid.status,2);assert.match(invalid.stderr,/Unknown option/);
});
