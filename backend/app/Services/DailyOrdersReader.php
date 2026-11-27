<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
final class DailyOrdersReader
{
    public function get(object $session,string $store,int $limit,int $offset): array
    {
        $db=DB::connection('core_orders');
        return $db->transaction(function () use ($db,$session,$store,$limit,$offset) {
            $db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            // Identity comes only from the validated bearer session, not request parameters.
            $db->selectOne("select set_config('request.jwt.claim.sub', ?, true), set_config('pitacco.core_session_id', ?, true)",[$session->user_id,$session->session_id]);
            $authorized=$db->selectOne('select public.is_store_manager(cast(? as uuid)) as allowed',[$store]);
            if (!$authorized?->allowed) abort(404);
            return $db->select('select id,store_id,channel,gross,status,source,preparation_status,created_at from public.pitacco_daily_operational_orders(cast(? as uuid)) order by created_at desc,id desc limit ? offset ?',[$store,$limit,$offset]);
        });
    }
}
