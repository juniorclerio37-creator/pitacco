<?php
namespace App\Http\Controllers;
use App\Services\PaymentPricing;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use JsonException;
use UnexpectedValueException;
final class PaymentPricingController
{
    public function __invoke(Request $request,string $store,PaymentPricing $pricing): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.payment_pricing_enabled'),404);
        $data=null;
        if($request->isMethod('PUT')){
            $data=$request->validate([
                'channel'=>['required','in:cardapio,balcao'],
                'method'=>['required','in:dinheiro,cartao_credito,cartao_debito,pix_manual,pix_maquininha,pix_online,credito_online,debito_online,voucher_alelo,voucher_pluxee,voucher_vr,voucher_ticket'],
                'adjustment_bps'=>['required','integer','min:-9999','max:10000'],
                'processing_cost_bps'=>['required','integer','min:0','max:10000'],
                'expected_revision'=>['required','integer','min:0','max:2147483647'],
            ]);
            if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
            if(str_starts_with($data['method'],'voucher_')&&(int)$data['adjustment_bps']!==0)throw ValidationException::withMessages(['adjustment_bps'=>'Vale-refeição permite apenas custo interno.']);
        }
        try{return response()->json(['data'=>$pricing->run($request->attributes->get('core_session'),$store,$data)])->header('Cache-Control','no-store');}
        catch(QueryException $e){
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>match($s){'42501'=>'forbidden','P0001','22023'=>'operation_not_allowed',default=>'temporarily_unavailable'}],match($s){'42501'=>403,'P0001','22023'=>409,default=>503})->header('Cache-Control','no-store');
        }catch(JsonException|UnexpectedValueException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }
}
