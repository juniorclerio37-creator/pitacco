import React, {useEffect, useRef, useState} from 'react';

const formatQuantity = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 3}).format;
const formatDate = new Intl.DateTimeFormat('pt-BR', {dateStyle: 'short', timeStyle: 'short'}).format;
const costNumber = new Intl.NumberFormat('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:6});

export default function Inventory({client, storeId, manager, products, initialView='Insumos'}) {
  const [ingredients, setIngredients] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [optionRecipes, setOptionRecipes] = useState([]);
  const [unitCosts, setUnitCosts] = useState([]);
  const [optionGroups, setOptionGroups] = useState([]);
  const [catalogOptions, setCatalogOptions] = useState([]);
  const [movements, setMovements] = useState([]);
  const [view, setView] = useState(initialView);
  const [productId, setProductId] = useState('');
  const [optionId, setOptionId] = useState('');
  const [editing, setEditing] = useState(null);
  const [costEditing, setCostEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const requestVersion = useRef(0);
  const saving = useRef(false);
  const movementAttempt = useRef(null);

  async function reload() {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const results = await Promise.all([
        client.from('pitacco_ingredients').select('*').eq('store_id',storeId).order('name'),
        client.from('pitacco_recipe_lines').select('*').eq('store_id',storeId),
        client.from('pitacco_stock_movements').select('*').eq('store_id',storeId).order('created_at',{ascending:false}).limit(50),
        client.from('pitacco_option_recipe_lines').select('*').eq('store_id',storeId),
        client.from('product_option_groups').select('id,product_id,name,sort_order').eq('store_id',storeId).order('sort_order'),
        client.from('product_options').select('id,group_id,name,available,sort_order').eq('store_id',storeId).order('sort_order'),
        manager
          ?client.from('pitacco_ingredient_unit_costs').select('ingredient_id,cost_per_unit').eq('store_id',storeId)
          :Promise.resolve({data:[],error:null})
      ]);
      if (requestVersion.current !== version) return;
      const error = results.find(result=>result.error)?.error;
      if (error) throw error;
      setIngredients(results[0].data);
      setRecipes(results[1].data);
      setMovements(results[2].data);
      setOptionRecipes(results[3].data||[]);
      setOptionGroups(results[4].data||[]);
      setCatalogOptions(results[5].data||[]);
      setUnitCosts(results[6].data||[]);
      setFailure('');
    } catch (error) {
      if (requestVersion.current === version) setFailure(error.message || 'Não foi possível carregar o estoque.');
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }

  useEffect(()=>{
    reload();
    return ()=>{++requestVersion.current;};
  }, [storeId]);

  async function save(operation, success, after) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setMessage('');
    setFailure('');
    try {
      const {error} = await operation;
      if (error) throw error;
      after?.();
      setMessage(success);
      await reload();
    } catch (error) {
      setFailure(error.message || 'Não foi possível salvar a alteração.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function saveIngredient(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = {name:String(data.get('name')).trim(), minimum:Number(data.get('minimum'))};
    const table = client.from('pitacco_ingredients');
    const operation = editing
      ? table.update(values).eq('store_id',storeId).eq('id',editing.id).select('id').single()
      : table.insert({...values,store_id:storeId,unit:data.get('unit')});
    save(operation, 'Insumo salvo.', ()=>{setEditing(null);form.reset();});
  }

  function saveRecipe(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ingredientId = data.get('ingredient');
    const quantity = Number(data.get('quantity'));
    const exists = recipes.some(row=>row.product_id===productId&&row.ingredient_id===ingredientId);
    const table = client.from('pitacco_recipe_lines');
    const operation = exists
      ? table.update({quantity}).eq('store_id',storeId).eq('product_id',productId).eq('ingredient_id',ingredientId).select('product_id').single()
      : table.insert({store_id:storeId,product_id:productId,ingredient_id:ingredientId,quantity});
    save(operation, 'Ficha técnica atualizada.', ()=>form.reset());
  }

  function saveOptionRecipe(event) {
    event.preventDefault();
    const form=event.currentTarget;
    const data=new FormData(form);
    const ingredientId=String(data.get('ingredient'));
    const quantity=Number(data.get('quantity'));
    if(!selectedOption||!manager||!Number.isFinite(quantity)||quantity<=0) {
      setFailure('Selecione um complemento e informe uma quantidade válida.');
      return;
    }
    const exists=optionRecipes.some(row=>row.option_id===selectedOption.id&&row.ingredient_id===ingredientId);
    const table=client.from('pitacco_option_recipe_lines');
    const operation=exists
      ?table.update({quantity}).eq('store_id',storeId).eq('option_id',selectedOption.id).eq('ingredient_id',ingredientId).select('option_id').single()
      :table.insert({store_id:storeId,option_id:selectedOption.id,ingredient_id:ingredientId,quantity});
    save(operation,'Ficha técnica do complemento atualizada.',()=>form.reset());
  }

  function saveUnitCost(event) {
    event.preventDefault();
    if(!manager||!costEditing)return;
    const form=event.currentTarget;
    const cost=Number(new FormData(form).get('unit_cost'));
    if(!Number.isFinite(cost)||cost<0||cost>100000){
      setFailure('O preço por unidade deve ser um número válido.');
      return;
    }
    save(client.from('pitacco_ingredient_unit_costs').upsert({
      store_id:storeId,ingredient_id:costEditing.id,cost_per_unit:cost
    },{onConflict:'store_id,ingredient_id'}),'Custo unitário salvo para os próximos pedidos.',
      ()=>setCostEditing(null));
  }

  function saveMovement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const quantity = Number(data.get('quantity')) * (data.get('direction')==='saida' ? -1 : 1);
    const movement = {store_id:storeId, ingredient_id:data.get('ingredient'), quantity, reason:String(data.get('reason')).trim()};
    const payload = JSON.stringify(movement);
    if (movementAttempt.current?.payload !== payload) {
      movementAttempt.current = {id:crypto.randomUUID(),payload};
    }
    const operation = client.from('pitacco_stock_movements').upsert(
      {id:movementAttempt.current.id,...movement}, {onConflict:'id',ignoreDuplicates:true}
    );
    save(operation, 'Movimentação registrada.', ()=>{movementAttempt.current=null;form.reset();});
  }

  const ingredientById = new Map(ingredients.map(item=>[item.id,item]));
  const unitCostById = new Map(unitCosts.map(item=>[item.ingredient_id,Number(item.cost_per_unit)]));
  const stockOptions = ingredients.map(item=><option key={item.id} value={item.id}>{item.name} ({item.unit})</option>);
  const shortages = ingredients.filter(item=>Number(item.balance)<=Number(item.minimum));
  const visibleRecipe = recipes.filter(row=>row.product_id===productId);
  const groupsForProduct=optionGroups.filter(group=>group.product_id===productId);
  const groupNames=new Map(groupsForProduct.map(group=>[group.id,group.name]));
  const optionsForProduct=catalogOptions.filter(option=>groupNames.has(option.group_id));
  const selectedOption=optionsForProduct.find(option=>option.id===optionId)||null;
  const visibleOptionRecipe=optionRecipes.filter(row=>row.option_id===selectedOption?.id);
  return <section className="panel" aria-label="Controle de estoque" aria-busy={loading||busy}>
    <div className="pitacco-local-tabs" role="group" aria-label="Seções de estoque">
      {['Insumos','Fichas técnicas','Complementos','Movimentações'].map(tab=><button key={tab} type="button" aria-pressed={view===tab} className={view===tab?'active':'secondary'} onClick={()=>setView(tab)}>{tab}</button>)}
    </div>
    {loading&&<p role="status">Carregando estoque…</p>}
    {message&&<p role="status">{message}</p>}
    {failure&&<p role="alert">{failure} <button type="button" className="secondary" onClick={reload} disabled={busy||loading}>Atualizar dados</button></p>}
    {view==='Insumos'&&<>
      <h3>Saldos e estoque mínimo</h3>
      {manager&&<p>Cadastre o custo de compra por <strong>g, ml ou unidade</strong> em cada insumo para calcular o custo dos pedidos futuros. Embalagens também podem ser cadastradas como insumo na unidade <strong>un</strong>. Custos não informados não serão presumidos.</p>}
      {!loading&&shortages.length>0&&<p role="status">{shortages.length} {shortages.length===1?'insumo no saldo mínimo ou abaixo':'insumos no saldo mínimo ou abaixo'}.</p>}
      {manager&&<form key={editing?.id||'new'} onSubmit={saveIngredient}>
        <label>Nome <input name="name" required maxLength={120} defaultValue={editing?.name}/></label>
        {!editing&&<label>Unidade <select name="unit"><option value="g">Gramas</option><option value="ml">Mililitros</option><option value="un">Unidades</option></select></label>}
        <label>Estoque mínimo <input name="minimum" type="number" min="0" max="1000000" step="0.001" required defaultValue={editing?.minimum??0}/></label>
        <button disabled={busy||loading}>{editing?'Salvar insumo':'Cadastrar insumo'}</button>
        {editing&&<button type="button" className="secondary" onClick={()=>setEditing(null)} disabled={busy}>Cancelar edição</button>}
      </form>}
      {!loading&&!failure&&!ingredients.length&&<p>Nenhum insumo cadastrado.</p>}
      <ul>{ingredients.map(item=><li key={item.id}>
        <strong>{item.name}</strong> · {formatQuantity(item.balance)} {item.unit} · mínimo {formatQuantity(item.minimum)} {item.unit}
        {Number(item.balance)<=Number(item.minimum)&&<strong> · Estoque baixo</strong>}
        {manager&&<>
          <span> · {unitCostById.has(item.id)
            ?'Custo: R$ '+costNumber.format(unitCostById.get(item.id))+'/'+item.unit
            :'Custo não cadastrado'}</span>
          <button type="button" className="secondary" disabled={busy} onClick={()=>setCostEditing(item)}
            aria-label={'Editar custo de '+item.name}>Custo por {item.unit}</button>
          <button type="button" className="secondary" disabled={busy} onClick={()=>setEditing(item)}
            aria-label={'Editar '+item.name}>Editar</button>
        </>}
      </li>)}</ul>
      {manager&&costEditing&&<form key={costEditing.id} onSubmit={saveUnitCost}
        aria-label={'Custo unitário de '+costEditing.name}>
        <h4>Preço de compra — {costEditing.name}</h4>
        <p>Informe o preço de <strong>1 {costEditing.unit}</strong> em reais. Exemplo: um pote de 350 g por R$ 14,00 equivale a R$ 0,04/g. O novo preço não altera pedidos já aceitos.</p>
        <label>R$ por {costEditing.unit}
          <input name="unit_cost" type="number" min="0" max="100000" step="0.000001"
            required defaultValue={unitCostById.get(costEditing.id)??''} />
        </label>
        <button disabled={busy||loading}>Salvar custo para próximos pedidos</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>setCostEditing(null)}>Cancelar</button>
      </form>}
    </>}
    {view==='Fichas técnicas'&&<>
      <h3>Ingredientes por unidade vendida</h3>
      <p>Cadastre também a embalagem como insumo na unidade <strong>un</strong>, quando consumida por unidade do produto.</p>
      <label>Produto <select value={productId} onChange={event=>setProductId(event.target.value)}>
        <option value="">Selecione</option>{products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}
      </select></label>
      {productId&&manager&&<form onSubmit={saveRecipe}>
        <label>Insumo <select name="ingredient" required><option value="">Selecione</option>{stockOptions}</select></label>
        <label>Quantidade por unidade <input name="quantity" type="number" required min="0.001" max="1000000" step="0.001"/></label>
        <button disabled={busy||loading||!ingredients.length}>Salvar quantidade</button>
      </form>}
      {productId&&!loading&&!visibleRecipe.length&&<p>Este produto ainda não tem ficha técnica.</p>}
      <ul>{visibleRecipe.map(line=>{
        const ingredient = ingredientById.get(line.ingredient_id);
        return <li key={line.ingredient_id}>
          <strong>{ingredient?.name}</strong> · {formatQuantity(line.quantity)} {ingredient?.unit}
          {manager&&<button type="button" className="secondary" disabled={busy}
            aria-label={'Remover '+ingredient?.name+' da ficha'}
            onClick={()=>save(client.from('pitacco_recipe_lines').delete().eq('store_id',storeId).eq('product_id',productId).eq('ingredient_id',line.ingredient_id).select('ingredient_id').single(),'Insumo removido da ficha.')}>Remover</button>}
        </li>;
      })}</ul>
    </>}
    {view==='Complementos'&&<>
      <h3>Ficha técnica de cada complemento</h3>
      <p>Associe ingredientes aos adicionais existentes do cardápio. O consumo será contabilizado quando o pedido for aceito, sem lançar estoque de pedidos anteriores.</p>
      <label>Produto <select value={productId} onChange={event=>{setProductId(event.target.value);setOptionId('');}}>
        <option value="">Selecione</option>{products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}
      </select></label>
      {productId&&<>
        <label>Complemento <select value={selectedOption?.id||''} onChange={event=>setOptionId(event.target.value)}>
          <option value="">Selecione</option>
          {optionsForProduct.map(option=><option key={option.id} value={option.id}>
            {groupNames.get(option.group_id)} · {option.name}{option.available?'':' (indisponível)'}
          </option>)}
        </select></label>
        {!loading&&!optionsForProduct.length&&<p>Este produto ainda não possui complementos cadastrados.</p>}
      </>}
      {selectedOption&&<>
        <h4>{selectedOption.name} — consumo por seleção</h4>
        {manager&&<form onSubmit={saveOptionRecipe}>
          <label>Insumo <select name="ingredient" required><option value="">Selecione</option>{stockOptions}</select></label>
          <label>Quantidade por complemento <input name="quantity" type="number" required min="0.001" max="1000000" step="0.001"/></label>
          <button disabled={busy||loading||!ingredients.length}>Salvar ingrediente do complemento</button>
        </form>}
        {!loading&&!visibleOptionRecipe.length&&<p>Este complemento ainda não tem ficha técnica. O sistema não presumirá ingredientes.</p>}
        <ul>{visibleOptionRecipe.map(line=>{
          const ingredient=ingredientById.get(line.ingredient_id);
          return <li key={line.ingredient_id}>
            <strong>{ingredient?.name||'Insumo indisponível'}</strong> · {formatQuantity(line.quantity)} {ingredient?.unit||''}
            {manager&&<button type="button" className="secondary" disabled={busy}
              aria-label={'Remover '+(ingredient?.name||'insumo')+' do complemento'}
              onClick={()=>save(client.from('pitacco_option_recipe_lines').delete()
                .eq('store_id',storeId).eq('option_id',selectedOption.id)
                .eq('ingredient_id',line.ingredient_id).select('ingredient_id').single(),
                'Insumo removido do complemento.')}>Remover</button>}
          </li>;
        })}</ul>
      </>}
    </>}
    {view==='Movimentações'&&<>
      <h3>Entradas, saídas e consumo por pedido</h3>
      {manager&&<form onSubmit={saveMovement}>
        <label>Insumo <select name="ingredient" required><option value="">Selecione</option>{stockOptions}</select></label>
        <label>Operação <select name="direction"><option value="entrada">Entrada</option><option value="saida">Saída</option></select></label>
        <label>Quantidade <input name="quantity" type="number" required min="0.001" max="1000000" step="0.001"/></label>
        <label>Motivo <input name="reason" required maxLength={240}/></label>
        <button disabled={busy||loading||!ingredients.length}>Registrar movimentação</button>
      </form>}
      {!loading&&!failure&&!movements.length&&<p>Nenhuma movimentação registrada.</p>}
      {movements.length>0&&<><h4>Últimas 50 movimentações</h4><ul>{movements.map(row=><li key={row.id}>
        <strong>{ingredientById.get(row.ingredient_id)?.name}</strong> · {formatQuantity(row.quantity)} {ingredientById.get(row.ingredient_id)?.unit} · {row.reason}
        {row.order_id&&' · Pedido '+row.order_id.slice(0,8).toUpperCase()} · {formatDate(new Date(row.created_at))}
      </li>)}</ul></>}
    </>}
  </section>;
}
