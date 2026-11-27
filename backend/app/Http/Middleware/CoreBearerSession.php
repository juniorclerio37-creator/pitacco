<?php
namespace App\Http\Middleware;
use App\Services\CoreSessions;
use Closure;
use Illuminate\Http\Request;
final class CoreBearerSession
{
    public function __construct(private readonly CoreSessions $sessions) {}

    public function handle(Request $request, Closure $next)
    {
        $token=$request->bearerToken();
        $session=$this->sessions->find($token);
        if (!$session) return response()->json(['error'=>'unauthenticated'],401)->header('Cache-Control','no-store');
        $request->attributes->set('core_session',$session);
        return $next($request);
    }
}
