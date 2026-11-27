<?php
namespace App\Http\Controllers;
use App\Services\PublicTrackingReader;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use UnexpectedValueException;
use JsonException;
final class PublicTrackingController
{
    public function __invoke(Request $request,PublicTrackingReader $reader): JsonResponse
    {
        abort_unless(app()->environment(['local','testing']) && config('pitacco.tracking_enabled'),404);
        // Body rather than URL; do not log request bodies or capability values.
        $data=$request->validate(['tracking_token'=>['required','uuid']]);
        try {
            $result=$reader->find($data['tracking_token']);
        } catch(QueryException|UnexpectedValueException|JsonException $e) {
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
        if($result===null) return response()->json(['error'=>'tracking_unavailable'],404)->header('Cache-Control','no-store');
        return response()->json(['data'=>$result])->header('Cache-Control','no-store');
    }
}
