/** Offline OBS alert skin preview. No Unity, providers, OBS, credentials,
 * paid events, or public listeners. Uses the actual production HTML/CSS.
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const htmlUrl=new URL('../src/remote-web/stage.html',import.meta.url);
const cssUrl=new URL('../src/remote-web/stage.css',import.meta.url);

function previewMarkup(html){
  const script=[
    '<script>',
    "const hotmic=location.pathname==='/hotmic';",
    "const previewParams=new URLSearchParams(location.search);",
    "if(previewParams.get('backdrop')==='1')document.body.classList.add('preview-backdrop');",
    "if(previewParams.get('motion')==='demo')document.body.classList.add('preview-motion-demo');",
    "const set=(id,value)=>{document.getElementById(id).textContent=value};",
    "const root=document.getElementById('stank-popup');",
    "root.hidden=false;root.dataset.kind=hotmic?'hotmic':'donation';",
    "document.getElementById('stage').style.display='none';",
    "const stage=document.querySelector('.stage-well');",
    "const place=document.createElement('div');",
    "place.className='demo-scene';",
    "place.textContent='LIVE STANK TANK  ·  UNITY CAMERA AREA';",
    "stage.insertBefore(place,stage.firstChild);",
    "set('alert-label',hotmic?'LIVE RESPONSE':'DONATION ALERT');",
    "set('donor-name',hotmic?'':'STANK SUPPORTER');",
    "set('donation-amount',hotmic?'':'$25.00 USD');",
    "set('donation-message',hotmic?'':'Y’all are killing me. Tell Rev to quit swiping the cash!');",
    "if(hotmic){",
    "  const subtitles=document.getElementById('actor-caption');",
    "  subtitles.dataset.actor='SHANNY';subtitles.hidden=false;",
    "  set('subtitle-actor','Shanny');",
    "  set('subtitle-words','I have something to say about THAT!');",
    "}",
    "const moving=getComputedStyle(document.querySelector('.mucus-strand--a')).animationName!=='none';",
    "const note=document.createElement('aside');note.className='preview-motion-status';",
    "note.textContent=moving?(previewParams.get('motion')==='demo'?'MUCUS: MOVING · DEMO SPEED':'MUCUS: MOVING · NATURAL SPEED'):'MUCUS: OFF · REDUCED MOTION';",
    "const tip=document.createElement('p');tip.textContent=moving?'Watch the lower rail for sliding reflections and stretching beads.':'Browser/Windows Reduced Motion is currently enabled.';",
    "note.append(tip);",
    "const demo=document.createElement('a');demo.href=location.pathname+'?backdrop=1&motion=demo';demo.textContent='Show motion demo ↗';",
    "note.append(demo);document.body.append(note);",
    '</script>'
  ].join('\n');
  const demoStyle=[
    '<style>',
    '.preview-backdrop{background:radial-gradient(circle at 80% 35%,#263a2c,#0a1517 59%,#070c10) !important;}',
    '.preview-backdrop::before{content:"PREVIEW BACKDROP · NOT A LIVE STREAM";position:absolute;right:70px;top:60px;color:#76837c;font:700 14px Arial;letter-spacing:.16em;}',
    '.preview-motion-status{position:absolute;top:94px;left:855px;max-width:470px;',
    'padding:16px 18px;color:#c8f9a7;background:rgba(5,16,9,.94);',
    'border:1px solid #335d23;border-radius:9px;font:700 17px Arial;letter-spacing:.045em;}',
    '.preview-motion-status p{margin:12px 0;color:#cdd7c4;font:400 14px/1.5 Arial;letter-spacing:0;}',
    '.preview-motion-status a{color:#9ff256;font:700 14px Arial;text-decoration:underline;}',
    '.demo-scene{position:absolute;inset:0;display:grid;place-items:center;',
    ' text-align:center;padding:15px;',
    ' background:radial-gradient(ellipse at 50% 44%,#30442c,#121e17 60%,#070f0a);',
    ' font:800 19px/1.4 Arial,sans-serif;letter-spacing:.12em;color:#aab79c}',
    '</style>'
  ].join('');
  return html.replace('<script type="module" src="/stage-page.js"></script>','')
    .replace('</head>',demoStyle+'</head>').replace('</body>',script+'</body>');
}
export async function startPreview({port=0}={}){
  const [html,css]=await Promise.all([readFile(htmlUrl,'utf8'),readFile(cssUrl,'utf8')]);
  const server=createServer((req,res)=>{
    const pathname=new URL(req.url||'/', 'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(pathname==='/stage.css'){
      res.writeHead(200,{'Content-Type':'text/css; charset=utf-8'});res.end(css);return;
    }
    if(['/','/donation','/hotmic'].includes(pathname)){
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
  const selectedPort=Number(process.env.STANK_PREVIEW_PORT||18781);
  if(!Number.isInteger(selectedPort)||selectedPort<1024||selectedPort>65535)
    throw new Error('STANK_PREVIEW_PORT must be a local TCP port from 1024 to 65535');
  const preview=await startPreview({port:selectedPort});
  process.stdout.write('VARIANT_A_PREVIEW '+preview.url+'/donation\n');
  process.stdout.write('HOTMIC_PREVIEW '+preview.url+'/hotmic\n');
  process.stdout.write('STREAM_BACKDROP_PREVIEW '+preview.url+'/donation?backdrop=1\n');
  process.stdout.write('VISIBLE_MOTION_DEMO '+preview.url+'/donation?backdrop=1&motion=demo\n');
  process.stdout.write('Visual sample only: no Unity, payment account, OBS or audio.\n');
  process.on('SIGINT',()=>void preview.close());
  process.on('SIGTERM',()=>void preview.close());
}
