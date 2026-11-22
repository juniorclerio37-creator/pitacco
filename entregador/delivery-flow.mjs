// The same courier flow applies to every order assigned to the shop's courier.
// This only selects which action the interface shows. All writes and code checks
// remain enforced by the authenticated Supabase RPC / official marketplace.
export function courierActionStage(delivery) {
 const d=delivery||{};
 if(d.status==="entregue"||d.status==="cancelada")return "terminal";
 if(d.status==="atribuida"||(d.status==="aceita"&&!d.collected_at))return "collect";
 if(d.status==="aceita"&&d.collected_at)return "depart";
 if(d.status==="retirada"&&!d.arrived_at)return "arrive";
 if(d.status==="retirada"&&d.arrived_at)return "code";
 return "pending";
}
export function courierProgress(delivery) {
 const d=delivery||{},stage=courierActionStage(d),completed=d.status==="entregue";
 const collected=Boolean(d.collected_at)||completed;
 const arrived=Boolean(d.arrived_at)||completed;
 const codeChecked=Boolean(d.delivery_code_verified_at)||completed;
 return [
  {label:"Coleta",done:collected,active:stage==="collect"},
  {label:"Chegada",done:arrived,active:stage==="arrive"},
  {label:"Código",done:codeChecked,active:stage==="code"},
  {label:"Finalizar",done:completed,active:stage==="code"}
 ];
}
