<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
final class OwnBoardOrdersController
{
    public function __invoke(Request $request,string $store): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.own_board_enabled'),404);
        $data=$request->validate(['limit'=>['sometimes','integer','min:1','max:100'],'offset'=>['sometimes','integer','min:0','max:10000']]);
        $limit=(int)($data['limit']??50);$offset=(int)($data['offset']??0);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_own_board');
            $rows=$db->transaction(function()use($db,$session,$store,$limit,$offset){
                $db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '3s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $result=$db->selectOne('select core_auth.own_board_fixture(cast(? as uuid),cast(? as integer),cast(? as integer)) as rows',[$store,$limit,$offset]);
                return json_decode($result->rows,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$rows,'limit'=>$limit,'offset'=>$offset])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }

    public function ifood(Request $request,string $store): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.own_board_enabled'),404);
        $data=$request->validate(['limit'=>['sometimes','integer','min:1','max:100'],'offset'=>['sometimes','integer','min:0','max:10000']]);
        $limit=(int)($data['limit']??50);$offset=(int)($data['offset']??0);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_own_board');
            $rows=$db->transaction(function()use($db,$session,$store,$limit,$offset){
                $db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '3s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $result=$db->selectOne('select core_auth.ifood_board_fixture(cast(? as uuid),cast(? as integer),cast(? as integer)) as rows',[$store,$limit,$offset]);
                return json_decode($result->rows,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$rows,'limit'=>$limit,'offset'=>$offset])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }

    public function settings(Request $request,string $store): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.own_board_enabled'),404);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_own_board');
            $data=$db->transaction(function()use($db,$session,$store){
                $db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '3s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $result=$db->selectOne('select core_auth.operation_settings_fixture(cast(? as uuid)) as settings',[$store]);
                return json_decode($result->settings,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$data])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }
}
