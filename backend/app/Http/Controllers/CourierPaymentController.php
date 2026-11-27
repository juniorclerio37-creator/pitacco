<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use JsonException;
use UnexpectedValueException;
final class CourierPaymentController
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.courier_payment_enabled'),404);
        $data=$request->validate([
            'action'=>['required','in:cards,unified_cards,confirm'],
            'delivery_id'=>['required_if:action,confirm','prohibited_if:action,cards,unified_cards','nullable','uuid'],
        ]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        $session=$request->attributes->get('core_session');
        try{
            $db=DB::connection('core_courier_payment');
            $result=$db->transaction(function() use($db,$session,$data){
                if(in_array($data['action'],['cards','unified_cards'],true))$db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '5s'");
                $db->statement("set local lock_timeout = '2s'");
                $db->selectOne("select set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claim.sub',?,true)",[$session->session_id,$session->user_id]);
                $row=$db->selectOne('select core_auth.courier_payment_fixture(cast(? as text),cast(? as uuid)) as payload',[$data['action'],$data['delivery_id']??null]);
                $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
                if(!is_array($result))throw new UnexpectedValueException('Invalid payment projection');
                return $result;
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>match($s){'42501'=>'not_authorized','22023','23514','P0001'=>'payment_not_allowed',default=>'temporarily_unavailable'}],match($s){'42501'=>403,'22023','23514','P0001'=>409,default=>503})->header('Cache-Control','no-store');
        }catch(JsonException|UnexpectedValueException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }

    public function earnings(Request $request): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.courier_payment_enabled'),404);
        $data=$request->validate(['period'=>['required','in:hoje,semana,mes']]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        $session=$request->attributes->get('core_session');
        try{
            $db=DB::connection('core_courier_payment');
            $result=$db->transaction(function() use($db,$session,$data){
                $db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '5s'");
                $db->selectOne("select set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claim.sub',?,true)",[$session->session_id,$session->user_id]);
                $row=$db->selectOne('select core_auth.courier_earnings_fixture(cast(? as text)) as payload',[$data['period']]);
                $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
                if(!is_array($result))throw new UnexpectedValueException('Invalid earnings projection');
                return $result;
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>$s==='42501'?'not_authorized':'temporarily_unavailable'],$s==='42501'?403:503)->header('Cache-Control','no-store');
        }catch(JsonException|UnexpectedValueException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }

    public function history(Request $request): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.courier_payment_enabled'),404);
        $data=$request->validate(['limit'=>['sometimes','integer','min:1','max:50']]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        $session=$request->attributes->get('core_session');
        try{
            $db=DB::connection('core_courier_payment');
            $result=$db->transaction(function() use($db,$session,$data){
                $db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '5s'");
                $db->selectOne("select set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claim.sub',?,true)",[$session->session_id,$session->user_id]);
                $row=$db->selectOne('select core_auth.courier_history_fixture(cast(? as integer)) as payload',[$data['limit']??30]);
                $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
                if(!is_array($result))throw new UnexpectedValueException('Invalid history projection');
                return $result;
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>$s==='42501'?'not_authorized':'temporarily_unavailable'],$s==='42501'?403:503)->header('Cache-Control','no-store');
        }catch(JsonException|UnexpectedValueException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }

    public function detail(Request $request,string $delivery): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.courier_payment_enabled'),404);
        $data=$request->validate([]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        $session=$request->attributes->get('core_session');
        try{
            $db=DB::connection('core_courier_payment');
            $result=$db->transaction(function() use($db,$session,$delivery){
                $db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '5s'");
                $db->selectOne("select set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claim.sub',?,true)",[$session->session_id,$session->user_id]);
                $row=$db->selectOne('select core_auth.courier_detail_fixture(cast(? as uuid)) as payload',[$delivery]);
                $result=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
                if(!is_array($result))throw new UnexpectedValueException('Invalid detail projection');
                return $result;
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>$s==='42501'?'not_authorized':'temporarily_unavailable'],$s==='42501'?403:503)->header('Cache-Control','no-store');
        }catch(JsonException|UnexpectedValueException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }
}
