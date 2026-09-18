function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store');
}
function body(req){
  if(!req.body)return{};
  if(typeof req.body==='object'&&!Buffer.isBuffer(req.body))return req.body;
  const raw=Buffer.isBuffer(req.body)?req.body.toString('utf8'):String(req.body);
  try{return String(req.headers['content-type']||'').includes('json')?JSON.parse(raw||'{}'):Object.fromEntries(new URLSearchParams(raw));}catch{return{}}
}
function jsonText(t){
  if(!t)return null; const s=String(t).replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/,'').trim();
  try{return JSON.parse(s)}catch{} const m=s.match(/\{[\s\S]*\}/); try{return m?JSON.parse(m[0]):null}catch{return null}
}
function gemText(d){return(d?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||'').join('').trim()}
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
function money(v){return Math.max(0,Math.round(n(v)))}
async function search(key,q){
  const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({query:q,topic:'general',search_depth:'basic',max_results:8,include_answer:false,include_raw_content:false})});
  const raw=await r.text(); let d; try{d=JSON.parse(raw)}catch{d=null}
  if(!r.ok)throw new Error(`Tavily: ${d?.detail||d?.error||raw.slice(0,300)||r.status}`);
  return Array.isArray(d?.results)?d.results:[];
}
module.exports=async function handler(req,res){
  cors(res); if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method==='GET')return res.status(200).json({ok:true,service:'MOBIWAY REPAIR Research API',route:'/api/repair',searchProvider:'Tavily',aiProvider:'Google Gemini',model:'gemini-3.6-flash'});
  if(req.method!=='POST')return res.status(405).json({error:'Método não permitido.'});
  const b=body(req), make=String(b.make||'').trim(), model=String(b.model||'').trim(), request=String(b.request||b.customerRequest||'').trim();
  const vehicle={make,model,year:String(b.year||'').trim(),engine:String(b.engine||'').trim(),fuel:String(b.fuel||'').trim(),transmission:String(b.transmission||'').trim(),mileage:String(b.mileage||'').trim()};
  const notes=String(b.workshopNotes||'').trim();
  if(!make||!model||!request)return res.status(400).json({error:'Marca, modelo e intervenção/sintoma são obrigatórios.'});
  const tk=process.env.TAVILY_API_KEY,gk=process.env.GEMINI_API_KEY;
  if(!tk||!gk)return res.status(500).json({error:'Configure TAVILY_API_KEY e GEMINI_API_KEY no Vercel.'});
  const base=[make,model,vehicle.engine,vehicle.year].filter(Boolean).join(' ');
  let rows=[];
  try{
    const [a,p]=await Promise.all([search(tk,`${base} ${request} procedimento reparação tempo mão de obra horas`),search(tk,`${base} ${request} peças kit preço custo oficina Portugal`)]);
    const m=new Map(); for(const x of [...a,...p])if(x?.url&&!m.has(x.url))m.set(x.url,x); rows=[...m.values()].slice(0,14);
  }catch(e){return res.status(502).json({error:e?.message||'Falha na pesquisa.'})}
  if(!rows.length)return res.status(502).json({error:'Não foram encontradas fontes suficientes.'});
  const sources=rows.map((r,i)=>({id:i+1,title:String(r.title||''),url:String(r.url||''),content:String(r.content||'').slice(0,1600)}));
  const prompt=`És um assistente técnico de receção de oficina automóvel em Portugal. Não substituis o diagnóstico do mecânico. Usa APENAS as fontes fornecidas e não inventes dados, tempos, preços, motores, peças ou URLs. Se a versão/motor não for segura, exige confirmação por VIN/diagnóstico.

VIATURA:
${JSON.stringify(vehicle,null,2)}
PEDIDO/SINTOMA:
${request}
OBSERVAÇÕES:
${notes||'(nenhuma)'}
FONTES:
${JSON.stringify(sources,null,2)}

Produz referência para orçamento preliminar: intervenção provável; horas de mão de obra; peças normalmente necessárias e preços de retalho de referência COM IVA; consumíveis; faixa final típica de oficina independente em Portugal COM IVA quando suportada; riscos e pontos a confirmar. Um sintoma nunca confirma sozinho uma avaria. Se não houver suporte, usa 0 e baixa confidence.
Responde APENAS JSON válido:
{"vehicleSummary":"","likelyEngine":"","engineConfidence":0,"repairTitle":"","summary":"","technicalAssessment":"","laborHours":{"low":0,"high":0,"recommended":0},"parts":[{"description":"","qty":1,"lowGross":0,"highGross":0,"recommendedGross":0}],"consumablesGross":0,"marketWorkshopPriceGross":{"low":0,"high":0},"procedureSteps":[],"risks":[],"confirmations":[],"confidence":0}`;
  let gr;
  try{gr=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':gk},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:.1,maxOutputTokens:5000,responseMimeType:'application/json'}})})}catch(e){return res.status(502).json({error:`Gemini: ${e?.message||'falha de ligação'}`})}
  const raw=await gr.text(); let gd; try{gd=JSON.parse(raw)}catch{gd=null}
  if(!gr.ok)return res.status(502).json({error:`Gemini: ${gd?.error?.message||raw.slice(0,300)||gr.status}`});
  const r=jsonText(gemText(gd)); if(!r?.repairTitle)return res.status(502).json({error:'A análise técnica não devolveu um resultado válido.'});
  const lo=Math.max(0,n(r?.laborHours?.low)), hi=Math.max(lo,n(r?.laborHours?.high,lo)); let rec=Math.max(lo,n(r?.laborHours?.recommended)); if(hi>0)rec=Math.min(rec,hi);
  const parts=Array.isArray(r.parts)?r.parts.slice(0,14).map(x=>{const l=money(x.lowGross),h=Math.max(l,money(x.highGross));let z=money(x.recommendedGross);z=Math.max(l,z);if(h>0)z=Math.min(h,z);return{description:String(x.description||'').slice(0,180),qty:Math.max(1,Math.round(n(x.qty,1))),lowGross:l,highGross:h,recommendedGross:z}}).filter(x=>x.description):[];
  return res.status(200).json({vehicleSummary:String(r.vehicleSummary||[make,model,vehicle.year].filter(Boolean).join(' ')),likelyEngine:String(r.likelyEngine||vehicle.engine||''),engineConfidence:Math.max(0,Math.min(100,Math.round(n(r.engineConfidence)))),repairTitle:String(r.repairTitle),summary:String(r.summary||''),technicalAssessment:String(r.technicalAssessment||''),laborHours:{low:lo,high:hi,recommended:rec},parts,consumablesGross:money(r.consumablesGross),marketWorkshopPriceGross:{low:money(r?.marketWorkshopPriceGross?.low),high:money(r?.marketWorkshopPriceGross?.high)},procedureSteps:Array.isArray(r.procedureSteps)?r.procedureSteps.slice(0,8).map(String):[],risks:Array.isArray(r.risks)?r.risks.slice(0,10).map(String):[],confirmations:Array.isArray(r.confirmations)?r.confirmations.slice(0,10).map(String):[],confidence:Math.max(0,Math.min(100,Math.round(n(r.confidence)))),sources:rows.filter(x=>x?.url).slice(0,12).map(x=>({title:String(x.title||x.url).slice(0,220),url:String(x.url)})),searchProvider:'Tavily',aiProvider:'Google Gemini',model:'gemini-3.6-flash',researchedAt:new Date().toISOString(),currency:'EUR',priceBasis:'gross-reference'});
};
