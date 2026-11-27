<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class CustomerProfile
{
    public function run(string $slug,array $data): array
    {
        $db=DB::connection('core_profile');
        return $db->transaction(function() use($db,$slug,$data) {
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            $row=$db->selectOne('select public.pitacco_v2_customer_profile(cast(? as text),cast(? as text),cast(? as text),cast(? as text),cast(? as text),cast(? as jsonb)) as payload',[
                $slug,$data['phone'],$data['device'],$data['action'],$data['name']??null,
                isset($data['addresses'])?json_encode($data['addresses'],JSON_THROW_ON_ERROR):null
            ]);
            $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result)) throw new UnexpectedValueException('Invalid profile contract');
            return $result;
        });
    }
}
