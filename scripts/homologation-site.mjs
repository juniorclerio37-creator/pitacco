import {readdir,readFile,writeFile} from 'node:fs/promises';
import {validateConnection} from '../web/config.mjs';

const productionUrl='https://mdevzehqcpcgxspwbiyz.supabase.co';
const productionKey='sb_publishable_JLIp1y5II26GrztrKDNIyQ_ryETrCuj';
const url=(process.env.VITE_SUPABASE_URL||'').trim().replace(/\/$/,'');
const key=(process.env.VITE_SUPABASE_ANON_KEY||'').trim();
if(validateConnection(url,key)||url.toLowerCase()===productionUrl||key===productionKey){
 throw Error('Configure a URL e a chave pública de um Supabase de homologação diferente da produção.');
}
if(process.argv[2]==='apply'){
 const root='web/dist-homologacao';
 const banner='<div role="status" style="background:#7c2d12;color:white;padding:.65rem;text-align:center;font:600 1rem system-ui">Ambiente de homologação</div>';
 const paths=await readdir(root,{recursive:true});
 for(const path of paths.filter(path=>path.endsWith('.html'))){
  const original=await readFile(root+'/'+path,'utf-8');
  const updated=original.replaceAll(productionUrl,url).replaceAll(productionKey,key)
   .replace(/<body\b[^>]*>/i,body=>body+banner);
  await writeFile(root+'/'+path,updated);
 }
 const contents=await Promise.all(paths.filter(path=>/\.(html|m?js)$/.test(path)).map(path=>readFile(root+'/'+path,'utf-8')));
 if(contents.some(content=>content.includes(productionUrl)||content.includes(productionKey))){
  throw Error('O build de homologação contém uma conexão de produção.');
 }
 for(const path of ['cardapio/index.html','acompanhar/index.html','cadastro/index.html']){
  if(!(await readFile(root+'/'+path,'utf-8')).includes(url))throw Error('A página '+path+' não aponta para o Supabase de homologação.');
 }
}
