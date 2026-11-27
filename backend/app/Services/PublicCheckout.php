<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class PublicCheckout
{
    public function place(string $slug,array $data): array
    {
        $db=DB::connection('core_checkout');
        return $db->transaction(function() use($db,$slug,$data) {
            $db->statement("set local statement_timeout = '5s'");
            $db->statement("set local lock_timeout = '2s'");
            $db->selectOne("select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{\"role\":\"anon\"}',true)");
            $args=[$slug,$data['request_id'],$data['customer'],$data['phone'],$data['address']??'',json_encode($data['items'],JSON_THROW_ON_ERROR),$data['fulfillment'],$data['payment'],$data['notes']??''];
            $base='cast(? as text),cast(? as uuid),cast(? as text),cast(? as text),cast(? as text),cast(? as jsonb),cast(? as text),cast(? as text),cast(? as text)';
            $schedule=$data['scheduled_for']??null;
            $loyalty=(bool)($data['loyalty']??false);
            $coupon=$data['coupon']??'';
            $reward=$data['reward']??'';
            $referral=$data['referral_code']??'';
            if(isset($data['expected_cents'],$data['price_revision'])) {
                $sql="select public.pitacco_confirm_priced_public_checkout($base,cast(? as bigint),cast(? as bigint),cast(? as text),cast(? as text),cast(? as text),cast(? as uuid),cast(? as timestamptz),cast(? as boolean)) as payload";
                array_push($args,$data['expected_cents'],$data['price_revision'],$referral,$coupon,$reward,$data['quote_id']??null,$schedule,$loyalty?'true':'false');
            } elseif($loyalty) {
                $sql="select public.pitacco_loyalty_checkout($base,cast(? as text),cast(? as text),cast(? as text),cast(? as uuid),cast(? as timestamptz),null) as payload";
                array_push($args,$referral,$coupon,$reward,$data['quote_id']??null,$schedule);
            } elseif($data['fulfillment']==='delivery') {
                $sql="select public.pitacco_checkout_quoted_delivery($base,cast(? as uuid),cast(? as timestamptz)) as payload";
                array_push($args,$data['quote_id'],$schedule);
            } elseif($schedule!==null) {
                $sql="select public.pitacco_checkout_scheduled_order($base,cast(? as timestamptz)) as payload";
                $args[]=$schedule;
            } else {
                $sql="select public.checkout_public_order($base) as payload";
            }
            $result=json_decode($db->selectOne($sql,$args)->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result) || (!isset($result['error']) && !isset($result['order_id'],$result['tracking_token'],$result['total']))) throw new UnexpectedValueException('Invalid checkout result');
            return $result;
        });
    }

    public function recover(string $slug,string $request): array
    {
        $db=DB::connection('core_checkout');
        return $db->transaction(function() use($db,$slug,$request) {
            $db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $row=$db->selectOne('select public.pitacco_public_checkout_recovery(cast(? as text),cast(? as uuid)) as payload',[$slug,$request]);
            $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result) || !array_key_exists('confirmed',$result)) throw new UnexpectedValueException('Invalid recovery result');
            return $result;
        });
    }
}
