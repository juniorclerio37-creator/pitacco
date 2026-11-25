"""Register and confirm Windows physical printer tests; no browser-side test controls.

Applied after the existing native print overlays, without changing
printing, order acceptance, or the Windows spooler integration.
"""
from pathlib import Path

p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
s="import {buildPhysicalReceiptTest} from './receiptTestSample.mjs';\n"+s

def change(old,new):
 global s
 count=s.count(old)
 assert count==1, f'Windows paper-confirmation anchor changed ({count}): {old[:95]}'
 s=s.replace(old,new,1)

change(" const rpc=async(name,args)=>",
""" const [physicalPrintCheck,setPhysicalPrintCheck]=useState(null);
 const [physicalPrintFeedback,setPhysicalPrintFeedback]=useState('');
 useEffect(()=>{setPhysicalPrintCheck(null);setPhysicalPrintFeedback('')},[storeId,device]);
 const rpc=async(name,args)=>""")

change(" async function saveMode(source,mode,enabled){",
""" async function runWindowsPhysicalTest(sector){
  if(!desktop||!device||!manager)return setError('Abra o aplicativo Windows e entre na sua loja para executar o teste.');
  await act(async()=>{
   setPhysicalPrintCheck(null);setPhysicalPrintFeedback('');
   const {receipt,warnings}=await buildPhysicalReceiptTest({client,storeId,storeName,storeLogoPath,width:Number(sector.width)});
   const result=await invoke('test_printer',{printerName:sector.printer,width:Number(sector.width),receipt});
   setStatus([String(result),...warnings].join(' '));
   const {data,error}=await client.rpc('pitacco_windows_print_check_started',{
    p_store:storeId,p_device:device,p_printer:sector.printer,p_width:Number(sector.width)
   });
   if(error){
    setPhysicalPrintFeedback('O Windows enviou o teste ao spooler, mas não foi possível registrar o resultado no servidor. '+error.message);
    return;
   }
   if(!data?.test_id)throw Error('O Windows enviou o teste, mas o registro do servidor não foi confirmado.');
   setPhysicalPrintCheck({id:data.test_id,printer:sector.printer,width:sector.width,storeId});
  });
 }
 async function confirmWindowsPhysicalTest(outcome){
  if(!desktop||!physicalPrintCheck||physicalPrintCheck.storeId!==storeId)return;
  await act(async()=>{
   await rpc('pitacco_windows_print_check_confirm',{
    p_store:storeId,p_test:physicalPrintCheck.id,p_outcome:outcome
   });
   setPhysicalPrintFeedback(outcome==='printed'
    ?'Confirmação registrada pelo operador: o cupom saiu no papel. Isso não valida a impressão automática após o aceite.'
    :outcome==='failed'
    ?'Operador registrou que não houve impressão física. Verifique papel, driver, cabo, spooler e impressora selecionada.'
    :'Resultado incerto. Confira o spooler e o papel antes de realizar um novo teste.');
   setPhysicalPrintCheck(null);
  });
 }
 async function saveMode(source,mode,enabled){""")

# The earlier printer UX overlay intentionally removes the legacy test panel.
# Restore one *native-only* test panel after every print overlay, without
# bringing back the removed error queue or altering existing device settings.
change(' </div>:<>\n  <WindowsConnectionStatus client={client} storeId={storeId} onNavigate={onNavigate}/>',
'''   <section className="panel" aria-label="Teste físico de impressora no Windows">
     <h3>Teste de impressão física</h3>
     <p>Imprima um pedido fictício com as preferências salvas da loja: fonte, logo, QR Code, complementos, valores e troco. Nenhuma venda será registrada. Confira o papel antes de confirmar o resultado.</p>
     {sectors.map(sector=><div className="line" key={'test:'+sector.sector}>
       <b>{sector.sector}</b>
       <span>{sector.printer} · {sector.width} mm</span>
       <button type="button" disabled={busy||!device} onClick={()=>runWindowsPhysicalTest(sector)}>Testar impressão</button>
     </div>)}
     {!sectors.length&&<p>Cadastre uma impressora acima para testar.</p>}
     {physicalPrintCheck&&<div className="windows-print-confirmation" aria-label="Confirmar impressão física">
       <h4>O cupom de teste saiu no papel?</h4>
       <p>Impressora: {physicalPrintCheck.printer} · {physicalPrintCheck.width} mm. Confira o papel antes de responder.</p>
       <div className="quick-actions">
        <button type="button" disabled={busy} onClick={()=>confirmWindowsPhysicalTest('printed')}>Sim, imprimiu no papel</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>confirmWindowsPhysicalTest('failed')}>Não imprimiu</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>confirmWindowsPhysicalTest('uncertain')}>Não tenho certeza</button>
       </div>
     </div>}
     {physicalPrintFeedback&&<p role="status">{physicalPrintFeedback}</p>}
   </section>
 </div>:<>
  <WindowsConnectionStatus client={client} storeId={storeId} onNavigate={onNavigate}/>''')

p.write_text(s,encoding='utf-8')
