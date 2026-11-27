<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class OpeningHours
{
    public function run(object $session,string $store,?array $data): array
    {
        $db=DB::connection('core_opening_hours');
        return $db->transaction(function() use($db,$session,$store,$data){
            if($data===null)$db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '5s'");
            $db->statement("set local lock_timeout = '2s'");
            $db->selectOne("select set_config('request.jwt.claim.sub', ?, true), set_config('request.jwt.claims', ?, true), set_config('pitacco.core_session_id', ?, true)",[
                $session->user_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated','aal'=>'aal1'],JSON_THROW_ON_ERROR),$session->session_id
            ]);
            abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed,404);
            if($data!==null){
                $db->selectOne('select public.pitacco_store_hours_save_v2(cast(? as uuid),cast(? as jsonb),cast(? as boolean),cast(? as integer),cast(? as boolean))',[
                    $store,json_encode($data['periods'],JSON_THROW_ON_ERROR),$data['paused']?'true':'false',$data['expected_revision'],$data['accepts_scheduled']?'true':'false']);
            }
            $row=$db->selectOne('select public.pitacco_store_hours_state(cast(? as uuid)) as payload',[$store]);
            $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result)||!isset($result['periods'],$result['paused'],$result['revision'],$result['current']))throw new UnexpectedValueException('Invalid opening hours');
            return array_intersect_key($result,array_flip(['periods','paused','manager_configured','revision','current']));
        });
    }
}
