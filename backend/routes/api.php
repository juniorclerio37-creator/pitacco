<?php
use App\Http\Controllers\HealthController;
use App\Http\Controllers\PublicMenuController;
use Illuminate\Support\Facades\Route;
Route::prefix('v1')->group(function () {
    Route::get('/health/ready', HealthController::class)->middleware('throttle:30,1');
    Route::get('/public/menus/{slug}', PublicMenuController::class)
        ->where('slug', '[a-z0-9][a-z0-9-]{0,119}')
        ->middleware('throttle:public-menu');
});
