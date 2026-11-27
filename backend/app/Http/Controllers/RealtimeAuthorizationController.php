<?php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;

final class RealtimeAuthorizationController
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.realtime_enabled'),404);
        $data=$request->validate([
            'socket_id'=>['required','string','max:41','regex:/\A[0-9]{1,20}\.[0-9]{1,20}\z/'],
            'channel_name'=>['required','string','regex:/\Aprivate-pitacco\.store\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/'],
        ]);
        if ($request->query() || array_diff(array_keys($request->all()),array_keys($data))) {
            throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        }
        $store=substr($data['channel_name'],strlen('private-pitacco.store.'));
        $session=$request->attributes->get('core_session');
        $key=config('core_realtime.key');
        $secret=config('core_realtime.secret');
        if (!is_string($key)||!preg_match('/\A[a-zA-Z0-9_-]{1,128}\z/',$key)||!is_string($secret)||strlen($secret)<32) {
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
        try {
            $db=DB::connection('core_realtime');
            $allowed=$db->transaction(function() use($db,$session,$store) {
                $db->statement("set transaction read only");
                $db->statement("set local statement_timeout = '3s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                return $db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true;
            });
            abort_unless($allowed,404);
            $auth=$key.':'.hash_hmac('sha256',$data['socket_id'].':'.$data['channel_name'],$secret);
            return response()->json(['auth'=>$auth])->header('Cache-Control','no-store');
        } catch(QueryException $e) {
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }
}
