<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use JsonException;
final class CourierShiftController
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.courier_shift_enabled'),404);
        $data=$request->validate(['action'=>['required','in:ready,start_gps,revoke_gps']]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        $session=$request->attributes->get('core_session');
        try{
            $db=DB::connection('core_courier_shift');
            $result=$db->transaction(function() use($db,$session,$data){
                $db->statement("set local statement_timeout = '3s'");
                $db->statement("set local lock_timeout = '1s'");
                $db->selectOne("select set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claim.sub',?,true)",[$session->session_id,$session->user_id]);
                $row=$db->selectOne('select core_auth.courier_shift_fixture(cast(? as text)) as payload',[$data['action']]);
                return json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $denied=($e->errorInfo[0]??'')==='42501';
            return response()->json(['error'=>$denied?'shift_not_authorized':'temporarily_unavailable'],$denied?403:503)->header('Cache-Control','no-store');
        }catch(JsonException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }

    public function push(Request $request): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.courier_shift_enabled'),404);
        $data=$request->validate(['action'=>['required','in:status,register_native,register_legacy,unregister'],'device_token'=>['required_if:action,register_native,register_legacy','prohibited_if:action,status,unregister','string','regex:/^fixture-only-[A-Za-z0-9_-]{32,80}$/']]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        $session=$request->attributes->get('core_session');
        try{
            $db=DB::connection('core_courier_shift');
            $result=$db->transaction(function() use($db,$session,$data){
                $db->statement("set local statement_timeout = '3s'");
                $db->statement("set local lock_timeout = '1s'");
                $db->selectOne("select set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claim.sub',?,true)",[$session->session_id,$session->user_id]);
                $row=$db->selectOne('select core_auth.courier_push_fixture(cast(? as text),cast(? as text)) as payload',[$data['action'],$data['device_token']??null]);
                return json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $denied=($e->errorInfo[0]??'')==='42501';
            return response()->json(['error'=>$denied?'shift_not_authorized':'temporarily_unavailable'],$denied?403:503)->header('Cache-Control','no-store');
        }catch(JsonException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }
}
