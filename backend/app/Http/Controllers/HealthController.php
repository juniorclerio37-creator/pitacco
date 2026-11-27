<?php
namespace App\Http\Controllers;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Throwable;
final class HealthController
{
    public function __invoke(): JsonResponse
    {
        try {
            DB::connection('pgsql')->selectOne('select 1 as ok');
            Redis::connection()->ping();
            return response()->json(['status'=>'ready'])->header('Cache-Control','no-store');
        } catch (Throwable) {
            return response()->json(['status'=>'unavailable'],503)->header('Cache-Control','no-store');
        }
    }
}
