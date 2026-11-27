<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class DeliverySettings
{
    public function run(object $session,string $store,?array $data): array
    {
        $db=DB::connection('core_delivery_settings');
        return $db->transaction(function() use($db,$session,$store,$data){
            if($data===null)$db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '5s'");
            $db->statement("set local lock_timeout = '2s'");
            $db->selectOne("select set_config('request.jwt.claim.sub', ?, true), set_config('request.jwt.claims', ?, true), set_config('pitacco.core_session_id', ?, true)",[
                $session->user_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated','aal'=>'aal1'],JSON_THROW_ON_ERROR),$session->session_id
            ]);
            abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed,404);
            if($data!==null){
                if($data['mode']==='circle'){
                    $db->selectOne('select public.pitacco_save_delivery_zone_times(cast(? as uuid),cast(? as integer),cast(? as jsonb),cast(? as jsonb))',[
                        $store,$data['radius_km'],json_encode($data['distance_fees'],JSON_THROW_ON_ERROR),json_encode($data['distance_times'],JSON_THROW_ON_ERROR)]);
                }else{
                    $db->selectOne('select public.pitacco_save_delivery_polygons_times(cast(? as uuid),cast(? as jsonb))',[$store,json_encode($data['polygons'],JSON_THROW_ON_ERROR)]);
                }
            }
            $row=$db->selectOne('select core_auth.delivery_settings_fixture(cast(? as uuid)) as payload',[$store]);
            abort_if($row?->payload===null,404);
            $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result)||!isset($result['mode'],$result['enabled']))throw new UnexpectedValueException('Invalid delivery settings');
            return $result;
        });
    }
}
