'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {start}=require('./server.cjs');
const {run}=require('../scripts/run.cjs');
async function main(){
  await fs.mkdir('artifacts',{recursive:true});
  const root=await fs.mkdtemp(path.resolve('artifacts/extended-'));
  const summaries=[];
  const scenarios=[
    {name:'feedback-broken',options:{broken:true},contract:'journey',expect:'failed',divergence:'feedback-persisted'},
    {name:'feedback-fixed',options:{broken:false},contract:'journey',expect:'passed'},
    {name:'session-broken',options:{broken:false,sessionOnly:true},contract:'persistence',expect:'failed',divergence:'new-session-readback'},
    {name:'session-fixed',options:{broken:false},contract:'persistence',expect:'passed'},
    {name:'upload-broken',options:{broken:false,uploadBroken:true},contract:'upload',expect:'failed',divergence:'uploaded-bytes'},
    {name:'upload-fixed',options:{broken:false},contract:'upload',expect:'passed'}
  ];
  for(const s of scenarios){
    const server=await start(s.options);
    try{
      const r=await run({contract:require('./'+s.contract+'.json'),origin:server.origin,output:path.join(root,s.name),writes:['POST:/api/feedback','POST:/api/upload'],files:{sample:path.join(__dirname,'fixtures/sample.txt')},channel:process.env.CPP_BROWSER_CHANNEL});
      const expected=r.status===s.expect && (!s.divergence||r.firstDivergence===s.divergence);
      summaries.push({scenario:s.name,status:r.status,firstDivergence:r.firstDivergence,expected});
      console.log(`${s.name}: ${r.status.toUpperCase()} (${r.firstDivergence||'all declared outcomes verified'})`);
    }finally{await server.close();}
  }
  await fs.writeFile(path.join(root,'summary.json'),JSON.stringify(summaries,null,2));
  await fs.writeFile(path.join(root,'index.html'),'<!doctype html><meta charset="utf-8"><title>Customer Path Proof demo</title><h1>Three promises. Broken and fixed.</h1><p>Synthetic local fixtures. Expected failures demonstrate detection, not live customer defects.</p><ul>'+summaries.map(s=>`<li><a href="${s.scenario}/report.html">${s.scenario}: ${s.status}</a></li>`).join('')+'</ul>');
  console.log('Evidence: '+path.join(root,'index.html'));
  process.exitCode=summaries.every(s=>s.expected)?0:1;
}
main().catch(e=>{console.error(e.message);process.exitCode=2;});
