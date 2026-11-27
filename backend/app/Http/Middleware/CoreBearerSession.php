<?php
namespace App\Http\Middleware;
use App\Services\CoreSessions;
use Closure;
use Illuminate\Http\Request;
final class CoreBearerSession
{
    public function handle(Request $request, Closure $next, CoreSessions $sessions)
    {
        $token=$request->bearerToken();
        $session=$sessions->find($token);
        if (!$session) return response()->json(['error'=>'unauthenticated'],401)->header('Cache-Control','no-store');
        $request->attributes->set('core_session',$session);
        return $next($request);
    }
}
