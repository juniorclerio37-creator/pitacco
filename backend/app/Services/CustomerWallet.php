<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class CustomerWallet
{
    public function read(string $slug,string $device): ?array
    {
        // This function exists only in the disposable CI fixture.
        $db=DB::connection('core_wallet');
        return $db->transaction(function() use($db,$slug,$device){
            $db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            $row=$db->selectOne('select core_wallet_test.read_wallet(cast(? as text),cast(? as uuid)) as payload',[$slug,$device]);
            if($row->payload===null)return null;
            $data=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($data))throw new UnexpectedValueException('Invalid wallet contract');
            if(isset($data['error']))return ['error'=>'wallet_unavailable'];
            return array_intersect_key($data,array_flip(['linked','points','orders','cashback_cents','rules','referral_code','offers','history']));
        });
    }
}
