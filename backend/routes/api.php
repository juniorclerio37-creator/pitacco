<?php
use App\Http\Controllers\HealthController;
use App\Http\Controllers\PublicMenuController;
use App\Http\Controllers\PublicScheduleController;
use App\Http\Controllers\PublicStoreStateController;
use App\Http\Controllers\PublicCheckoutController;
use App\Http\Controllers\PublicTrackingController;
use App\Http\Controllers\CourierGpsController;
use App\Http\Controllers\CourierAssignmentsController;
use App\Http\Controllers\CourierShiftController;
use App\Http\Controllers\CourierPaymentController;
use App\Http\Controllers\CustomerProfileController;
use App\Http\Controllers\CustomerWalletController;
use App\Http\Controllers\FiadoOverviewController;
use App\Http\Controllers\FinancialReportController;
use App\Http\Controllers\PaymentSettingsController;
use App\Http\Controllers\PaymentPricingController;
use App\Http\Controllers\MerchantCheckoutController;
use App\Http\Controllers\DeliverySettingsController;
use App\Http\Controllers\OpeningHoursController;
use App\Http\Controllers\FiadoStatementController;
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
    Route::get('/public/menus/{slug}/{resource}',PublicStoreStateController::class)->where('slug','[a-z0-9][a-z0-9-]{0,119}')->whereIn('resource',['opening','payment-prices'])->middleware('throttle:public-menu');
    Route::get('/public/menus/{slug}/schedule-slots',PublicScheduleController::class)->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:public-menu');
    Route::post('/public/menus/{slug}/checkout',[PublicCheckoutController::class,'place'])->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:core-checkout');
    Route::post('/public/menus/{slug}/checkout/recovery',[PublicCheckoutController::class,'recover'])->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:core-checkout');
    Route::post('/courier/gps',CourierGpsController::class)->middleware('throttle:60,1');
    Route::post('/courier/assignments',CourierAssignmentsController::class)->middleware('throttle:60,1');
    Route::post('/public/orders/tracking',PublicTrackingController::class)->middleware('throttle:core-tracking');
    Route::post('/public/menus/{slug}/profile',CustomerProfileController::class)->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:core-profile');
    Route::post('/public/menus/{slug}/profile/session',[CustomerProfileController::class,'session'])->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:core-profile');
    Route::post('/public/menus/{slug}/profile/orders',[CustomerProfileController::class,'orders'])->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:core-history');
    Route::post('/public/menus/{slug}/fiado/statement',FiadoStatementController::class)->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:core-fiado-statement');
    Route::post('/public/menus/{slug}/profile/wallet',CustomerWalletController::class)->where('slug','[a-z0-9][a-z0-9-]{0,119}')->middleware('throttle:core-wallet');
    Route::middleware(ExperimentalAuthGate::class)->group(function () {
        Route::post('/auth/login',[CoreAuthController::class,'login'])->middleware('throttle:core-login');
        Route::middleware(['throttle:60,1',CoreBearerSession::class])->group(function () {
            Route::post('/courier/shift',CourierShiftController::class);
            Route::post('/courier/payments',CourierPaymentController::class);
            Route::get('/auth/me',[CoreAuthController::class,'me']);
            Route::post('/auth/logout',[CoreAuthController::class,'logout']);
            Route::get('/stores/{store}/orders',DailyOrdersController::class)->whereUuid('store');
            Route::post('/stores/{store}/orders/{order}/actions',OwnOrderActionsController::class)->whereUuid(['store','order']);
            Route::post('/stores/{store}/fiado/settings',FiadoManagementController::class)->whereUuid('store');
            Route::get('/stores/{store}/fiado',FiadoOverviewController::class)->whereUuid('store');
            Route::match(['get','put'],'/stores/{store}/payments/settings',PaymentSettingsController::class)->whereUuid('store');
            Route::match(['get','put'],'/stores/{store}/payments/pricing',PaymentPricingController::class)->whereUuid('store');
            Route::post('/stores/{store}/payments/pricing/publish',[PaymentPricingController::class,'publish'])->whereUuid('store');
            Route::match(['get','put'],'/stores/{store}/opening-hours',OpeningHoursController::class)->whereUuid('store');
            Route::match(['get','put'],'/stores/{store}/delivery/settings',DeliverySettingsController::class)->whereUuid('store');
            Route::post('/stores/{store}/checkout',MerchantCheckoutController::class)->whereUuid('store');
            Route::get('/stores/{store}/reports/financial',FinancialReportController::class)->whereUuid('store');
            Route::get('/stores/{store}/context',[CoreAuthController::class,'store'])->whereUuid('store');
        });
    });
});
