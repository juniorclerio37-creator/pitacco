<?php
namespace App\Http\Controllers;
use App\Services\PublicStoreState;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use Throwable;
final class PublicStoreStateController
{
    public function __invoke(string $slug,string $resource,PublicStoreState $reader): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.menu_enabled'),404);
        try{
            return response()->json(['data'=>$reader->read($slug,$resource)])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $info=$e->errorInfo;
            if(($info[0]??'')==='P0001'&&preg_match('/Card[aá]pio indispon[ií]vel/i',(string)($info[2]??'')))return response()->json(['error'=>'menu_unavailable'],404)->header('Cache-Control','no-store');
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }catch(Throwable){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }
}
