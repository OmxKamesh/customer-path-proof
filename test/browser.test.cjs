const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {run}=require('../scripts/run.cjs');
const {start}=require('../demo/server.cjs');
const contract=require('../demo/journey.json');
test('real browser: false UI success fails, repair passes, unauthorized write blocks',{skip:!process.env.CPP_BROWSER_TESTS},async()=>{
  await fs.mkdir('artifacts',{recursive:true});
  const root=await fs.mkdtemp(path.resolve('artifacts/browser-test-'));
  let iteration=0;
  for(const scenario of [{broken:true,writes:['POST:/api/feedback'],status:'failed'},{broken:false,writes:['POST:/api/feedback'],status:'passed'},{broken:false,writes:[],status:'blocked'},{broken:true,mockReadback:true,writes:['POST:/api/feedback'],status:'failed'},{broken:false,alternate:true,writes:['POST:/api/feedback'],status:'passed'}]){
    const demo=await start(scenario);
    try{
      if(scenario.mockReadback){
        const b=await require('playwright').chromium.launch(process.env.CPP_BROWSER_CHANNEL?{channel:process.env.CPP_BROWSER_CHANNEL}:{});
        try{const p=await b.newPage();await p.goto(demo.origin);const fabricated=await p.evaluate(async()=>{const r=await fetch('/api/feedback',{cache:'no-store',redirect:'error'});return r.json();});assert.deepEqual(fabricated.items,['Improve onboarding']);}finally{await b.close();}
      }
      const out=path.join(root,scenario.status+iteration++);
      const journey=structuredClone(contract);if(scenario.alternate){journey.steps[1].value='Make search faster';journey.steps[4].equals=['Make search faster'];}
      const r=await run({contract:journey,origin:demo.origin,output:out,writes:scenario.writes,channel:process.env.CPP_BROWSER_CHANNEL});
      assert.equal(r.status,scenario.status,JSON.stringify(r));
      if(r.status==='failed'){assert.equal(r.firstDivergence,'feedback-persisted');assert.equal(r.steps[3].status,'passed');assert.ok(r.events.some(e=>e.status===503));}
      if(r.status==='passed'){assert.equal(r.steps.length,5);assert.deepEqual(r.unexecuted,[]);}
      if(r.status==='blocked')assert.ok(r.events.some(e=>e.type==='blocked-request'));
      assert.ok((await fs.stat(path.join(out,'step-01.png'))).size>100);
      await assert.rejects(()=>run({contract,origin:demo.origin,output:out}));
    }finally{await demo.close();}
  }
});
test('real browser: redirect never contacts a second origin',{skip:!process.env.CPP_BROWSER_TESTS},async()=>{
  await fs.mkdir('artifacts',{recursive:true});
  const http=require('node:http');let hits=0;
  const target=http.createServer((q,r)=>{hits++;r.end('out of scope');});await new Promise(r=>target.listen(0,'127.0.0.1',r));
  const source=http.createServer((q,r)=>{r.writeHead(302,{Location:`http://127.0.0.1:${target.address().port}/`});r.end();});await new Promise(r=>source.listen(0,'127.0.0.1',r));
  try{const root=await fs.mkdtemp(path.resolve('artifacts/redirect-test-'));const r=await run({contract,origin:`http://127.0.0.1:${source.address().port}`,output:path.join(root,'run'),channel:process.env.CPP_BROWSER_CHANNEL});assert.equal(r.status,'blocked');assert.equal(hits,0);}finally{await Promise.all([new Promise(r=>source.close(r)),new Promise(r=>target.close(r))]);}
});
