<?php
namespace App\Http\Controllers;
use App\Services\DailyOrdersReader;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
final class DailyOrdersController
{
    public function __invoke(Request $request,string $store,DailyOrdersReader $reader): JsonResponse
    {
        $data=$request->validate(['limit'=>['sometimes','integer','min:1','max:100'],'offset'=>['sometimes','integer','min:0','max:10000']]);
        $limit=(int)($data['limit']??50);$offset=(int)($data['offset']??0);
        $rows=$reader->get($request->attributes->get('core_session'),$store,$limit,$offset);
        return response()->json(['data'=>$rows,'limit'=>$limit,'offset'=>$offset]);
    }
}
