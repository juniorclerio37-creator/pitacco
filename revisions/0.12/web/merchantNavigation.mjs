// One menu registry; route IDs remain stable and resolve to existing workspaces.
const item=(id,label,tab=id,section='',manager=false,feature='')=>({id,label,tab,section,manager,feature});
export const overview=item('Painel','Visão Geral');
export const groups=[
 {name:'Operação',icon:'operation',items:[item('Pedidos','Pedidos'),item('Histórico de pedidos','Histórico de pedidos','Pedidos','history',true),item('Caixa','Caixa / Balcão'),item('Cozinha e expedição','Cozinha e expedição'),item('Agendamento','Agendamentos','Agendamento','',true),item('Alertas','Alertas','Alertas','',true)]},
 {name:'Cardápio',icon:'menu',items:[item('Produtos','Produtos'),item('Categorias','Categorias','Produtos','Categorias'),item('Complementos','Complementos','Produtos','Complementos'),item('Estoque do cardápio','Estoque e insumos','Produtos','Estoque',true,'estoque'),item('Estoque','Insumos e fichas técnicas','Estoque','',true),item('Importar cardápio','Importar cardápio'),item('Aparência do cardápio','Aparência do cardápio','Aparência do cardápio','',true),item('Banners','Banners','Produtos','Banners',true)]},
 {name:'Entregas',icon:'delivery',items:[item('Entregas','Gestão de entregas','Entregas','',true),item('Ocorrências','Central de Ocorrências','Entregas','occurrences',true),item('Mapa de entregadores','Mapa de entregadores','Mapa de entregadores','',true,'motoboys'),item('Entregadores','Cadastro de motoboys','Entregadores','Entregadores',true),item('Pagamento de motoboys','Pagamentos de motoboys','Entregadores','Pagamentos',true),item('Relatório de motoboys','Relatório de motoboys','Entregadores','Relatórios',true),item('Regras de cobrança','Regras de cobrança','Entregadores','Regras de Cobrança',true),item('Área de entrega','Área de entrega','Área de entrega','',true)]},
 {name:'Clientes',icon:'customers',items:[item('Clientes','Cadastro de clientes','Clientes','',true),item('Fiado / Caderneta','Fiado / Caderneta','Fiado / Caderneta','clientes',true),item('Clientes bloqueados','Clientes bloqueados','Clientes','bloqueados',true)]},
 {name:'Fideliza+',icon:'loyalty',items:[item('Programa de pontos','Programa de pontos','Fideliza+','Clientes e pontos',true),item('Cashback','Cashback','Fideliza+','Cashback',true),item('Cupons de desconto','Cupons de desconto','Fideliza+','Cupons',true),item('Indique e ganhe','Indique e ganhe','Fideliza+','Indique e ganhe',true),item('Fideliza+','Benefícios','Fideliza+','Visão geral',true),item('Campanhas','Campanhas','Fideliza+','Campanhas',true),item('Clientes e carteiras','Clientes e carteiras','Fideliza+','Clientes e carteiras',true)]},
 {name:'Financeiro',icon:'finance',items:[item('Visão financeira','Visão financeira','Relatórios','report',true,'financeiro'),item('Contas a receber','Contas a receber (fiado)','Fiado / Caderneta','pedidos',true),item('Lançamentos','Lançamentos'),item('Despesas','Despesas'),item('Relatórios','Relatórios','Relatórios','report',true)]},
 {name:'Integrações',icon:'integrations',items:[item('Integrações','Marketplaces'),item('Pagamentos da loja','Meios de pagamento','Pagamentos da loja','',true),item('Entrega externa','Entregas parceiras'),item('WhatsApp','WhatsApp')]},
 {name:'Configurações',icon:'settings',items:[item('Minha Loja','Dados da loja'),item('Horário de funcionamento','Horários de funcionamento','Horário de funcionamento','',true),item('Configurações','Impressão','Configurações','Impressoras',true),item('Alertas e sons','Alertas e sons','Configurações','Alertas e aplicativo',true),item('Aceite de pedidos','Aceite de pedidos','Configurações','Aceite de pedidos',true),item('Equipe','Usuários e permissões','Equipe','',true),item('Assinaturas','Assinatura'),item('Aplicativos e Downloads','Aplicativos e downloads'),item('Primeiros passos','Primeiros passos'),item('Atualizações','Atualizações')]}
];
export const support=item('Ajuda e suporte','Ajuda e suporte');
export const routes=[overview,item('Novo Pedido','Novo Pedido','Cozinha e expedição','new-order',true),...groups.flatMap(g=>g.items),support];
const lookup=new Map(routes.map(r=>[r.id,r]));
export const menuRouteIds=routes.map(r=>r.id);
export function resolveMenuRoute(id){return lookup.get(id)||{id,tab:id,label:id,section:'',manager:false,feature:''}}
export function menuAllowed(route,{allowed,manager,active,admin=false,driver=false,featureSettings=null}){
 if(driver)return route.id==='Entregas';
 if(route.manager&&(!manager||!active))return false;
 if(route.id==='Lojas'&&!admin)return false;
 if(route.feature&&featureSettings&&featureSettings[route.feature]===false)return false;
 return allowed(route.tab);
}
export const searchMenu=(route,query)=>[route.label,route.id,route.tab].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(String(query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim());
export function fallbackMenuItems(nav,secondaryTabs,landing){
 const covered=new Set(routes.flatMap(r=>[r.id,r.tab]));
 return [...new Set([...nav.map(([n])=>landing[n]||n),...Object.values(secondaryTabs).flat().map(([id])=>id)])].filter(id=>!covered.has(id)).map(id=>item(id,id,id,'',id==='Lojas'||id==='Equipe'));
}
