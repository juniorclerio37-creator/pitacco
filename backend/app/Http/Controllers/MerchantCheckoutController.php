<?php
namespace App\Http\Controllers;
use App\Services\MerchantCheckout;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use JsonException;
use UnexpectedValueException;
final class MerchantCheckoutController
{
    public function __invoke(Request $request,string $store,MerchantCheckout $checkout): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.merchant_checkout_enabled'),404);
        $data=$request->validate([
            'request_id'=>['required','uuid'],
            'sale_mode'=>['required','in:balcao,retirada,entrega'],
            'address'=>['required_if:sale_mode,entrega','prohibited_unless:sale_mode,entrega','nullable','string','min:5','max:500'],
            'quote_id'=>['required_if:sale_mode,entrega','prohibited_unless:sale_mode,entrega','nullable','uuid'],
            'customer'=>['required','string','min:2','max:120'],
            'phone'=>['required','string','max:30'],
            'items'=>['required','array','list','min:1','max:30'],
            'items.*'=>['required','array:product_id,quantity,options'],
            'items.*.product_id'=>['required','uuid'],
            'items.*.quantity'=>['required','integer','min:1','max:1000'],
            'items.*.options'=>['sometimes','array','list','max:50'],
            'items.*.options.*'=>['required','uuid'],
            'payment'=>['required','in:dinheiro,cartao_credito,cartao_debito,cartao_entrega,pix_manual,pix_maquininha,voucher_alelo,voucher_pluxee,voucher_vr,voucher_ticket'],
            'notes'=>['nullable','string','max:1000'],
        ]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        if(strlen(json_encode($data['items'],JSON_THROW_ON_ERROR))>12000)throw ValidationException::withMessages(['items'=>'Carrinho excede o limite.']);
        try{
            $r=$checkout->place($request->attributes->get('core_session'),$store,$data);
            return response()->json(['data'=>$r],isset($r['error'])?409:200)->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>match($s){'42501'=>'forbidden','P0001','22023'=>'checkout_not_confirmed',default=>'temporarily_unavailable'}],match($s){'42501'=>403,'P0001','22023'=>409,default=>503})->header('Cache-Control','no-store');
        }catch(JsonException|UnexpectedValueException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }
}
