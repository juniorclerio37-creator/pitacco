<?php
namespace App\Http\Controllers;
use App\Services\PublicMenuReader;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Throwable;
final class PublicMenuController
{
    public function __invoke(string $slug, PublicMenuReader $reader): JsonResponse
    {
        // No public access outside local/CI until the database recovery gate passes.
        if (!app()->environment(['local','testing']) || !config('pitacco.menu_enabled')) {
            abort(404);
        }
        try {
            $menu = $reader->get($slug);
        } catch (QueryException $exception) {
            $info = $exception->errorInfo;
            if (($info[0] ?? '') === 'P0001' && preg_match('/Card[aá]pio indispon[ií]vel/iu', (string)($info[2] ?? ''))) {
                return response()->json(['error'=>'menu_unavailable'],404)->header('Cache-Control','no-store');
            }
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        } catch (Throwable) {
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
        if ($menu === null) {
            return response()->json(['error'=>'menu_unavailable'],404)->header('Cache-Control','no-store');
        }
        return response()->json(['data'=>$menu])->header('Cache-Control','no-store');
    }
}
