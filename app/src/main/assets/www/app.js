(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const app = $('#app');
  const fmt = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const num = v => Number(String(v ?? '').replace(',', '.')) || 0;
  const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
  const median = a => { const x=a.filter(Number.isFinite).sort((a,b)=>a-b); if(!x.length)return 0; const m=Math.floor(x.length/2); return x.length%2?x[m]:(x[m-1]+x[m])/2; };
  const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  const DEFAULTS = {
    targetProfitPct: 16,
    targetProfitMin: 1500,
    minimumProfit: 1000,
    negotiationBufferPct: 5,
    warrantyReserve: 650,
    stockMonthly: 180,
    expectedStockDays: 45,
    adminCost: 180,
    defaultService: 250,
    defaultDetailing: 120,
    unknownHistoryRisk: 450,
    automaticGearboxRisk: 300,
    highKmRisk: 300,
    dieselRisk: 180
  };

  let settings = load('mobiway_settings', DEFAULTS);
  let evaluations = load('mobiway_evaluations', []);
  let state = { view:'home', step:1, draft:null, editingId:null };

  function load(k, fallback){ try { const x=JSON.parse(localStorage.getItem(k)); return x ?? structuredClone(fallback); } catch { return structuredClone(fallback); } }
  function save(k,v){ localStorage.setItem(k,JSON.stringify(v)); }
  function toast(msg){ const old=$('.toast'); if(old)old.remove(); const e=document.createElement('div'); e.className='toast'; e.textContent=msg; document.body.appendChild(e); setTimeout(()=>e.remove(),2200); }

  function newDraft(){
    return {
      id:uid(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), status:'avaliacao',
      vehicle:{plate:'',vin:'',brand:'',model:'',version:'',year:new Date().getFullYear()-5,month:'',fuel:'Diesel',engine:'',power:'',gearbox:'Manual',km:'',origin:'Nacional',owners:'',askingPrice:'',notes:''},
      photos:[],
      condition:{body:'mid',interior:'mid',tyres:'mid',engine:'mid',gearbox:'mid',brakes:'mid',history:'unknown',warningLights:'none',keys:'2',accidents:'unknown',knownFaults:'',mechanicalCost:0,bodyCost:0,tyresCost:0,otherRepairCost:0},
      comps:[], marketOverride:'',
      finance:{service:settings.defaultService,detailing:settings.defaultDetailing,warranty:settings.warrantyReserve,admin:settings.adminCost,stockDays:settings.expectedStockDays,stockMonthly:settings.stockMonthly,other:0,customRisk:0},
      purchase:{decision:'',actualPurchasePrice:'',actualRepairCost:'',actualSalePrice:'',saleDate:'',warrantyActual:'',notes:''}
    };
  }

  function ensureDraft(){ if(!state.draft) state.draft=newDraft(); return state.draft; }

  function shell(content, tab='home'){
    return `<div class="shell">
      <header class="topbar">
        <div class="brand"><img src="mobiway_logo.png" alt="MOBIWAY"><div class="brandTitle"><strong>AVALIA</strong><span>decisão de compra</span></div></div>
        <button class="iconBtn" onclick="Mobiway.backHome()">MOBIWAY · INTERNO</button>
      </header>
      ${content}
    </div>${tabs(tab)}`;
  }
  function tabs(active){
    return `<nav class="tabs noPrint"><div class="inner">
      ${tabBtn('home','⌂','Início',active)}${tabBtn('history','◷','Histórico',active)}${tabBtn('analytics','◈','Resultados',active)}${tabBtn('settings','⚙','Definições',active)}
    </div></nav>`;
  }
  function tabBtn(view,icon,label,active){return `<button class="tab ${view===active?'active':''}" onclick="Mobiway.go('${view}')"><b>${icon}</b>${label}</button>`}

  function render(){
    if(state.view==='wizard') return renderWizard();
    if(state.view==='detail') return renderDetail();
    if(state.view==='history') return renderHistory();
    if(state.view==='settings') return renderSettings();
    if(state.view==='analytics') return renderAnalytics();
    renderHome();
  }

  function renderHome(){
    const completed=evaluations.filter(e=>e.result);
    const buys=evaluations.filter(e=>e.purchase?.decision==='bought');
    const avgMargin=completed.length?completed.reduce((s,e)=>s+(e.result?.targetProfit||0),0)/completed.length:0;
    const actualSold=buys.filter(e=>num(e.purchase.actualSalePrice)>0);
    const realized=actualSold.reduce((s,e)=>s+(num(e.purchase.actualSalePrice)-num(e.purchase.actualPurchasePrice)-num(e.purchase.actualRepairCost)-num(e.purchase.warrantyActual)),0);
    app.innerHTML=shell(`
      <section class="hero">
        <span class="eyebrow">● MOBIWAY intelligence</span>
        <h1>Comprar melhor.<br><em>Vender com margem.</em></h1>
        <p>Avaliação profissional de usados com fotografias, comparáveis de mercado, custos de preparação, risco de garantia e margem Mobiway — numa única decisão.</p>
        <div class="heroActions"><button class="primaryBtn" onclick="Mobiway.newEvaluation()">＋ NOVA AVALIAÇÃO</button><button class="ghostBtn" onclick="Mobiway.go('history')">VER HISTÓRICO</button><button class="ghostBtn" onclick="Mobiway.loadDemo()">CARREGAR DEMO</button></div>
      </section>
      <div class="grid">
        <div class="card"><span class="badge orange">AVALIAÇÕES</span><div class="metric">${evaluations.length}</div><p>registos guardados neste dispositivo</p></div>
        <div class="card"><span class="badge green">MARGEM ALVO</span><div class="metric">${fmt.format(avgMargin)}</div><p>média calculada nas avaliações</p></div>
        <div class="card"><span class="badge">RESULTADO REAL</span><div class="metric">${fmt.format(realized)}</div><p>lucro registado em viaturas já vendidas</p></div>
      </div>
      <div class="sectionHead"><div><h2>Avaliações recentes</h2><p>Continua ou consulta decisões anteriores.</p></div></div>
      ${recentList()}
    `,'home');
  }

  function recentList(){
    if(!evaluations.length) return `<div class="empty">Ainda não existem avaliações. Cria a primeira e testa o motor de decisão.</div>`;
    return `<div class="list">${[...evaluations].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,5).map(e=>{
      const r=e.result||calculate(e); const name=[e.vehicle.brand,e.vehicle.model,e.vehicle.version].filter(Boolean).join(' ')||'Viatura sem identificação';
      return `<div class="rowCard" onclick="Mobiway.openDetail('${e.id}')"><div class="main"><strong>${esc(name)}</strong><small>${esc(e.vehicle.year)} · ${Number(e.vehicle.km||0).toLocaleString('pt-PT')} km · ${statusText(e)}</small></div><div><div class="money">${fmt.format(r.recommendedBuy)}</div><small>compra aconselhada</small></div></div>`;
    }).join('')}</div>`;
  }

  function statusText(e){
    if(e.purchase?.decision==='bought') return 'Comprado';
    if(e.purchase?.decision==='passed') return 'Não comprado';
    return 'Avaliado';
  }

  function renderWizard(){
    const d=ensureDraft(); const s=state.step;
    const titles={1:['Identificação','Começa pelos dados essenciais da viatura.'],2:['Fotografias','Regista o estado visual com uma sequência consistente.'],3:['Estado e risco','Transforma observações em custos e risco financeiro.'],4:['Mercado','Compara anúncios equivalentes e elimina valores fora do padrão.'],5:['Custos e margem','Configura preparação, garantia, stock e margem.'],6:['Resultado','Decisão calculada para esta viatura.']};
    app.innerHTML=`<div class="shell wizard">
      <header class="topbar"><div class="brand"><img src="mobiway_logo.png" alt="MOBIWAY"><div class="brandTitle"><strong>AVALIA</strong><span>nova avaliação</span></div></div><button class="iconBtn" onclick="Mobiway.cancelWizard()">×</button></header>
      <div class="progress">${[1,2,3,4,5,6].map(i=>`<i class="${i<=s?'on':''}"></i>`).join('')}</div>
      <span class="stepLabel">Passo ${s} de 6</span><h1>${titles[s][0]}</h1><p class="intro">${titles[s][1]}</p>
      ${stepHtml(s,d)}
    </div>${wizardNav(s)}`;
    bindWizardInputs();
  }

  function wizardNav(s){return `<div class="wizardNav noPrint"><div class="inner"><button class="ghostBtn" onclick="Mobiway.prevStep()">${s===1?'Cancelar':'← Anterior'}</button><button class="primaryBtn" onclick="Mobiway.nextStep()">${s===6?'GUARDAR AVALIAÇÃO':'Continuar →'}</button></div></div>`}

  function stepHtml(s,d){
    if(s===1) return stepVehicle(d);
    if(s===2) return stepPhotos(d);
    if(s===3) return stepCondition(d);
    if(s===4) return stepMarket(d);
    if(s===5) return stepFinance(d);
    return stepResult(d);
  }

  function field(label,key,value,type='text',extra=''){return `<div class="field ${extra}"><label>${label}</label><input data-path="${key}" type="${type}" value="${esc(value)}"></div>`}
  function sel(label,key,value,opts){return `<div class="field"><label>${label}</label><select data-path="${key}">${opts.map(o=>`<option ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select></div>`}
  function euroField(label,key,value,extra=''){return `<div class="field ${extra}"><label>${label}</label><div class="suffix"><input data-path="${key}" type="number" inputmode="decimal" value="${esc(value)}"><span>€</span></div></div>`}

  function stepVehicle(d){ const v=d.vehicle; return `<div class="panel"><div class="formGrid">
    ${field('Matrícula','vehicle.plate',v.plate)}${field('VIN / Chassis','vehicle.vin',v.vin)}
    ${field('Marca *','vehicle.brand',v.brand)}${field('Modelo *','vehicle.model',v.model)}
    ${field('Versão / nível de equipamento','vehicle.version',v.version)}${field('Ano *','vehicle.year',v.year,'number')}
    ${sel('Combustível','vehicle.fuel',v.fuel,['Diesel','Gasolina','Híbrido','Híbrido Plug-in','Elétrico','GPL'])}${sel('Caixa','vehicle.gearbox',v.gearbox,['Manual','Automática','Automática DCT/DSG','CVT'])}
    ${field('Motor / cilindrada','vehicle.engine',v.engine)}${field('Potência (cv)','vehicle.power',v.power,'number')}
    ${field('Quilómetros *','vehicle.km',v.km,'number')}${sel('Origem','vehicle.origin',v.origin,['Nacional','Importado','Desconhecido'])}
    ${field('N.º proprietários','vehicle.owners',v.owners,'number')}${euroField('Preço pedido pelo vendedor','vehicle.askingPrice',v.askingPrice)}
    <div class="field full"><label>Notas / equipamento relevante</label><textarea data-path="vehicle.notes">${esc(v.notes)}</textarea></div>
  </div></div>`}

  const photoLabels=['Frente ¾','Traseira ¾','Lateral esquerda','Lateral direita','Interior','Quadrante / km','Motor','Mala','Danos / detalhes'];
  function stepPhotos(d){return `<div class="panel"><div class="panelTitle"><div><h3>Inspeção fotográfica</h3><div class="hint">Ideal: 8–12 fotografias, boa luz e todos os danos visíveis.</div></div><span class="badge orange">${d.photos.length} fotos</span></div>
    <div class="photoGrid">${d.photos.map((p,i)=>`<div class="photoSlot"><img src="${p.data}" alt="foto"><button onclick="Mobiway.removePhoto(${i})">×</button></div>`).join('')}
      <button class="photoAdd" onclick="Mobiway.takePhoto()"><b>＋</b>Tirar fotografia</button><button class="photoAdd" onclick="Mobiway.pickPhotos()"><b>▧</b>Galeria</button>
    </div></div><div class="panel"><h3>Sequência recomendada</h3><p class="hint">${photoLabels.join(' · ')}</p><p class="hint" style="margin-top:10px">Na versão com análise visual online, estas imagens poderão alimentar deteção de danos, desgaste e leitura assistida de quilometragem. Nesta versão são anexadas ao processo e entram na revisão humana.</p></div>`}

  function stepCondition(d){const c=d.condition;return `<div class="panel"><div class="panelTitle"><div><h3>Estado observado</h3><div class="hint">Bom = sem intervenção relevante · Médio = desgaste normal/preparação · Mau = reparação provável.</div></div></div>
    ${rating('Carroçaria / pintura','condition.body',c.body,'riscos, mossas, pintura')}
    ${rating('Interior','condition.interior',c.interior,'bancos, plásticos, forros')}
    ${rating('Pneus / jantes','condition.tyres',c.tyres,'desgaste e danos')}
    ${rating('Motor','condition.engine',c.engine,'ruído, fugas, fumo, funcionamento')}
    ${rating('Caixa / embraiagem','condition.gearbox',c.gearbox,'engrenamento e anomalias')}
    ${rating('Travões / suspensão','condition.brakes',c.brakes,'ruídos, folgas, discos/pastilhas')}
  </div><div class="panel"><div class="formGrid">
    ${sel('Histórico de manutenção','condition.history',c.history,['complete','partial','unknown'].map(x=>x))}
    ${sel('Luzes de avaria','condition.warningLights',c.warningLights,['none','minor','major'])}
    ${sel('Acidentes conhecidos','condition.accidents',c.accidents,['no','yes','unknown'])}
    ${sel('Chaves','condition.keys',String(c.keys),['2','1','0'])}
    ${euroField('Mecânica estimada','condition.mechanicalCost',c.mechanicalCost)}${euroField('Chapa / pintura','condition.bodyCost',c.bodyCost)}
    ${euroField('Pneus / jantes','condition.tyresCost',c.tyresCost)}${euroField('Outras reparações','condition.otherRepairCost',c.otherRepairCost)}
    <div class="field full"><label>Avarias / observações conhecidas</label><textarea data-path="condition.knownFaults">${esc(c.knownFaults)}</textarea></div>
  </div></div>`}

  function rating(label,path,value,sub){return `<div class="rangeRow"><div><strong>${label}</strong><small>${sub}</small></div><div class="ratingBtns">${[['good','Bom'],['mid','Médio'],['bad','Mau']].map(([v,l])=>`<button class="${value===v?`sel ${v}`:''}" onclick="Mobiway.setRating('${path}','${v}')">${l}</button>`).join('')}</div></div>`}

  function stepMarket(d){ const r=marketStats(d); return `<div class="panel"><div class="panelTitle"><div><h3>Comparáveis portugueses</h3><div class="hint">Introduz anúncios realmente comparáveis: mesma geração, motor, caixa e equipamento semelhante.</div></div><button class="ghostBtn" onclick="Mobiway.addComp()">＋ Adicionar</button></div>
    ${d.comps.length?`<div style="overflow:auto"><table class="compTable"><thead><tr><th>Fonte</th><th>Ano</th><th>Km</th><th>Preço</th><th></th></tr></thead><tbody>${d.comps.map((c,i)=>`<tr><td><input data-comp="${i}.source" value="${esc(c.source||'')}"></td><td><input data-comp="${i}.year" type="number" value="${esc(c.year||'')}"></td><td><input data-comp="${i}.km" type="number" value="${esc(c.km||'')}"></td><td><input data-comp="${i}.price" type="number" value="${esc(c.price||'')}"></td><td><button onclick="Mobiway.removeComp(${i})">×</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">Ainda sem comparáveis. Adiciona pelo menos 3 anúncios para uma avaliação mais robusta.</div>`}
  </div>
  <div class="grid"><div class="card"><span class="badge">MEDIANA</span><div class="metric">${fmt.format(r.median)}</div><p>${r.count} comparáveis válidos</p></div><div class="card"><span class="badge orange">AJUSTADO</span><div class="metric">${fmt.format(r.adjusted)}</div><p>ponderação por ano e quilometragem</p></div><div class="card"><span class="badge ${r.confidence>=75?'green':'orange'}">CONFIANÇA</span><div class="metric">${r.confidence}%</div><p>qualidade da amostra</p></div></div>
  <div class="panel" style="margin-top:14px"><div class="formGrid">${euroField('Valor de mercado manual (opcional)','marketOverride',d.marketOverride,'full')}</div><p class="hint" style="margin-top:10px">Se preenchido, substitui a estimativa estatística. Útil quando tens informação comercial mais forte do que a amostra de anúncios.</p></div>
  <div class="callout"><strong>Pesquisa externa</strong><div class="big">Mercado português</div><p>Usa o botão para abrir uma pesquisa com marca, modelo, versão e ano. Depois adiciona os anúncios comparáveis ao quadro.</p><button class="ghostBtn" style="margin-top:12px" onclick="Mobiway.marketSearch()">Pesquisar comparáveis ↗</button></div>`}

  function stepFinance(d){ const f=d.finance, risk=calcRisk(d), m=effectiveMarket(d); return `<div class="grid"><div class="card wide"><h3>Preparação prevista</h3><div class="formGrid" style="margin-top:12px">
    ${euroField('Revisão / manutenção','finance.service',f.service)}${euroField('Detailing','finance.detailing',f.detailing)}
    ${euroField('Reserva garantia','finance.warranty',f.warranty)}${euroField('Administrativo / comercial','finance.admin',f.admin)}
    ${field('Dias previstos em stock','finance.stockDays',f.stockDays,'number')}${euroField('Custo mensal de stock','finance.stockMonthly',f.stockMonthly)}
    ${euroField('Outros custos','finance.other',f.other)}${euroField('Ajuste manual de risco','finance.customRisk',f.customRisk)}
  </div></div><div class="card"><span class="badge orange">RISCO CALCULADO</span><div class="metric">${fmt.format(risk.amount)}</div><p>${risk.label} · score ${risk.score}/100</p></div></div>
  <div class="panel" style="margin-top:14px"><h3>Política Mobiway aplicada</h3><div class="breakdown">
    <div class="breakRow"><span>Mercado corrigido</span><strong>${fmt.format(m.value)}</strong></div>
    <div class="breakRow"><span>Margem alvo</span><strong>máx. ${settings.targetProfitPct}% / mínimo ${fmt.format(settings.targetProfitMin)}</strong></div>
    <div class="breakRow"><span>Margem mínima absoluta</span><strong>${fmt.format(settings.minimumProfit)}</strong></div>
    <div class="breakRow"><span>Buffer de negociação</span><strong>${settings.negotiationBufferPct}%</strong></div>
  </div></div>`}

  function stepResult(d){ const r=calculate(d); d.result=r; return resultHtml(d,r,true); }

  function resultHtml(d,r,inWizard=false){ const v=d.vehicle; return `<div class="resultHero"><span class="badge orange">MOBIWAY · AVALIAÇÃO</span><div class="car" style="margin-top:12px">${esc(v.year)} · ${Number(v.km||0).toLocaleString('pt-PT')} km · ${esc(v.fuel)} · ${esc(v.gearbox)}</div><h2>${esc([v.brand,v.model,v.version].filter(Boolean).join(' ')||'Viatura')}</h2>
    <div class="resultBand"><div class="band green"><small>Compra aconselhada</small><strong>${fmt.format(r.recommendedBuy)}</strong></div><div class="band orange"><small>Máximo absoluto</small><strong>${fmt.format(r.maximumBuy)}</strong></div><div class="band red"><small>Acima de</small><strong>${fmt.format(r.maximumBuy)}</strong></div></div>
  </div>
  <div class="grid" style="margin-top:14px"><div class="card wide"><h3>Economia do negócio</h3><div class="breakdown">
    <div class="breakRow"><span>Venda provável</span><strong>${fmt.format(r.expectedSale)}</strong></div>
    <div class="breakRow"><span>Reparações observadas</span><strong>− ${fmt.format(r.observedRepairs)}</strong></div>
    <div class="breakRow"><span>Preparação + stock</span><strong>− ${fmt.format(r.prepAndStock)}</strong></div>
    <div class="breakRow"><span>Reserva de risco</span><strong>− ${fmt.format(r.riskAmount)}</strong></div>
    <div class="breakRow"><span>Margem alvo Mobiway</span><strong>− ${fmt.format(r.targetProfit)}</strong></div>
    <div class="breakRow total"><span>Compra aconselhada</span><strong>${fmt.format(r.recommendedBuy)}</strong></div>
  </div></div><div class="card"><div class="scoreWrap"><div class="score" style="--score:${r.confidence*3.6}deg"><b>${r.confidence}%</b></div><div class="scoreText"><strong>Confiança</strong><small>${r.confidenceLabel}</small></div></div><hr style="border:0;border-top:1px solid #282d35;margin:18px 0"><span class="badge ${r.riskScore<40?'green':r.riskScore<70?'orange':'red'}">RISCO ${r.riskLabel.toUpperCase()}</span><div class="metric">${r.riskScore}<small>/100</small></div></div></div>
  <div class="callout" style="margin-top:14px"><strong>FAIXA DE NEGOCIAÇÃO</strong><div class="big">Abrir em ${fmt.format(r.openingOffer)}</div><p>Objetivo: fechar até ${fmt.format(r.recommendedBuy)}. Não ultrapassar ${fmt.format(r.maximumBuy)} sem rever preço de venda, custos ou margem.</p></div>
  ${!inWizard?decisionPanel(d):''}`; }

  function decisionPanel(d){ const p=d.purchase||{}; return `<div class="panel" style="margin-top:14px"><div class="panelTitle"><div><h3>Decisão real</h3><div class="hint">Regista o resultado para o sistema comparar previsão vs. realidade.</div></div></div><div class="heroActions noPrint"><button class="successBtn" onclick="Mobiway.markDecision('${d.id}','bought')">✓ COMPRÁMOS</button><button class="dangerBtn" onclick="Mobiway.markDecision('${d.id}','passed')">× NÃO COMPRÁMOS</button><button class="ghostBtn" onclick="window.print()">Imprimir / PDF</button></div>
  ${p.decision==='bought'?`<div class="formGrid" style="margin-top:16px">${euroField('Preço real de compra','purchase.actualPurchasePrice',p.actualPurchasePrice)}${euroField('Reparação real','purchase.actualRepairCost',p.actualRepairCost)}${euroField('Preço real de venda','purchase.actualSalePrice',p.actualSalePrice)}${euroField('Garantia / pós-venda real','purchase.warrantyActual',p.warrantyActual)}${field('Data de venda','purchase.saleDate',p.saleDate,'date')}<div class="field full"><label>Notas finais</label><textarea data-path="purchase.notes">${esc(p.notes||'')}</textarea></div></div><button class="primaryBtn noPrint" style="margin-top:12px" onclick="Mobiway.saveDetail()">Guardar resultado real</button>`:''}</div>`; }

  function riskFactor(v){ return ({good:0,mid:1,bad:2})[v] ?? 1; }
  function calcRisk(d){
    const c=d.condition,v=d.vehicle; let score=0, amount=0;
    score += riskFactor(c.engine)*11 + riskFactor(c.gearbox)*11 + riskFactor(c.body)*6 + riskFactor(c.interior)*4 + riskFactor(c.tyres)*4 + riskFactor(c.brakes)*6;
    if(c.history==='unknown'){score+=12;amount+=settings.unknownHistoryRisk}else if(c.history==='partial'){score+=5;amount+=Math.round(settings.unknownHistoryRisk*.4)}
    if(c.warningLights==='major'){score+=18;amount+=500}else if(c.warningLights==='minor'){score+=7;amount+=180}
    if(c.accidents==='yes'){score+=12;amount+=350}else if(c.accidents==='unknown')score+=4;
    if(String(v.gearbox).toLowerCase().includes('autom')){score+=5;amount+=settings.automaticGearboxRisk}
    if(num(v.km)>=200000){score+=10;amount+=settings.highKmRisk}else if(num(v.km)>=150000){score+=5;amount+=Math.round(settings.highKmRisk*.5)}
    if(v.fuel==='Diesel' && num(v.km)>=140000){score+=4;amount+=settings.dieselRisk}
    if(v.origin==='Importado'){score+=3;amount+=100}
    if(num(c.keys)<2){score+=2;amount+=120}
    score=clamp(Math.round(score),0,100); amount += num(d.finance.customRisk);
    return {score,amount,label:score<35?'Baixo':score<65?'Médio':'Elevado'};
  }

  function marketStats(d){
    const targetYear=num(d.vehicle.year), targetKm=num(d.vehicle.km);
    let rows=d.comps.map(c=>({year:num(c.year),km:num(c.km),price:num(c.price)})).filter(c=>c.price>500);
    if(!rows.length)return {count:0,median:0,adjusted:0,confidence:15};
    const prices=rows.map(x=>x.price); const med=median(prices);
    // robust outlier filter around median ±35%
    const clean=rows.filter(x=>x.price>=med*.65 && x.price<=med*1.35);
    const use=clean.length>=2?clean:rows;
    const adjusted=use.map(c=>{
      const ageAdj=(targetYear-c.year)*350; // newer target => higher than older comp
      const kmDelta=(targetKm-c.km)/10000;
      const kmAdj=kmDelta*-180; // more km on target => lower value
      return c.price + ageAdj + kmAdj;
    });
    const adj=median(adjusted);
    const count=use.length;
    const spread=median(use.map(x=>Math.abs(x.price-med)))/(med||1);
    let confidence=35+count*10 - spread*80;
    if(count>=5)confidence+=8;if(count>=8)confidence+=5;
    confidence=clamp(Math.round(confidence),20,95);
    return {count,median:Math.round(med),adjusted:Math.round(adj),confidence};
  }

  function effectiveMarket(d){const s=marketStats(d); const ov=num(d.marketOverride); return {value:ov||s.adjusted||s.median||num(d.vehicle.askingPrice),confidence:ov?78:s.confidence,source:ov?'manual':'comparables'};}

  function calculate(d){
    const market=effectiveMarket(d), risk=calcRisk(d), c=d.condition, f=d.finance;
    const observedRepairs=num(c.mechanicalCost)+num(c.bodyCost)+num(c.tyresCost)+num(c.otherRepairCost);
    const stockCost=num(f.stockMonthly)*(num(f.stockDays)/30);
    const prepAndStock=num(f.service)+num(f.detailing)+num(f.warranty)+num(f.admin)+num(f.other)+stockCost;
    const expectedSale=market.value;
    const targetProfit=Math.max(settings.targetProfitMin, expectedSale*(settings.targetProfitPct/100));
    const totalBeforeProfit=observedRepairs+prepAndStock+risk.amount;
    const recommendedBuy=Math.max(0,Math.round(expectedSale-totalBeforeProfit-targetProfit));
    const maximumBuy=Math.max(recommendedBuy,Math.round(expectedSale-totalBeforeProfit-settings.minimumProfit));
    const openingOffer=Math.max(0,Math.round(recommendedBuy*(1-settings.negotiationBufferPct/100)/50)*50);
    let confidence=market.confidence;
    if(d.photos.length>=6)confidence+=5;if(d.vehicle.vin)confidence+=3;if(c.history==='complete')confidence+=4;if(c.history==='unknown')confidence-=5;
    confidence=clamp(Math.round(confidence),15,97);
    return {expectedSale,observedRepairs,prepAndStock,riskAmount:risk.amount,riskScore:risk.score,riskLabel:risk.label,targetProfit,recommendedBuy,maximumBuy,openingOffer,confidence,confidenceLabel:confidence>=80?'Alta':confidence>=60?'Média':'Baixa',marketSource:market.source};
  }

  function bindWizardInputs(){
    document.querySelectorAll('[data-path]').forEach(el=>el.addEventListener('input',()=>{setPath(state.draft,el.dataset.path,el.value); state.draft.updatedAt=new Date().toISOString(); if(state.step===6) renderWizard();}));
    document.querySelectorAll('[data-comp]').forEach(el=>el.addEventListener('change',()=>{const [i,k]=el.dataset.comp.split('.'); state.draft.comps[Number(i)][k]=el.value; state.draft.updatedAt=new Date().toISOString(); renderWizard();}));
  }
  function setPath(obj,path,val){const parts=path.split('.');let cur=obj;parts.slice(0,-1).forEach(p=>{if(!cur[p])cur[p]={};cur=cur[p]});cur[parts.at(-1)]=val;}

  function renderDetail(){
    const d=evaluations.find(x=>x.id===state.editingId); if(!d){state.view='home';return render();}
    d.result=calculate(d); state.draft=d;
    app.innerHTML=shell(`<div class="sectionHead"><div><h2>Relatório de avaliação</h2><p>${new Date(d.createdAt).toLocaleString('pt-PT')}</p></div><div class="heroActions noPrint"><button class="ghostBtn" onclick="Mobiway.editEvaluation('${d.id}')">Editar avaliação</button></div></div>${resultHtml(d,d.result,false)}${d.photos.length?`<div class="sectionHead"><div><h2>Fotografias</h2></div></div><div class="photoGrid">${d.photos.map(p=>`<div class="photoSlot"><img src="${p.data}"></div>`).join('')}</div>`:''}`,'history');
    bindWizardInputs();
  }

  function renderHistory(){
    app.innerHTML=shell(`<div class="sectionHead"><div><h2>Histórico</h2><p>${evaluations.length} avaliações guardadas localmente.</p></div><button class="primaryBtn" onclick="Mobiway.newEvaluation()">＋ Nova</button></div>
    ${evaluations.length?`<div class="list">${[...evaluations].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).map(e=>{const r=calculate(e);const name=[e.vehicle.brand,e.vehicle.model,e.vehicle.version].filter(Boolean).join(' ')||'Viatura';return `<div class="rowCard"><div class="main" onclick="Mobiway.openDetail('${e.id}')"><strong>${esc(name)}</strong><small>${esc(e.vehicle.plate||'sem matrícula')} · ${e.vehicle.year} · ${Number(e.vehicle.km||0).toLocaleString('pt-PT')} km · ${statusText(e)}</small></div><div style="text-align:right"><div class="money">${fmt.format(r.recommendedBuy)}</div><small>aconselhado</small><button class="dangerBtn" style="margin-top:7px;padding:6px 9px" onclick="Mobiway.deleteEvaluation('${e.id}')">Eliminar</button></div></div>`}).join('')}</div>`:`<div class="empty">Sem avaliações.</div>`}
    <div class="panel" style="margin-top:18px"><h3>Backup</h3><p class="hint">Exporta as avaliações e definições para um ficheiro JSON. Podes voltar a importá-lo neste dispositivo.</p><div class="heroActions"><button class="ghostBtn" onclick="Mobiway.exportData()">Exportar dados</button><button class="ghostBtn" onclick="Mobiway.importData()">Importar backup</button><input type="file" id="backupInput" accept="application/json" hidden></div></div>`,'history');
  }

  function renderAnalytics(){
    const bought=evaluations.filter(e=>e.purchase?.decision==='bought'); const sold=bought.filter(e=>num(e.purchase.actualSalePrice)>0);
    const spent=bought.reduce((s,e)=>s+num(e.purchase.actualPurchasePrice)+num(e.purchase.actualRepairCost)+num(e.purchase.warrantyActual),0);
    const revenue=sold.reduce((s,e)=>s+num(e.purchase.actualSalePrice),0); const profit=sold.reduce((s,e)=>s+num(e.purchase.actualSalePrice)-num(e.purchase.actualPurchasePrice)-num(e.purchase.actualRepairCost)-num(e.purchase.warrantyActual),0);
    const forecast=sold.reduce((s,e)=>s+(e.result?.targetProfit||calculate(e).targetProfit),0); const variance=profit-forecast;
    app.innerHTML=shell(`<div class="sectionHead"><div><h2>Resultados Mobiway</h2><p>O ciclo de aprendizagem começa quando registas compra, reparação e venda reais.</p></div></div>
    <div class="grid"><div class="card"><span class="badge green">COMPRADAS</span><div class="metric">${bought.length}</div><p>viaturas marcadas como compradas</p></div><div class="card"><span class="badge">CAPITAL</span><div class="metric">${fmt.format(spent)}</div><p>compra + reparação + garantia registada</p></div><div class="card"><span class="badge orange">LUCRO REAL</span><div class="metric">${fmt.format(profit)}</div><p>${sold.length} negócios com venda fechada</p></div></div>
    <div class="panel" style="margin-top:14px"><h3>Previsão vs. realidade</h3><div class="breakdown"><div class="breakRow"><span>Receita de vendas registada</span><strong>${fmt.format(revenue)}</strong></div><div class="breakRow"><span>Margem prevista nesses negócios</span><strong>${fmt.format(forecast)}</strong></div><div class="breakRow"><span>Lucro real</span><strong>${fmt.format(profit)}</strong></div><div class="breakRow total"><span>Desvio do modelo</span><strong>${variance>=0?'+':''}${fmt.format(variance)}</strong></div></div></div>
    <div class="callout"><strong>APRENDIZAGEM MOBIWAY</strong><div class="big">Dados próprios > tabelas genéricas</div><p>Ao acumular negócios fechados, estes dados permitem calibrar reservas de risco, custos de preparação e margens por marca, motor, caixa e faixa de quilometragem.</p></div>`,'analytics');
  }

  function renderSettings(){
    const rows=[
      ['Margem alvo (%)','targetProfitPct','Percentagem aplicada sobre a venda provável.'],['Margem alvo mínima (€)','targetProfitMin','Nunca procurar menos margem do que este valor.'],['Margem mínima absoluta (€)','minimumProfit','Usada para definir o máximo que se pode pagar.'],['Buffer de negociação (%)','negotiationBufferPct','Desconto sobre a compra aconselhada para a oferta inicial.'],['Reserva base de garantia (€)','warrantyReserve','Valor comercial reservado por negócio.'],['Custo mensal de stock (€)','stockMonthly','Capital, espaço, seguro e custo de imobilização.'],['Dias padrão em stock','expectedStockDays','Previsão inicial até à venda.'],['Administrativo/comercial (€)','adminCost','Documentação, anúncio e operação.'],['Revisão padrão (€)','defaultService','Preparação mecânica inicial.'],['Detailing padrão (€)','defaultDetailing','Lavagem, higienização e preparação.'],['Risco histórico desconhecido (€)','unknownHistoryRisk','Reserva automática quando não existe histórico.'],['Risco caixa automática (€)','automaticGearboxRisk','Reserva adicional base para automáticas.'],['Risco km elevado (€)','highKmRisk','Reserva para ≥200.000 km.'],['Risco diesel elevado (€)','dieselRisk','Reserva diesel/antipoluição em km elevados.']
    ];
    app.innerHTML=shell(`<div class="sectionHead"><div><h2>Política de compra</h2><p>Estes valores alimentam todas as novas avaliações.</p></div></div><div class="panel">${rows.map(([l,k,h])=>`<div class="settingRow"><div><strong>${l}</strong><small>${h}</small></div><input type="number" data-setting="${k}" value="${settings[k]}"></div>`).join('')}</div><div class="heroActions"><button class="primaryBtn" onclick="Mobiway.saveSettings()">Guardar definições</button><button class="ghostBtn" onclick="Mobiway.resetSettings()">Repor valores iniciais</button></div>`,'settings');
  }

  function persistEvaluation(d){ d.updatedAt=new Date().toISOString(); d.result=calculate(d); const i=evaluations.findIndex(x=>x.id===d.id); if(i>=0)evaluations[i]=d; else evaluations.push(d); save('mobiway_evaluations',evaluations); }

  const Mobiway={
    go(view){state.view=view;state.step=1;state.draft=null;render();window.scrollTo(0,0)},
    backHome(){this.go('home')},
    newEvaluation(){state.draft=newDraft();state.view='wizard';state.step=1;state.editingId=null;render();window.scrollTo(0,0)},
    loadDemo(){const d=newDraft();Object.assign(d.vehicle,{plate:'00-AA-00',brand:'MOBIWAY DEMO',model:'Crossover 1.5',version:'Executive',year:2021,fuel:'Diesel',gearbox:'Automática',km:98000,origin:'Nacional',askingPrice:14500});d.comps=[{source:'Exemplo A',year:2021,km:92000,price:14900},{source:'Exemplo B',year:2020,km:110000,price:13500},{source:'Exemplo C',year:2021,km:101000,price:14250},{source:'Exemplo D',year:2022,km:85000,price:15800}];Object.assign(d.condition,{body:'mid',interior:'good',tyres:'mid',engine:'good',gearbox:'good',brakes:'mid',history:'partial',warningLights:'none',accidents:'no',mechanicalCost:350,bodyCost:250,tyresCost:320});state.draft=d;state.view='wizard';state.step=6;render();window.scrollTo(0,0);toast('Demonstração carregada — valores ilustrativos.');},
    cancelWizard(){state.draft=null;this.go('home')},
    prevStep(){if(state.step===1)return this.cancelWizard();state.step--;render();window.scrollTo(0,0)},
    nextStep(){
      if(state.step===1){const v=state.draft.vehicle;if(!v.brand||!v.model||!v.year||!v.km){toast('Preenche marca, modelo, ano e quilómetros.');return;}}
      if(state.step<6){state.step++;render();window.scrollTo(0,0);return;}
      persistEvaluation(state.draft); state.editingId=state.draft.id; state.view='detail'; state.draft=null; render(); window.scrollTo(0,0); toast('Avaliação guardada.');
    },
    setRating(path,v){setPath(state.draft,path,v);renderWizard()},
    addComp(){state.draft.comps.push({source:'',year:state.draft.vehicle.year,km:state.draft.vehicle.km,price:''});renderWizard()},
    removeComp(i){state.draft.comps.splice(i,1);renderWizard()},
    marketSearch(){const v=state.draft.vehicle;const q=encodeURIComponent(`${v.brand} ${v.model} ${v.version||''} ${v.year} usados Portugal`);window.open(`https://www.google.com/search?q=${q}`,'_blank')},
    takePhoto(){const x=document.getElementById('photoInput');x.value='';x.click()},
    pickPhotos(){const x=document.getElementById('galleryInput');x.value='';x.click()},
    removePhoto(i){state.draft.photos.splice(i,1);renderWizard()},
    openDetail(id){state.editingId=id;state.view='detail';render();window.scrollTo(0,0)},
    editEvaluation(id){const e=evaluations.find(x=>x.id===id); if(!e)return; state.draft=structuredClone(e);state.editingId=id;state.view='wizard';state.step=1;render();window.scrollTo(0,0)},
    deleteEvaluation(id){if(!confirm('Eliminar esta avaliação?'))return;evaluations=evaluations.filter(x=>x.id!==id);save('mobiway_evaluations',evaluations);renderHistory();toast('Avaliação eliminada.')},
    markDecision(id,decision){const e=evaluations.find(x=>x.id===id);if(!e)return;e.purchase=e.purchase||{};e.purchase.decision=decision;persistEvaluation(e);renderDetail();toast(decision==='bought'?'Marcado como comprado.':'Marcado como não comprado.')},
    saveDetail(){const d=evaluations.find(x=>x.id===state.editingId);if(!d)return;document.querySelectorAll('[data-path]').forEach(el=>setPath(d,el.dataset.path,el.value));persistEvaluation(d);renderDetail();toast('Resultado real guardado.')},
    saveSettings(){document.querySelectorAll('[data-setting]').forEach(el=>settings[el.dataset.setting]=num(el.value));save('mobiway_settings',settings);toast('Definições guardadas.');renderSettings()},
    resetSettings(){if(!confirm('Repor os valores iniciais?'))return;settings=structuredClone(DEFAULTS);save('mobiway_settings',settings);renderSettings()},
    exportData(){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),settings,evaluations},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`mobiway-avalia-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)},
    importData(){const i=$('#backupInput');i.onchange=async()=>{try{const data=JSON.parse(await i.files[0].text());if(data.settings)settings={...DEFAULTS,...data.settings};if(Array.isArray(data.evaluations))evaluations=data.evaluations;save('mobiway_settings',settings);save('mobiway_evaluations',evaluations);renderHistory();toast('Backup importado.')}catch{toast('Ficheiro de backup inválido.')}};i.click()}
  };
  window.Mobiway=Mobiway;

  async function compressImage(file){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const max=1280,scale=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.76))};img.onerror=reject;img.src=URL.createObjectURL(file)});}
  async function addFiles(files){for(const f of files){if(!f.type.startsWith('image/'))continue;try{const data=await compressImage(f);state.draft.photos.push({name:f.name,data,addedAt:new Date().toISOString()})}catch{}}renderWizard()}
  document.getElementById('photoInput').addEventListener('change',e=>addFiles(e.target.files));
  document.getElementById('galleryInput').addEventListener('change',e=>addFiles(e.target.files));

  if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
  render();
})();
