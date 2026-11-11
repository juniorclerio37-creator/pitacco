"""Keep order synchronization healthy when printer binding or spooler fails."""
from pathlib import Path
p=Path('web/Operations.jsx')
s=p.read_text(encoding='utf-8')
start=s.index("    if(desktop&&device){\n     const remote=await rpc('claim_print_jobs'")
end=s.index("\n   }catch(e){if(!stopped){setStatus('Sincronização pendente",start)
original=s[start:end]
assert "await ingestJobs(" in original
assert "await rpc('ack_print_job'" in original
replacement="""    if(desktop&&device){
     // Printing is a separate subsystem. A duplicate local job, missing
     // binding or disconnected printer must not mark order sync as failed.
     try{
      const remote=await rpc('claim_print_jobs',{p_store:storeId,p_device:device});
      if(stopped)return;
      await ingestJobs({jobs:remote||[],device,call:invoke,ack:args=>rpc('ack_print_job',args)});
      const local=await invoke('list_jobs');
      if(stopped)return;
      setJobs(local.filter(j=>j.store_id===storeId));
      for(const job of local.filter(j=>j.store_id===storeId)){
       if(['submitted','error','uncertain'].includes(job.state)){
        try{
         await rpc('ack_print_job',{p_job:job.id,p_device:device,p_state:job.state,p_error:job.error||null});
        }catch(ackError){
         setError('Confirmação de impressão pendente: '+String(ackError?.message||ackError));
        }
        const key=`${job.id}:${job.state}`;
        if(job.state!=='submitted'&&!notifySeen.current.has(key)){
         notifySeen.current.add(key);
         invoke('notify',{message:'Falha de impressão. Consulte a fila do Pitacco.'}).catch(()=>{});
        }
       }
      }
     }catch(printError){
      if(!stopped){
       setStatus('Pedidos sincronizados · impressão pendente');
       setError('Impressão: '+String(printError?.message||printError));
      }
     }
    }"""
s=s[:start]+replacement+s[end:]
p.write_text(s,encoding='utf-8')
