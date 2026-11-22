import React, {useState} from 'react';

const dateFormat = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo'});
const dayFormat = new Intl.DateTimeFormat('pt-BR', {timeZone:'America/Sao_Paulo',dateStyle:'short'});
const money = new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'});
const fields = [
  ['goods_cost','Custo dos produtos'],
  ['processing_fees','Taxa de pagamento adicional'],
  ['delivery_cost','Custo de entrega adicional'],
  ['other_cost','Outros custos diretos'],
  ['merchant_discount','Desconto informado']
];
const pageSize = 25;

export default function OrderProfitReport({client, storeId}) {
  const today = dateFormat.format(new Date());
  const [start,setStart] = useState(today.slice(0,8)+'01');
  const [end,setEnd] = useState(today);
  const [report,setReport] = useState(null);
  const [draft,setDraft] = useState(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');

  async function load(period, page) {
    const {data,error} = await client.rpc('pitacco_order_profit_report',{
      p_store:storeId,p_start:period.start,p_end:period.end,p_page:page
    });
    if(error) throw error;
    setReport({...period,page,rows:data.slice(0,pageSize),hasMore:data.length>pageSize});
  }

  async function goTo(period, page) {
    setBusy(true);setError('');setNotice('');
    try {
      await load(period,page);
      setDraft(null);
    } catch(failure) {
      setError(failure.message||'Não foi possível consultar os pedidos.');
    } finally {
      setBusy(false);
    }
  }

  async function openCostEditor(row) {
    setBusy(true);setError('');setNotice('');
    try{
      const {data,error}=await client.rpc('pitacco_order_cost_breakdown',{
        p_store:storeId,p_order:row.order_id
      });
      if(error)throw error;
      setDraft({...row,material:data});
    }catch(failure){
      setError(failure.message||'Não foi possível consultar o detalhamento do custo.');
    }finally{setBusy(false);}
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);setError('');setNotice('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    // Vazio: nenhum custo manual. O relatório usará o custo automático
    // apenas quando a ficha estiver completa. Nunca gravar custo presumido.
    values.goods_cost=values.goods_cost===''?null:values.goods_cost;
    try {
      const {error} = await client.from('pitacco_order_costs').upsert({
        order_id:draft.order_id,store_id:storeId,...values
      },{onConflict:'order_id'});
      if(error) throw error;
      setDraft(null);
      setNotice('Custos salvos.');
      await load({start:report.start,end:report.end},report.page);
    } catch(failure) {
      setError(failure.message||'Não foi possível atualizar os custos.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel" aria-label="Resultado por pedido" aria-busy={busy}>
    <h3>Resultado por pedido</h3>
    <p>O resultado desconta da venda registrada as taxas do pedido e os custos diretos cadastrados. O custo dos ingredientes e complementos pode ser calculado a partir das fichas técnicas e dos preços cadastrados <strong>no momento do aceite</strong>. Se faltar algum preço, a estimativa não será considerada custo completo. As demais despesas devem ser informadas; não presumimos que sejam zero.</p>
    <form onSubmit={event=>{event.preventDefault();void goTo({start,end},0);}}>
      <label>Data inicial <input type="date" required value={start} max={end} onChange={event=>setStart(event.target.value)}/></label>
      <label>Data final <input type="date" required value={end} min={start} onChange={event=>setEnd(event.target.value)}/></label>
      <button disabled={busy}>{busy?'Consultando…':'Consultar pedidos'}</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    {draft&&<form key={draft.order_id} aria-label="Custos do pedido" onSubmit={save}>
      <h4>Custos do pedido {draft.reference}</h4>
      <p>Preencha com zero apenas quando souber que determinado custo não se aplica. O desconto é informativo, pois o valor da venda pode já incluí-lo. Não duplique taxas já descontadas do pedido.</p>
      {draft.material&&<section aria-label="Detalhamento dos ingredientes">
        <p><strong>Origem do custo dos produtos:</strong> {draft.material.status==='manual'
          ?'Valor manual cadastrado pelo lojista.'
          :draft.material.status==='automatic'
            ?'Calculado automaticamente com os preços vigentes ao aceitar o pedido.'
            :'Pendente de preços ou fichas técnicas.'}</p>
        {draft.material.automatic_goods_cost!=null&&<p>
          Custo automático: <strong>{money.format(draft.material.automatic_goods_cost)}</strong>.
          Você pode substituir este valor informando o custo manual, ou manter o campo vazio para usar o automático.
        </p>}
        {draft.material.status==='pending'&&<p role="status">
          Custo conhecido até agora: {money.format(draft.material.known_partial_cost||0)}.
          Fichas de produtos pendentes: {draft.material.missing_product_recipes||0};
          fichas de complementos pendentes: {draft.material.missing_option_recipes||0};
          insumos sem preço: {draft.material.missing_ingredient_prices||0}.
          O custo parcial não é considerado lucro final.
        </p>}
        {Array.isArray(draft.material.ingredients)&&draft.material.ingredients.length>0&&
          <details><summary>Ver insumos consumidos e seus preços na data do pedido</summary>
            <ul>{draft.material.ingredients.map((line,index)=><li key={index}>
              {line.name}: {line.quantity} {line.unit} × {line.unit_cost===null?'preço pendente':('R$ '+Number(line.unit_cost).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:6}))}
              {' = '}{line.line_cost===null?'pendente':money.format(line.line_cost)}
            </li>)}</ul>
          </details>}
      </section>}
      {fields.map(([key,label])=><label key={key}>{label}
        <input name={key} type="number" min="0" max="999999.99" step="0.01"
          required={key!=='goods_cost'}
          placeholder={key==='goods_cost'&&draft.material?.automatic_goods_cost!=null
            ?'Automático: '+money.format(draft.material.automatic_goods_cost):undefined}
          defaultValue={key==='goods_cost'
            ?(draft.material?.manual_goods_cost??'')
            :(draft[key]??(key==='merchant_discount'?0:''))}/>
      </label>)}
      <button disabled={busy}>Salvar custos</button>
      <button disabled={busy} type="button" className="secondary" onClick={()=>setDraft(null)}>Cancelar</button>
    </form>}
    {report&&(!report.rows.length?<p>Nenhum pedido nesse período.</p>:<>
      <div style={{overflowX:'auto'}}>
        <table>
          <thead><tr><th>Pedido</th><th>Data</th><th>Canal</th><th>Venda</th><th>Taxas do pedido</th><th>Custos diretos</th><th>Resultado</th><th>Ações</th></tr></thead>
          <tbody>{report.rows.map(row=><tr key={row.order_id}>
            <td>{row.reference}</td><td>{dayFormat.format(new Date(row.created_at))}</td><td>{row.channel}</td>
            <td>{money.format(row.gross)}</td><td>{money.format(row.fees)}</td>
            <td>{row.direct_cost===null?'Sem cadastro':money.format(row.direct_cost)}</td>
            <td>{row.result===null?'Aguardando custos':money.format(row.result)}</td>
            <td><button type="button" className="secondary" disabled={busy}
              aria-label={'Editar custos do pedido '+row.reference} onClick={()=>void openCostEditor(row)}>Editar custos</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <nav className="dispatch-actions" aria-label="Páginas do resultado por pedido">
        <button type="button" disabled={busy||report.page===0} onClick={()=>goTo(report,report.page-1)}>Anterior</button>
        <span>Página {report.page+1}</span>
        <button type="button" disabled={busy||!report.hasMore} onClick={()=>goTo(report,report.page+1)}>Próxima</button>
      </nav>
    </>)}
  </section>;
}
