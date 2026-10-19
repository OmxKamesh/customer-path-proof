// Produce a shareable image from actual saved demo evidence, not a simulated result.
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
  const root=path.resolve(process.argv[2]);
  const broken=JSON.parse(await fs.readFile(path.join(root,'broken/report.json'),'utf8'));
  const repaired=JSON.parse(await fs.readFile(path.join(root,'repaired/report.json'),'utf8'));
  if(broken.status!=='failed'||broken.firstDivergence!=='feedback-persisted'||repaired.status!=='passed')throw Error('Expected verified broken/repaired demo evidence');
  const png=await fs.readFile(path.join(root,'broken/step-05.png'));
  const {chromium}=require('playwright');const b=await chromium.launch(process.env.CPP_BROWSER_CHANNEL?{channel:process.env.CPP_BROWSER_CHANNEL}:{});
  try{const p=await b.newPage({viewport:{width:1400,height:920},deviceScaleFactor:1});
    await p.setContent(`<!doctype html><style>body{margin:0;background:#0b1425;color:#edf4ff;font:22px system-ui;padding:50px}small{color:#7bdcc2;letter-spacing:3px}h1{font-size:68px;letter-spacing:-3px;margin:20px 0 8px}p{color:#aabbd2}.grid{display:grid;grid-template-columns:1.2fr 1fr;gap:35px;margin-top:35px}img{width:100%;border-radius:16px}article{background:#17253c;padding:25px;border-radius:16px;margin-bottom:18px}h2{margin:0 0 15px;font-size:25px}.fail{color:#ffaf9f}.pass{color:#71e2bc}code{font-size:21px}footer{font-size:17px;color:#9bb0cc;margin-top:20px}</style><small>KAMESH JINDAL / OMX DIGITAL</small><h1>“Saved!” isn't proof.</h1><p>Customer Path Proof · Real Chrome replay against a deliberately broken local demo.</p><div class="grid"><div><img src="data:image/png;base64,${png.toString('base64')}"><footer>Actual browser screenshot. The interface claims success.</footer></div><div><article><h2 class="fail">BROKEN · FAILED</h2>POST /api/feedback → 503<p>UI confirmation: passed<br>Persisted outcome: failed</p><code>expected: ["Improve onboarding"]<br>observed: []</code></article><article><h2 class="pass">REPAIRED · PASSED</h2>Same contract. Fresh fixture.<p>POST /api/feedback → 201<br>All five steps passed.</p><code>observed: ["Improve onboarding"]</code></article><footer>Synthetic data. One journey. No claim of complete app coverage.</footer></div></div>`);
    await fs.mkdir('docs',{recursive:true});await p.screenshot({path:'docs/proof.png'});
  }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
