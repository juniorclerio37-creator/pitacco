<?php
namespace App\Http\Controllers;
use App\Services\FiadoStatement;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Throwable;
final class FiadoStatementController
{
    public function __invoke(Request $request,string $slug,FiadoStatement $service): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.fiado_statement_enabled'),404);
        $data=$request->validate(['phone'=>['required','string','regex:/\A[0-9]{10,11}\z/'],'pin'=>['required','string','regex:/\A[0-9]{6}\z/']]);
        try {
            $result=$service->read($slug,$data);
        } catch(Throwable) {
            // Never report SQL bindings, PIN, verification token or financial records.
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
        if($result===null)return response()->json(['error'=>'verification_failed'],403)->header('Cache-Control','no-store');
        return response()->json(['data'=>$result])->header('Cache-Control','no-store');
    }
}
