'use strict';
const {start}=require('./server.cjs');
const {run}=require('../scripts/run.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
  const root=path.resolve('artifacts','demo-'+Date.now());await fs.mkdir(root,{recursive:true});
  const reports=[];
  for(const broken of [true,false]){
    const demo=await start({broken});
    try{const label=broken?'broken':'repaired';const report=await run({contract:require('./journey.json'),origin:demo.origin,output:path.join(root,label),writes:['POST:/api/feedback'],channel:process.env.CPP_BROWSER_CHANNEL});reports.push(report);console.log(label+': '+report.status+' / '+(report.firstDivergence||'all outcomes verified'));}
    finally{await demo.close();}
  }
  await fs.writeFile(path.join(root,'index.html'),`<!doctype html><meta charset="utf-8"><title>One promise. Two outcomes.</title><style>body{background:#0c1425;color:#eff6ff;font:20px system-ui;margin:60px}h1{font-size:56px}a{color:#61dfbe}iframe{width:47%;height:800px;border:1px solid #344760;margin-right:2%}</style><p>KAMESH JINDAL / OMX DIGITAL</p><h1>“Saved!” isn't proof.</h1><p>The same customer contract. A rejected write, then a repaired write.</p><p><a href="broken/report.html">Broken: ${reports[0].status}</a> · <a href="repaired/report.html">Repaired: ${reports[1].status}</a></p><iframe title="Broken evidence" src="broken/report.html"></iframe><iframe title="Repaired evidence" src="repaired/report.html"></iframe>`);
  console.log('Open '+path.join(root,'index.html'));
  process.exitCode=reports[0].status==='failed'&&reports[0].firstDivergence==='feedback-persisted'&&reports[1].status==='passed'?0:1;
})().catch(e=>{console.error(e);process.exitCode=2;});
