<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
final class OwnOrderActions
{
    public function run(object $session,string $store,string $order,string $action,?string $reason): object
    {
        $db=DB::connection('core_actions');
        return $db->transaction(function() use($db,$session,$store,$order,$action,$reason) {
            $db->statement("set local statement_timeout = '5s'");
            $db->statement("set local lock_timeout = '2s'");
            $db->selectOne("select set_config('request.jwt.claim.sub', ?, true), set_config('request.jwt.claims', ?, true), set_config('pitacco.core_session_id', ?, true)",[
                $session->user_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated','aal'=>'aal1'],JSON_THROW_ON_ERROR),$session->session_id
            ]);
            // The local adapter also checks live membership and session at the database.
            $allowed=$db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store]);
            abort_unless($allowed?->allowed,404);
            $target=$db->selectOne('select source from public.orders where id=cast(? as uuid) and store_id=cast(? as uuid)',[$order,$store]);
            abort_unless($target,404);
            abort_if($target->source!=='proprio',409,'Use a integração oficial do marketplace.');
            // Enable only the disposable transactional outbox; never send on the request path.
            if (app()->environment('testing') && config('pitacco.order_outbox_enabled')) {
                $db->selectOne("select set_config('pitacco.core_order_outbox','on',true)");
            }
            // Fixed allowlist; original SQL functions perform locks, transition checks and audit.
            match($action) {
                'accept' => $db->selectOne('select public.accept_order(cast(? as uuid))',[$order]),
                'ready' => $db->selectOne("select public.set_order_preparation(cast(? as uuid), 'ready')",[$order]),
                'complete_pickup' => $db->selectOne("select public.set_order_preparation(cast(? as uuid), 'completed')",[$order]),
                'cancel' => $db->selectOne('select public.pitacco_cancel_active_order(cast(? as uuid), cast(? as text))',[$order,$reason]),
                'reject' => $db->selectOne("select public.pitacco_decide_pending_order(cast(? as uuid), 'rejected', cast(? as text))",[$order,$reason]),
            };
            return $db->selectOne('select id,store_id,status,preparation_status from public.orders where id=cast(? as uuid) and store_id=cast(? as uuid)',[$order,$store]);
        });
    }
}
