<?php
use App\Http\Controllers\HealthController;
use App\Http\Controllers\PublicMenuController;
use App\Http\Controllers\CoreAuthController;
use App\Http\Middleware\ExperimentalAuthGate;
use App\Http\Middleware\CoreBearerSession;
use Illuminate\Support\Facades\Route;
Route::prefix('v1')->group(function () {
    Route::get('/health/ready', HealthController::class)->middleware('throttle:30,1');
    Route::get('/public/menus/{slug}', PublicMenuController::class)
        ->where('slug', '[a-z0-9][a-z0-9-]{0,119}')
        ->middleware('throttle:public-menu');
    Route::middleware(ExperimentalAuthGate::class)->group(function () {
        Route::post('/auth/login',[CoreAuthController::class,'login'])->middleware('throttle:core-login');
        Route::middleware(['throttle:60,1',CoreBearerSession::class])->group(function () {
            Route::get('/auth/me',[CoreAuthController::class,'me']);
            Route::post('/auth/logout',[CoreAuthController::class,'logout']);
            Route::get('/stores/{store}/context',[CoreAuthController::class,'store'])->whereUuid('store');
        });
    });
});
