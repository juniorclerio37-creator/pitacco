<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
final class OwnPrintController
{
    public function __invoke(Request $request,string $store,string $order): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.own_print_enabled'),404);
        $data=$request->validate(['request_id'=>['required','uuid','not_in:00000000-0000-0000-0000-000000000000'],'reason'=>['required','string','min:5','max:240']]);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_own_print');
            $db->transaction(function()use($db,$session,$store,$order,$data){
                $db->statement("set local statement_timeout = '5s'");
                $db->statement("set local lock_timeout = '2s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $row=$db->selectOne('select core_auth.own_reprint_fixture(cast(? as uuid),cast(? as uuid),cast(? as uuid),cast(? as text)) as queued',[$store,$order,$data['request_id'],trim($data['reason'])]);
                abort_unless($row?->queued===true,404);
            });
            return response()->json(['data'=>['queued'=>true]])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $state=$e->errorInfo[0]??'';
            $status=in_array($state,['P0001','22023'],true)?409:($state==='42501'?404:503);
            return response()->json(['error'=>$status===409?'reprint_not_available':($status===404?'not_found':'temporarily_unavailable')],$status)->header('Cache-Control','no-store');
        }
    }
}
