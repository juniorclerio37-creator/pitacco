<?php
namespace App\Http\Middleware;
use Closure;
use Illuminate\Http\Request;
final class ExperimentalAuthGate
{
    public function handle(Request $request, Closure $next)
    {
        abort_unless(app()->environment(['local','testing']) && config('pitacco.auth_enabled'),404);
        return $next($request)->header('Cache-Control','no-store');
    }
}
