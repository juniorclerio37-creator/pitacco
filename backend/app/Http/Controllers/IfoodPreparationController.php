<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
final class IfoodPreparationController
{
    public function __invoke(Request $request,string $store,string $order): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.own_board_enabled') && config('pitacco.actions_enabled'),404);
        if($request->all()||$request->query())throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_actions');
            $result=$db->transaction(function()use($db,$session,$store,$order){
                $db->statement("set local statement_timeout = '5s'");
                $db->statement("set local lock_timeout = '2s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $row=$db->selectOne('select core_auth.ifood_ready_fixture(cast(? as uuid),cast(? as uuid)) as result',[$store,$order]);
                abort_if($row?->result===null,404);
                return json_decode($row->result,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $state=$e->errorInfo[0]??'';
            $status=in_array($state,['P0001','22023'],true)?409:($state==='42501'?404:503);
            return response()->json(['error'=>$status===409?'transition_not_allowed':($status===404?'not_found':'temporarily_unavailable')],$status)->header('Cache-Control','no-store');
        }
    }
}
