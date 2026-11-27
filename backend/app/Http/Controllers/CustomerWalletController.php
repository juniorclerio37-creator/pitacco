<?php
namespace App\Http\Controllers;
use App\Services\CustomerWallet;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;
use Throwable;
final class CustomerWalletController
{
    public function __invoke(Request $request,string $slug,CustomerWallet $wallet): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.wallet_enabled'),404);
        $data=$request->validate(['device'=>['required','uuid']]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        try{$result=$wallet->read($slug,$data['device']);}
        catch(Throwable){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
        if($result===null)return response()->json(['error'=>'verification_required'],403)->header('Cache-Control','no-store');
        if(isset($result['error']))return response()->json($result,409)->header('Cache-Control','no-store');
        return response()->json(['data'=>$result])->header('Cache-Control','no-store');
    }
}
