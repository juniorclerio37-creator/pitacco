<?php
namespace App\Providers;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        RateLimiter::for('public-menu', fn(Request $request) => Limit::perMinute(60)->by($request->ip()));
        RateLimiter::for('core-checkout', fn(Request $request) => Limit::perMinute(20)->by($request->ip()));
        RateLimiter::for('core-tracking', fn(Request $request) => Limit::perMinute(30)->by($request->ip()));
        RateLimiter::for('core-profile', fn(Request $request) => Limit::perMinute(15)->by($request->ip()));
        RateLimiter::for('core-history', fn(Request $request) => Limit::perMinute(20)->by($request->ip()));
        RateLimiter::for('core-fiado-statement', fn(Request $request) => Limit::perMinute(5)->by($request->ip()));
        RateLimiter::for('core-wallet', fn(Request $request) => Limit::perMinute(15)->by($request->ip()));
        RateLimiter::for('core-login', fn(Request $request) => [
            Limit::perMinute(10)->by('ip:'.$request->ip()),
            Limit::perMinute(5)->by('identity:'.hash('sha256',strtolower(trim(is_string($request->input('email'))?$request->input('email'):''))).':'.$request->ip()),
        ]);
    }
}
