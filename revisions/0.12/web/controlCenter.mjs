export const controlLabels={'Painel geral':'Super Dashboard','Crescimento':'Indicadores de crescimento','Assinaturas':'Planos e assinaturas','Módulos do lojista':'Módulos e permissões','Homologação':'Integrações e homologações','Central de Aplicativos':'Aplicativos e versões','Central de Diagnósticos':'Central de alertas','Suporte e incidentes':'Suporte aos lojistas','Auditoria':'Segurança e auditoria'};
export const controlGroups=[
 ['Visão estratégica',[['Painel geral','analytics'],['Crescimento','analytics']]],
 ['Gestão comercial',[['Estabelecimentos','stores'],['Usuários','users'],['Assinaturas','finance',true],['Financeiro do Pitacco','finance',true],['Custos e despesas','costs'],['Cobranças e inadimplência','finance']]],
 ['Operação global',[['Pedidos','operations',true],['Entregadores','operations',true],['Mapa de operações','operations']]],
 ['Tecnologia',[['Homologação','health',true],['Módulos do lojista','features',true],['Central de Aplicativos','health',true],['Saúde da plataforma','health'],['Auditoria','security']]],
 ['Central de comando',[['Pitacco Intelligence','health',true],['Central de Diagnósticos','health',true],['Suporte e incidentes','health',true],['Comunicados','communications']]],
 ['Administração',[['Configurações gerais','settings'],['Administradores e permissões','security']]]
];
export const controlTitle=id=>controlLabels[id]||id;
export const canControl=(entry,access)=>Boolean(access?.owner||access?.allowed&&(!entry[2])&&access.modules?.includes(entry[1]));
export const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
export function changePercent(current,previous){return Number(previous)>0?(Number(current)-Number(previous))/Number(previous)*100:null}
export function seriesPath(values,width=640,height=180){
 if(!Array.isArray(values)||!values.length)return '';
 const safe=values.map(x=>Math.max(0,Number(x)||0)),max=Math.max(1,...safe);
 return safe.map((v,i)=>(i?'L':'M')+(safe.length===1?width/2:i*width/(safe.length-1)).toFixed(2)+','+(height-v/max*(height-12)).toFixed(2)).join(' ');
}
export const controlStatus={active:'Ativa',trial:'Em teste',courtesy:'Cortesia',suspended:'Suspensa',overdue:'Inadimplente',legacy:'Cadastro anterior',paid:'Pago',open:'Em aberto',grace:'Em tolerância',review_required:'Em conciliação',recovery_due:'Saldo de estorno a regularizar',recovery_paid:'Saldo recuperado',waived:'Saldo dispensado',operational:'Operacional',unstable:'Instável',unavailable:'Indisponível',not_configured:'Não configurado',awaiting_homologation:'Aguardando homologação',no_recent_evidence:'Sem evidência recente',free:'Completo Flex',complete:'Completo Fixo',windows:'Windows',android:'Android',observer:'Observador',support:'Suporte',finance:'Financeiro',operations:'Operações',merchants:'Lojistas',couriers:'Entregadores',all:'Todos',notice:'Comunicado',maintenance:'Manutenção',update:'Atualização'};
export function describeAssistance(row,now=Date.now()){return row.revoked_at?'Revogada':new Date(row.expires_at).getTime()<=now?'Expirada':row.approved_at?'Autorizada':'Aguardando lojista'}
export const money=value=>value==null?'Não informado':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value));
export const count=value=>value==null?'—':new Intl.NumberFormat('pt-BR').format(Number(value));
export const when=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'Sem informação';
export function periodDays(days=30){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const p=today.split('-');const end=p.length===3&&p[0].length===4?today:new Date().toISOString().slice(0,10);return {start:new Date(new Date(end+'T12:00:00Z').getTime()-(days-1)*86400000).toISOString().slice(0,10),end};}
