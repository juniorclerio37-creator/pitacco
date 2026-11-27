<?php
use App\Http\Controllers\HealthController;
use App\Http\Controllers\PublicMenuController;
use App\Http\Controllers\PublicCheckoutController;
use App\Http\Controllers\PublicTrackingController;
use App\Http\Controllers\CustomerProfileController;
use App\Http\Controllers\FiadoOverviewController;
use App\Http\Controllers\FiadoManagementController;
use App\Http\Controllers\CoreAuthController;
use App\Http\Controllers\DailyOrdersController;
use App\Http\Controllers\OwnOrderActionsController;
use App\Http\Middleware\ExperimentalAuthGate;
use App\Http\Middleware\CoreBearerSession;
use Illuminate\Support\Facades\Route;
Route::prefix('v1')->group(function () {
    Route::get('/health/ready', HealthController::class)->middleware('throttle:30,1');
    Route::get('/public/menus/{slug}', PublicMenuController::class)
        ->where('slug', '[a-z0-9][a-z0-9-]{0,119}')
        ->middleware('throttle:public-menu');
    Route::post('/public/menus/{slug}/checkout',[PublicCheckoutController::class,'place'])->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:core-checkout');
    Route::post('/public/menus/{slug}/checkout/recovery',[PublicCheckoutController::class,'recover'])->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:core-checkout');
    Route::post('/public/orders/tracking',PublicTrackingController::class)->middleware('throttle:core-tracking');
    Route::post('/public/menus/{slug}/profile',CustomerProfileController::class)->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:core-profile');
    Route::middleware(ExperimentalAuthGate::class)->group(function () {
        Route::post('/auth/login',[CoreAuthController::class,'login'])->middleware('throttle:core-login');
        Route::middleware(['throttle:60,1',CoreBearerSession::class])->group(function () {
            Route::get('/auth/me',[CoreAuthController::class,'me']);
            Route::post('/auth/logout',[CoreAuthController::class,'logout']);
            Route::get('/stores/{store}/orders',DailyOrdersController::class)->whereUuid('store');
            Route::post('/stores/{store}/orders/{order}/actions',OwnOrderActionsController::class)->whereUuid(['store','order']);
            Route::post('/stores/{store}/fiado/settings',FiadoManagementController::class)->whereUuid('store');
            Route::get('/stores/{store}/fiado',FiadoOverviewController::class)->whereUuid('store');
            Route::get('/stores/{store}/context',[CoreAuthController::class,'store'])->whereUuid('store');
        });
    });
});
