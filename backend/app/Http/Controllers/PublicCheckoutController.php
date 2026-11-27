<?php
namespace App\Http\Controllers;
use App\Services\PublicCheckout;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
final class PublicCheckoutController
{
    private function gate(): void
    {
        abort_unless(app()->environment(['local','testing']) && config('pitacco.checkout_enabled'),404);
    }
    public function place(Request $request,string $slug,PublicCheckout $checkout): JsonResponse
    {
        $this->gate();
        $data=$request->validate([
            'request_id'=>['required','uuid'],
            'customer'=>['required','string','min:2','max:120'],
            'phone'=>['required','string','max:30'],
            'address'=>['required_if:fulfillment,delivery','nullable','string','max:500'],
            'items'=>['required','array','min:1','max:30'],
            'items.*'=>['required','array:product_id,quantity,options'],
            'items.*.product_id'=>['required','uuid'],
            'items.*.quantity'=>['required','integer','min:1','max:1000'],
            'items.*.options'=>['sometimes','array','max:50'],
            'items.*.options.*'=>['required','uuid'],
            'fulfillment'=>['required','in:pickup,delivery'],
            'payment'=>['required','in:pix_manual'],
            'notes'=>['nullable','string','max:1000'],
            'quote_id'=>['required_if:fulfillment,delivery','prohibited_if:fulfillment,pickup','nullable','uuid'],
            'scheduled_for'=>['nullable','date_format:Y-m-d\TH:i:sP'],
            'expected_cents'=>['required_with:price_revision','nullable','integer','min:1','max:1000000'],
            'price_revision'=>['required_with:expected_cents','nullable','integer','min:1'],
        ]);
        if(array_diff(array_keys($request->all()),array_keys($data))) throw ValidationException::withMessages(['request'=>'Campos não suportados nesta versão.']);
        if(strlen(json_encode($data['items'],JSON_THROW_ON_ERROR))>12000) throw ValidationException::withMessages(['items'=>'Carrinho excede o limite.']);
        try {
            $result=$checkout->place($slug,$data);
        } catch(QueryException $e) {
            return $this->dbError($e);
        }
        return response()->json(['data'=>$result],isset($result['error'])?409:200)->header('Cache-Control','no-store');
    }
    public function recover(Request $request,string $slug,PublicCheckout $checkout): JsonResponse
    {
        $this->gate();
        $data=$request->validate(['request_id'=>['required','uuid']]);
        try {
            return response()->json(['data'=>$checkout->recover($slug,$data['request_id'])])->header('Cache-Control','no-store');
        } catch(QueryException $e) {
            return $this->dbError($e);
        }
    }
    private function dbError(QueryException $e): JsonResponse
    {
        $state=$e->errorInfo[0]??'';
        // Never expose SQL, credentials, request capabilities or stack traces.
        return response()->json(['error'=>$state==='P0001'?'checkout_not_confirmed':($state==='42501'?'forbidden':'temporarily_unavailable')],match($state){'P0001'=>409,'42501'=>403,default=>503})->header('Cache-Control','no-store');
    }
}
