import { openDb, q, closeDb } from './src/core/store/db.js';
openDb({ connectionString: process.env.DATABASE_URL!, password: process.env.DATABASE_PASSWORD, max: 2 });
const TZ='America/Argentina/Tucuman';
const day=(d:string)=>new Date(d).toLocaleDateString('en-CA',{timeZone:TZ});
const msgs = await q<any>(`select id, conversation_id, direction, author, content_kind, text, created_at
  from messages where created_at >= now() - interval '16 days' order by conversation_id, created_at`);
const orders = await q<any>(`select id, number, conversation_id, items, total, paid, status, created_by, created_at, paid_at
  from orders where created_at >= now() - interval '20 days' order by created_at`);
const prods = await q<any>(`select id, name, category from products`);
const catById=new Map(prods.map((p:any)=>[p.id,String(p.category||'').toLowerCase().trim()]));
const byConv=new Map<string,any[]>(); for(const m of msgs){const a=byConv.get(m.conversation_id)??[];a.push(m);byConv.set(m.conversation_id,a);}
const ordByConv=new Map<string,any[]>(); for(const o of orders){const a=ordByConv.get(o.conversation_id)??[];a.push(o);ordByConv.set(o.conversation_id,a);}
const ALIAS=['miskapedidos','miskamuskacursos'];
const DEDUPE=30*60*1000;
const eps:any[]=[];
for(const [conv,list] of byConv){
  const os=ordByConv.get(conv)??[]; let ultimo=-Infinity;
  for(let i=0;i<list.length;i++){
    const m=list[i];
    if(!(m.direction==='in'&&(m.content_kind==='image'||m.content_kind==='document'))) continue;
    const T=Date.parse(m.created_at);
    const prev=list.slice(Math.max(0,i-30),i);
    if(!prev.some(p=>p.direction==='out'&&ALIAS.some(a=>String(p.text||'').toLowerCase().includes(a)))) continue;
    const vig=(o:any)=>Date.parse(o.created_at)<T && (!(o.status==='entregado'||o.status==='cancelado')||day(o.created_at)===day(m.created_at));
    if(os.some(o=>vig(o)&&o.status!=='cancelado')) continue;
    if(T-ultimo<DEDUPE) continue;
    ultimo=T;
    const post=os.filter(o=>Date.parse(o.created_at)>=T).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
    const lo=post[0]??null;
    const humanoAntes=prev.slice(-12).some(p=>p.direction==='out'&&p.author==='human');
    // proximo saliente humano despues del comprobante
    const sig=list.slice(i+1);
    const humOut=sig.find(p=>p.direction==='out'&&p.author==='human');
    const botOut=sig.find(p=>p.direction==='out'&&p.author==='bot');
    eps.push({conv,T,day:day(m.created_at),lo,humanoAntes,
      minHum:humOut?Math.round((Date.parse(humOut.created_at)-T)/60000):null,
      segBot:botOut?Math.round((Date.parse(botOut.created_at)-T)/1000):null,
      torta: lo? (lo.items||[]).some((it:any)=>catById.get(it.productId||it.product_id)==='tortas') : false,
    });
  }
}
const dias=[...new Set(eps.map(e=>e.day))].sort();
console.log('dias',dias.length,'DISPAROS',eps.length,'=>',(eps.length/dias.length).toFixed(1),'/dia');
const u7=dias.slice(-7); const e7=eps.filter(e=>u7.includes(e.day));
console.log('ultimos 7 dias',u7.join(','),'disparos',e7.length,'=>',(e7.length/7).toFixed(1),'/dia');
console.log('con pedido posterior:',eps.filter(e=>e.lo).length,' bot:',eps.filter(e=>e.lo?.created_by==='bot').length,' humano:',eps.filter(e=>e.lo&&e.lo.created_by!=='bot').length,' ninguno:',eps.filter(e=>!e.lo).length);
console.log('TORTA en el pedido posterior:',eps.filter(e=>e.torta).length,'=>',(eps.filter(e=>e.torta).length/dias.length).toFixed(1),'/dia');
console.log('una persona escribiendo antes del comprobante:',eps.filter(e=>e.humanoAntes).length);
const bs=eps.filter(e=>e.segBot!=null).map(e=>e.segBot).sort((a,b)=>a-b);
console.log('segundos hasta la respuesta del bot HOY: mediana',bs[Math.floor(bs.length/2)],'p90',bs[Math.floor(bs.length*0.9)],'n',bs.length);
const hs=eps.filter(e=>e.minHum!=null).map(e=>e.minHum).sort((a,b)=>a-b);
console.log('minutos hasta que escribe UNA PERSONA: mediana',hs[Math.floor(hs.length/2)],'p90',hs[Math.floor(hs.length*0.9)],'n',hs.length,'de',eps.length,'(nunca escribe nadie en',eps.length-hs.length,')');
// torta: cuanto tarda una persona
const th=eps.filter(e=>e.torta).map(e=>e.minHum).filter(x=>x!=null).sort((a:any,b:any)=>a-b);
console.log('TORTA -> minutos hasta que escribe una persona: mediana',th[Math.floor(th.length/2)],'p90',th[Math.floor(th.length*0.9)],'n',th.length,'de',eps.filter(e=>e.torta).length);
await closeDb();
