<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class PaymentSettings
{
    public function run(object $session,string $store,?array $data): array
    {
        $db=DB::connection('core_payment_settings');
        return $db->transaction(function() use($db,$session,$store,$data){
            if($data===null)$db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            $db->selectOne("select set_config('request.jwt.claim.sub', ?, true), set_config('request.jwt.claims', ?, true), set_config('pitacco.core_session_id', ?, true)",[
                $session->user_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated','aal'=>'aal1'],JSON_THROW_ON_ERROR),$session->session_id
            ]);
            abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed,404);
            if($data===null){
                $row=$db->selectOne('select core_auth.payment_settings_fixture(cast(? as uuid)) as payload',[$store]);
            }else{
                // Values are restricted to a fixed allowlist before PostgreSQL array encoding.
                $row=$db->selectOne('select public.pitacco_save_payment_methods_only(cast(? as uuid),cast(? as text[]),cast(? as text[]),cast(? as text)) as payload',[
                    $store,'{'.implode(',',$data['payment_methods']).'}','{'.implode(',',$data['pdv_payment_methods']).'}',$data['pix_instructions']??''
                ]);
            }
            abort_if($row?->payload===null,404);
            $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result)||!isset($result['payment_methods'],$result['pdv_payment_methods']))throw new UnexpectedValueException('Invalid payment settings contract');
            return array_intersect_key($result,array_flip(['saved','payment_methods','pdv_payment_methods','pix_instructions']));
        });
    }
}
