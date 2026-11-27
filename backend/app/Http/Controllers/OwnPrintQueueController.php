<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
final class OwnPrintQueueController
{
    public function __invoke(Request $request,string $store,string $operation): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.own_print_enabled'),404);
        $rules=['device_id'=>['required','uuid','not_in:00000000-0000-0000-0000-000000000000']];
        if($operation==='ack')$rules+=['job_id'=>['required','uuid'],'state'=>['required','in:saved,submitted,uncertain,error'],'error'=>['nullable','string','max:240']];
        $data=$request->validate($rules);
        if($request->query()||array_diff(array_keys($request->all()),array_keys($rules)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_own_print');
            $result=$db->transaction(function()use($db,$session,$store,$operation,$data){
                $db->statement("set local statement_timeout = '5s'");
                $db->statement("set local lock_timeout = '2s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $row=$db->selectOne('select core_auth.own_print_queue_fixture(cast(? as uuid),cast(? as text),cast(? as uuid),cast(? as uuid),cast(? as text),cast(? as text)) as result',[$store,$operation,$data['device_id'],$data['job_id']??null,$data['state']??null,$data['error']??null]);
                return json_decode($row->result,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $state=$e->errorInfo[0]??'';
            $status=in_array($state,['P0001','22023'],true)?409:($state==='42501'?404:503);
            return response()->json(['error'=>$status===409?'queue_not_available':($status===404?'not_found':'temporarily_unavailable')],$status)->header('Cache-Control','no-store');
        }
    }

    public function unified(Request $request,string $store,string $operation): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.own_print_enabled'),404);
        $rules=['device_id'=>['required','uuid','not_in:00000000-0000-0000-0000-000000000000']];
        if($operation==='ack')$rules+=['job_id'=>['required','uuid'],'state'=>['required','in:saved,submitted,uncertain,error'],'error'=>['nullable','string','max:240']];
        $data=$request->validate($rules);
        if($request->query()||array_diff(array_keys($request->all()),array_keys($rules)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_own_print');
            $result=$db->transaction(function()use($db,$session,$store,$operation,$data){
                $db->statement("set local statement_timeout = '5s'");
                $db->statement("set local lock_timeout = '2s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $row=$db->selectOne('select core_auth.unified_print_queue_fixture(cast(? as uuid),cast(? as text),cast(? as uuid),cast(? as uuid),cast(? as text),cast(? as text)) as result',[$store,$operation,$data['device_id'],$data['job_id']??null,$data['state']??null,$data['error']??null]);
                return json_decode($row->result,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $state=$e->errorInfo[0]??'';
            $status=in_array($state,['P0001','22023'],true)?409:($state==='42501'?404:503);
            return response()->json(['error'=>$status===409?'queue_not_available':($status===404?'not_found':'temporarily_unavailable')],$status)->header('Cache-Control','no-store');
        }
    }

    public function preferences(Request $request,string $store): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.own_print_enabled'),404);
        $write=$request->isMethod('PUT');
        $rules=$write?['automatic'=>['required','boolean']]:[];
        $data=$request->validate($rules);
        if($request->query()||array_diff(array_keys($request->all()),array_keys($rules))||($write&&!is_bool($data['automatic'])))throw ValidationException::withMessages(['request'=>'Configuração inválida.']);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_own_print');
            $result=$db->transaction(function()use($db,$session,$store,$data,$write){
                $db->statement("set local statement_timeout = '5s'");
                $db->statement("set local lock_timeout = '2s'");
                if(!$write)$db->statement('set transaction read only');
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $row=$db->selectOne('select core_auth.print_preferences_fixture(cast(? as uuid),cast(? as boolean)) as enabled',[$store,$write?$data['automatic']:null]);
                return ['automatic'=>$row->enabled===true];
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }
}
