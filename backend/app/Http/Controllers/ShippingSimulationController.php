<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
final class ShippingSimulationController
{
    public function __invoke(Request $request,string $store,string $order): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.shipping_simulation_enabled'),404);
        if($request->all()||$request->query())throw ValidationException::withMessages(['request'=>'Apenas consulta simulada.']);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_own_board');
            $data=$db->transaction(function()use($db,$session,$store,$order){
                $db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '3s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $row=$db->selectOne('select core_auth.shipping_simulation_fixture(cast(? as uuid),cast(? as uuid)) as result',[$store,$order]);
                abort_if($row?->result===null,404);
                return json_decode($row->result,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$data])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }

    public function transition(Request $request,string $store,string $order): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.shipping_simulation_enabled'),404);
        $input=$request->validate(['action'=>['required','in:start,status,request,submitted,uncertain,rejected,allocated,cancel,cancel_submitted,cancel_uncertain,cancel_rejected,cancel_confirmed'],'revision'=>['required','integer','min:0'],'confirmed'=>['required_if:action,request,cancel','prohibited_unless:action,request,cancel','accepted'],'amount_cents'=>['required_if:action,request','prohibited_unless:action,request','integer','min:0']]);
        if($request->query()||array_diff(array_keys($request->all()),array_keys($input)))throw ValidationException::withMessages(['request'=>'Apenas simulação.']);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_own_board');
            $data=$db->transaction(function()use($db,$session,$store,$order,$input){
                $db->statement("set local statement_timeout = '3s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $row=$db->selectOne('select core_auth.shipping_simulation_transition(cast(? as uuid),cast(? as uuid),cast(? as text),cast(? as integer),cast(? as integer)) as result',[$store,$order,$input['action'],$input['revision'],$input['amount_cents']??null]);
                abort_if($row?->result===null,404);
                return json_decode($row->result,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$data])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            return response()->json(['error'=>($e->errorInfo[0]??'')==='22023'?'simulation_transition_not_allowed':'temporarily_unavailable'],($e->errorInfo[0]??'')==='22023'?409:503)->header('Cache-Control','no-store');
        }
    }
}
