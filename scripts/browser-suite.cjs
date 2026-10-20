'use strict';
const {spawnSync}=require('node:child_process');
const r=spawnSync(process.execPath,['--test'],{stdio:'inherit',env:{...process.env,CPP_BROWSER_TESTS:'1'}});
process.exitCode=r.status??2;
