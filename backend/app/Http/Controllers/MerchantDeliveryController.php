<?php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;

final class MerchantDeliveryController
{
    public function __invoke(Request $request,string $store,string $delivery): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.merchant_dispatch_enabled'),404);
        $data=$request->validate([
            'action'=>['required','in:assign,remove,reassign,resume'],
            'courier_id'=>['required_if:action,assign,reassign','prohibited_if:action,remove,resume','nullable','uuid'],
            'expected_courier_id'=>['required_if:action,remove,reassign','prohibited_if:action,assign,resume','nullable','uuid'],
            'confirm_deviation'=>['sometimes','boolean','prohibited_if:action,remove,resume'],
        ]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_merchant_dispatch');
            $result=$db->transaction(function() use($db,$session,$store,$delivery,$data) {
                $db->statement("set local statement_timeout = '5s'");
                $db->statement("set local lock_timeout = '2s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed,404);
                $row=$db->selectOne('select core_auth.merchant_delivery_fixture(cast(? as uuid),cast(? as uuid),cast(? as text),cast(? as uuid),cast(? as uuid),cast(? as boolean)) as route_id',[$store,$delivery,$data['action'],$data['expected_courier_id']??null,$data['courier_id']??null,($data['confirm_deviation']??false)?'true':'false']);
                return ['route_id'=>$row->route_id];
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        } catch(QueryException $e) {
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>match($s){'42501'=>'not_authorized','22023','P0001','23514'=>'operation_not_allowed',default=>'temporarily_unavailable'}],match($s){'42501'=>403,'22023','P0001','23514'=>409,default=>503})->header('Cache-Control','no-store');
        }
    }
}
