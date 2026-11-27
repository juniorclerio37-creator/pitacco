<?php
namespace App\Http\Controllers;
use App\Services\FiadoOverview;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use JsonException;
use UnexpectedValueException;
final class FiadoOverviewController
{
    public function __invoke(Request $request,string $store,FiadoOverview $reader): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.fiado_overview_enabled'),404);
        try {
            $data=$reader->read($request->attributes->get('core_session'),$store);
            return response()->json(['data'=>$data])->header('Cache-Control','no-store');
        } catch(QueryException $e) {
            $denied=($e->errorInfo[0]??'')==='42501';
            return response()->json(['error'=>$denied?'forbidden':'temporarily_unavailable'],$denied?403:503)->header('Cache-Control','no-store');
        } catch(JsonException|UnexpectedValueException $e) {
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }
}
