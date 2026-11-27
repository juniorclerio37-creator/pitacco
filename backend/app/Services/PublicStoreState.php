<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class PublicStoreState
{
    public function read(string $slug,string $resource): object
    {
        $query=match($resource){
            'opening'=>'select public.pitacco_public_store_open(cast(? as text)) as payload',
            'payment-prices'=>'select public.pitacco_public_payment_price_rules(cast(? as text)) as payload',
        };
        $db=DB::connection('menu');
        return $db->transaction(function() use($db,$slug,$resource,$query){
            $db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            $row=$db->selectOne($query,[$slug]);
            $data=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($data))throw new UnexpectedValueException('Invalid public store state');
            if($resource==='opening'){
                if(!is_bool($data['open']??null))throw new UnexpectedValueException('Invalid opening status');
                return (object)array_intersect_key($data,array_flip(['open','reason','paused','accepts_scheduled','scheduling_available','next_open_at','weekly_periods','configured','timezone']));
            }
            foreach($data as $method=>$rule){
                if(!is_string($method)||!is_array($rule)||!is_int($rule['adjustment_bps']??null)||!is_int($rule['revision']??null))throw new UnexpectedValueException('Invalid active price rules');
                $data[$method]=array_intersect_key($rule,array_flip(['adjustment_bps','revision']));
            }
            return (object)$data;
        });
    }
}
