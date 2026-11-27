<?php
namespace App\Http\Controllers;
use App\Services\PublicScheduleReader;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;
use Throwable;
final class PublicScheduleController
{
    public function __invoke(Request $request,string $slug,PublicScheduleReader $reader): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.menu_enabled'),404);
        $data=$request->validate(['fulfillment'=>['required','in:pickup,delivery']]);
        if(array_diff(array_keys($request->query()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        try{
            return response()->json(['data'=>['slots'=>$reader->get($slug,$data['fulfillment']),'timezone'=>'America/Sao_Paulo']])->header('Cache-Control','no-store');
        }catch(Throwable){
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }
}
