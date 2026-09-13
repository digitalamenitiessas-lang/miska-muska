import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });

const TZ='America/Argentina/Tucuman';
const day=(d:string)=>new Date(d).toLocaleDateString('en-CA',{timeZone:TZ});
const hour=(d:string)=>Number(new Date(d).toLocaleString('en-GB',{timeZone:TZ,hour:'2-digit',hour12:false}));

const msgs = await q<any>(`select id, conversation_id, direction, author, content_kind, text, created_at
  from messages where created_at >= now() - interval '16 days' order by conversation_id, created_at`);
const orders = await q<any>(`select id, number, conversation_id, items, total, paid, status, created_by, created_at, paid_at, delivery_mode
  from orders where created_at >= now() - interval '20 days' order by created_at`);
const prods = await q<any>(`select id, name, category from products`);
const catById = new Map(prods.map((p:any)=>[p.id, String(p.category||'').toLowerCase()]));
const tortaNames = new Set(prods.filter((p:any)=>/torta/i.test(p.category)).map((p:any)=>String(p.name).toLowerCase()));

const byConv = new Map<string, any[]>();
for (const m of msgs) { (byConv.get(m.conversation_id) ?? byConv.set(m.conversation_id, []).get(m.conversation_id)!).push(m); }
const ordByConv = new Map<string, any[]>();
for (const o of orders) { (ordByConv.get(o.conversation_id) ?? ordByConv.set(o.conversation_id, []).get(o.conversation_id)!).push(o); }

const ALIAS=['miskapedidos','miskamuskacursos'];
const esComprobante=(m:any)=>m.direction==='in'&&(m.content_kind==='image'||m.content_kind==='document');

type Ep={conv:string;t:string;day:string;hour:number;convHadTortaText:boolean;laterOrder:any|null;laterOrderBy:string|null;minsToOrder:number|null};
const eps:Ep[]=[];
let adjuntosTotal=0, adjSinAlias=0, conPedidoSinCobrar=0;

for (const [conv, list] of byConv) {
  const os = ordByConv.get(conv) ?? [];
  for (let i=0;i<list.length;i++){
    const m=list[i];
    if(!esComprobante(m)) continue;
    adjuntosTotal++;
    const T=Date.parse(m.created_at);
    const prev=list.slice(Math.max(0,i-30), i);
    const alias=prev.some(p=>p.direction==='out'&&ALIAS.some(a=>String(p.text||'').toLowerCase().includes(a)));
    if(!alias){adjSinAlias++;continue;}
    // pedidoSinCobrar al momento T
    const vigenteEn=(o:any)=>{
      if(Date.parse(o.created_at)>=T) return false;
      const cerrado = o.status==='entregado'||o.status==='cancelado';
      const mismoDia = day(o.created_at)===day(m.created_at);
      return !cerrado || mismoDia;
    };
    const sinCobrar=os.find(o=>vigenteEn(o)&&o.status!=='cancelado'&&Number(o.total)>0&&(o.paid_at==null||Date.parse(o.paid_at)>T));
    if(sinCobrar){conPedidoSinCobrar++;continue;}
    // tambien la recomprobacion del rescate: cualquier pedido vigente no cancelado
    const cualquiera=os.find(o=>vigenteEn(o)&&o.status!=='cancelado');
    if(cualquiera){conPedidoSinCobrar++;continue;}
    const textoConv=prev.map(p=>String(p.text||'').toLowerCase()).join(' \n ');
    const convHadTortaText=/\btorta|\btortas\b/.test(textoConv)||[...tortaNames].some(n=>n.length>6&&textoConv.includes(n));
    const posteriores=os.filter(o=>Date.parse(o.created_at)>=T).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
    const lo=posteriores[0]??null;
    eps.push({conv,t:m.created_at,day:day(m.created_at),hour:hour(m.created_at),convHadTortaText,
      laterOrder:lo,laterOrderBy:lo?lo.created_by:null,
      minsToOrder:lo?Math.round((Date.parse(lo.created_at)-T)/60000):null});
  }
}
const dias=new Set(eps.map(e=>e.day));
console.log('ventana dias con episodios:',[...dias].sort().join(','));
console.log('adjuntos entrantes totales:',adjuntosTotal,' sin alias previo:',adjSinAlias,' con pedido/inscripcion en la charla:',conPedidoSinCobrar);
console.log('DISPAROS del rescate:',eps.length);
const porDia:Record<string,number>={};
for(const e of eps) porDia[e.day]=(porDia[e.day]??0)+1;
console.log('por dia:',JSON.stringify(porDia));
console.log('con mencion de torta en la charla:',eps.filter(e=>e.convHadTortaText).length);
console.log('fuera de 08:00-21:30:',eps.filter(e=>e.hour<8||e.hour>=22 || (e.hour===21)).length, ' (h>=21 o <8)');
const conPedidoDespues=eps.filter(e=>e.laterOrder);
console.log('episodios donde DESPUES aparecio un pedido:',conPedidoDespues.length,
  ' por bot:',conPedidoDespues.filter(e=>e.laterOrderBy==='bot').length,
  ' por humano:',conPedidoDespues.filter(e=>e.laterOrderBy!=='bot').length);
console.log('NUNCA se cargo nada despues:',eps.length-conPedidoDespues.length);
const humanos=conPedidoDespues.filter(e=>e.laterOrderBy!=='bot').map(e=>e.minsToOrder!).sort((a,b)=>a-b);
console.log('minutos hasta la carga humana: mediana',humanos[Math.floor(humanos.length/2)],'p90',humanos[Math.floor(humanos.length*0.9)],'n',humanos.length);
const bots=conPedidoDespues.filter(e=>e.laterOrderBy==='bot').map(e=>e.minsToOrder!).sort((a,b)=>a-b);
console.log('minutos hasta la carga del bot: mediana',bots[Math.floor(bots.length/2)],'n',bots.length);
// pedidos posteriores que incluyen torta
const conTortaItem=conPedidoDespues.filter(e=>(e.laterOrder.items||[]).some((it:any)=>catById.get(it.productId||it.product_id)==='tortas'||/torta/i.test(String(it.description||''))));
console.log('de esos pedidos posteriores, con item torta:',conTortaItem.length);
await closeDb();
