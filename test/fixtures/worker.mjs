import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {mockSpeechWav} from '../../src/wav.mjs';
const args=process.argv;const root=args[args.indexOf('--output-root')+1];
const emit=x=>console.log('LIVE_WORKER '+JSON.stringify(x));
await fs.writeFile(path.join(root,'worker-env.json'),JSON.stringify({
 omp:process.env.OMP_NUM_THREADS,mkl:process.env.MKL_NUM_THREADS,
 blas:process.env.OPENBLAS_NUM_THREADS,wait:process.env.OMP_WAIT_POLICY}));
const usesEpisode=args.includes('--approved-delivery-codes');
emit({type:'READY',...(usesEpisode?{delivery_codes:{SHANNY:['S07','S08'],REV:['R11','R12']}}:{})});
for await (const line of readline.createInterface({input:process.stdin})) {
 const req=JSON.parse(line);if(req.type==='SHUTDOWN')break;
 if(req.text==='timeout')continue;
 if(req.text==='crash')process.exit(2);
 if(req.text==='wrong-path'){emit({type:'RESULT',id:req.id,status:'SUCCEEDED',relative_path:'wrong.wav'});continue;}
 const file=path.join(root,req.relative_path);await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(file,mockSpeechWav(req.text));
 emit({type:'RESULT',id:req.id,status:'SUCCEEDED',relative_path:req.relative_path,generation_ms:1,
   delivery:req.delivery||null,reference_id:req.delivery?'qualified-fixture-'+req.delivery:null});
}
