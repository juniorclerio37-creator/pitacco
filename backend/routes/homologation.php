<?php
use Illuminate\Support\Facades\Route;
// Explicitly test-only, no public file directory, arbitrary path or real store selection.
Route::get('/core-homologacao/{asset?}',function (?string $asset=null) {
    abort_unless(app()->environment('testing') && config('pitacco.homologation_enabled'),404);
    $files=[
        ''=>[base_path('homologation/storefront.html'),'text/html; charset=utf-8'],
        'app.mjs'=>[base_path('homologation/app.mjs'),'text/javascript; charset=utf-8'],
        'storefront.mjs'=>[base_path('clients/storefront.mjs'),'text/javascript; charset=utf-8'],
        'customer-session.mjs'=>[base_path('clients/customer-session.mjs'),'text/javascript; charset=utf-8'],
        'tracking.mjs'=>[base_path('clients/tracking.mjs'),'text/javascript; charset=utf-8'],
    ];
    abort_unless(isset($files[$asset??'']),404);
    [$path,$type]=$files[$asset??''];
    return response(file_get_contents($path),200,[
        'Content-Type'=>$type,'Cache-Control'=>'no-store','X-Content-Type-Options'=>'nosniff',
        'Referrer-Policy'=>'no-referrer','X-Robots-Tag'=>'noindex, nofollow',
        'Content-Security-Policy'=>"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    ]);
});
