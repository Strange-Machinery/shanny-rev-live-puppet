/** Loopback-only OBS art inspection. No Unity, paid events, TTS or OBS.
 * Uses the SAME painted WebP and message scroller as production.
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const remote=name=>new URL('../src/remote-web/'+name,import.meta.url);
const artNames=['popup-art.webp','popup-hotmic.webp','popup-art-still.webp','popup-hotmic-still.webp'];

function previewMarkup(html){
  const style=[
    '<style>',
    '.preview-backdrop{background:radial-gradient(circle at 80% 35%,#263a2c,#0a1517 59%,#070c10)!important}',
    '.preview-backdrop::before{content:"PREVIEW BACKDROP · NOT A LIVE STREAM";position:absolute;right:60px;top:48px;color:#798d78;font:700 12px Arial;letter-spacing:.14em}',
    '.demo-scene{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:20px;background:radial-gradient(ellipse at 50% 44%,#334833,#111a14 65%,#090e0a);font:800 16px/1.3 Arial;letter-spacing:.12em;color:#b5c6a8}',
    '.preview-art-status{position:absolute;left:845px;top:120px;max-width:440px;padding:12px 14px;border:1px solid #578d3a;border-radius:8px;color:#d5ff9a;background:#0a160bea;font:700 14px/1.5 Arial;letter-spacing:.05em}',
    '</style>'
  ].join('');
  return html.replace('<script type="module" src="/stage-page.js"></script>',
    '<script type="module" src="/preview-page.js"></script>')
    .replace('</head>',style+'</head>');
}
export async function startPreview({port=0}={}){
  const [html,css,previewScript,scrollerScript]=await Promise.all([
    readFile(remote('stage.html'),'utf8'),
    readFile(remote('stage.css'),'utf8'),
    readFile(remote('preview-page.js'),'utf8'),
    readFile(remote('message-scroll.js'),'utf8')
  ]);
  const assets=new Map([
    ['/stage.css',{body:css,type:'text/css; charset=utf-8'}],
    ['/preview-page.js',{body:previewScript,type:'text/javascript; charset=utf-8'}],
    ['/message-scroll.js',{body:scrollerScript,type:'text/javascript; charset=utf-8'}]
  ]);
  // The art is optional at checkout time. A missing approved bundle reports
  // an explicit fallback rather than faking the artwork's presence.
  for(const name of artNames){
    try{assets.set('/'+name,{body:await readFile(remote(name)),type:'image/webp'});}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const server=createServer((req,res)=>{
    const path=new URL(req.url||'/', 'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(assets.has(path)){
      const entry=assets.get(path);
      res.writeHead(200,{'Content-Type':entry.type});res.end(entry.body);return;
    }
    if(['/','/donation','/hotmic','/celebration'].includes(path)){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end(previewMarkup(html));return;
    }
    res.writeHead(404);res.end();
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
  return {url:'http://127.0.0.1:'+server.address().port,
    close:()=>new Promise(ok=>server.close(ok))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.STANK_PREVIEW_PORT||18781);
  if(!Number.isInteger(port)||port<1024||port>65535)
    throw new Error('STANK_PREVIEW_PORT must be a local port from 1024 to 65535');
  const preview=await startPreview({port});
  process.stdout.write('PAINTED_DONATION '+preview.url+'/donation?backdrop=1\n');
  process.stdout.write('LONG_DONATION '+preview.url+'/donation?backdrop=1&long=1\n');
  process.stdout.write('HOTMIC '+preview.url+'/hotmic?backdrop=1\n');
  process.stdout.write('MEMBERSHIP_BOMB '+preview.url+'/celebration?backdrop=1\n');
  process.stdout.write('Local art review only. No Unity, provider, account, OBS or TTS.\n');
  process.on('SIGINT',()=>void preview.close());
  process.on('SIGTERM',()=>void preview.close());
}
