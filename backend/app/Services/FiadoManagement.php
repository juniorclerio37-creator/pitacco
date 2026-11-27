<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
final class FiadoManagement
{
    public function run(object $session,string $store,array $data): array
    {
        $db=DB::connection('core_fiado_manage');
        return $db->transaction(function() use($db,$session,$store,$data) {
            $db->statement("set local statement_timeout = '5s'");
            $db->statement("set local lock_timeout = '2s'");
            $db->selectOne("select set_config('request.jwt.claim.sub', ?, true), set_config('request.jwt.claims', ?, true), set_config('pitacco.core_session_id', ?, true)",[
                $session->user_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated','aal'=>'aal1'],JSON_THROW_ON_ERROR),$session->session_id
            ]);
            $allowed=$db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store]);
            abort_unless($allowed?->allowed,404);
            // Explicit operations only; the existing SQL enforces business rules and audit.
            if($data['action']==='toggle'){
                $row=$db->selectOne('select public.pitacco_fiado_toggle(cast(? as uuid),cast(? as boolean)) as enabled',[$store,$data['enabled']?'true':'false']);
                return ['enabled'=>(bool)$row->enabled];
            }
            if($data['action']==='approve'){
                $row=$db->selectOne('select public.pitacco_fiado_approve(cast(? as uuid),cast(? as uuid),cast(? as boolean)) as decided',[$store,$data['order_id'],$data['approve']?'true':'false']);
                return ['decided'=>(bool)$row->decided];
            }
            if($data['action']==='receive'){
                $row=$db->selectOne('select public.pitacco_fiado_receive(cast(? as uuid),cast(? as uuid),cast(? as numeric),cast(? as text),cast(? as uuid),cast(? as text)) as payload',[
                    $store,$data['customer_id'],$data['amount'],$data['method'],$data['request_id'],$data['note']??''
                ]);
                return json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            }
            $row=$db->selectOne('select public.pitacco_fiado_save_customer(cast(? as uuid),cast(? as text),cast(? as text),cast(? as numeric),cast(? as boolean),cast(? as integer),cast(? as text),cast(? as boolean)) as customer_id',[
                $store,$data['name'],$data['phone'],$data['limit'],$data['enabled']?'true':'false',$data['due_days'],$data['approval_mode'],$data['block_overdue']?'true':'false'
            ]);
            return ['customer_id'=>$row->customer_id];
        });
    }
}
