<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class FiadoOverview
{
    public function read(object $session,string $store): array
    {
        $db=DB::connection('core_fiado_read');
        return $db->transaction(function() use($db,$session,$store) {
            $db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            $db->selectOne("select set_config('request.jwt.claim.sub', ?, true), set_config('request.jwt.claims', ?, true), set_config('pitacco.core_session_id', ?, true)",[
                $session->user_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated','aal'=>'aal1'],JSON_THROW_ON_ERROR),$session->session_id
            ]);
            $allowed=$db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store]);
            abort_unless($allowed?->allowed,404);
            $row=$db->selectOne('select public.pitacco_fiado_overview(cast(? as uuid)) as payload',[$store]);
            $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result)||!isset($result['customers'],$result['charges'],$result['payments'])) throw new UnexpectedValueException('Invalid Fiado contract');
            return $result;
        });
    }
}
