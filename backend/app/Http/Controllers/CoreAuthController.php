<?php
namespace App\Http\Controllers;
use App\Services\CoreSessions;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
final class CoreAuthController
{
    public function login(Request $request,CoreSessions $sessions): JsonResponse
    {
        $data=$request->validate(['email'=>['required','string','email','max:254'],'password'=>['required','string','max:72']]);
        if (strlen($data['password'])>72) return response()->json(['error'=>'invalid_credentials'],401);
        $token=$sessions->login($data['email'],$data['password']);
        return $token ? response()->json($token) : response()->json(['error'=>'invalid_credentials'],401);
    }
    public function me(Request $request,CoreSessions $sessions): JsonResponse
    {
        $session=$request->attributes->get('core_session');
        return response()->json(['id'=>$session->user_id,'email'=>$session->email,'stores'=>$sessions->memberships($session)]);
    }
    public function renew(Request $request,CoreSessions $sessions): JsonResponse
    {
        if($request->all()||$request->query())return response()->json(['error'=>'invalid_request'],422)->header('Cache-Control','no-store');
        $token=$sessions->renew($request->attributes->get('core_session'),(string)$request->bearerToken());
        return $token ? response()->json($token)->header('Cache-Control','no-store') : response()->json(['error'=>'renewal_unavailable'],409)->header('Cache-Control','no-store');
    }
    public function logout(Request $request,CoreSessions $sessions): JsonResponse
    {
        $sessions->revoke($request->attributes->get('core_session'));
        return response()->json(['status'=>'revoked']);
    }
    public function store(Request $request,string $store,CoreSessions $sessions): JsonResponse
    {
        $context=$sessions->store($request->attributes->get('core_session'),$store);
        return $context ? response()->json(['data'=>$context]) : response()->json(['error'=>'store_not_found'],404);
    }
}
