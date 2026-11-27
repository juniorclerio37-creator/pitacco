<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class PaymentPricing
{
    public function run(object $session,string $store,?array $data): array
    {
        $db=DB::connection('core_payment_pricing');
        return $db->transaction(function() use($db,$session,$store,$data){
            if($data===null)$db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            $db->selectOne("select set_config('request.jwt.claim.sub', ?, true), set_config('request.jwt.claims', ?, true), set_config('pitacco.core_session_id', ?, true)",[
                $session->user_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated','aal'=>'aal1'],JSON_THROW_ON_ERROR),$session->session_id
            ]);
            abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed,404);
            if($data===null){
                $row=$db->selectOne('select public.pitacco_payment_pricing_drafts(cast(? as uuid)) as payload, public.pitacco_payment_pricing_release_status(cast(? as uuid)) as release_enabled',[$store,$store]);
            }else{
                $row=$db->selectOne('select public.pitacco_save_payment_pricing_draft(cast(? as uuid),cast(? as text),cast(? as text),cast(? as integer),cast(? as integer),cast(? as bigint)) as payload',[
                    $store,$data['channel'],$data['method'],$data['adjustment_bps'],$data['processing_cost_bps'],$data['expected_revision']
                ]);
            }
            $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result))throw new UnexpectedValueException('Invalid pricing contract');
            $fields=array_flip(['channel','method','adjustment_bps','processing_cost_bps','revision','active_adjustment_bps','active_revision','updated_at']);
            if($data===null){
                if(!array_is_list($result))throw new UnexpectedValueException('Invalid pricing list');
                return ['drafts'=>array_map(static fn(array $r)=>array_intersect_key($r,$fields),$result),'publication_available'=>(bool)$row->release_enabled];
            }
            return array_intersect_key($result,$fields);
        });
    }
}
