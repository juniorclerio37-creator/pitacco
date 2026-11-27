<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class MerchantCheckout
{
    public function place(object $session,string $store,array $data): array
    {
        $db=DB::connection('core_merchant_checkout');
        return $db->transaction(function() use($db,$session,$store,$data){
            $db->statement("set local statement_timeout = '5s'");
            $db->statement("set local lock_timeout = '2s'");
            $db->selectOne("select set_config('request.jwt.claim.sub', ?, true), set_config('request.jwt.claims', ?, true), set_config('pitacco.core_session_id', ?, true)",[
                $session->user_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated','aal'=>'aal1'],JSON_THROW_ON_ERROR),$session->session_id
            ]);
            abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed,404);
            // The disposable wrapper calls the original merchant channel checkout.
            // No collected amount, credit account or provider request is accepted.
            $row=$db->selectOne('select core_auth.merchant_checkout_fixture(cast(? as uuid),cast(? as uuid),cast(? as text),cast(? as text),cast(? as text),cast(? as jsonb),cast(? as text),cast(? as text)) as payload',[
                $store,$data['request_id'],$data['sale_mode'],$data['customer'],$data['phone'],json_encode($data['items'],JSON_THROW_ON_ERROR),$data['payment'],$data['notes']??''
            ]);
            $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result)||(!isset($result['error'])&&!isset($result['order_id'],$result['total'])))throw new UnexpectedValueException('Invalid merchant checkout result');
            if(isset($result['error']))return ['error'=>'checkout_not_confirmed'];
            return array_intersect_key($result,array_flip(['order_id','total','status','payment_status','subtotal','discount','delivery_fee']));
        });
    }
}
