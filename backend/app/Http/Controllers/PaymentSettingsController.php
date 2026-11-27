<?php
namespace App\Http\Controllers;
use App\Services\PaymentSettings;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use JsonException;
use UnexpectedValueException;
final class PaymentSettingsController
{
    private const METHODS='in:dinheiro,cartao_entrega,cartao_credito,cartao_debito,pix_manual,pix_maquininha,voucher_alelo,voucher_pluxee,voucher_vr,voucher_ticket';
    public function __invoke(Request $request,string $store,PaymentSettings $settings): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.payment_settings_enabled'),404);
        $data=null;
        if($request->isMethod('PUT')){
            $data=$request->validate([
                'payment_methods'=>['required','array','list','min:1','max:10'],
                'payment_methods.*'=>['required','string','distinct:strict',self::METHODS],
                'pdv_payment_methods'=>['required','array','list','min:1','max:10'],
                'pdv_payment_methods.*'=>['required','string','distinct:strict',self::METHODS],
                'pix_instructions'=>['nullable','string','max:1000'],
            ]);
            if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
            if((in_array('pix_manual',$data['payment_methods'],true)||in_array('pix_manual',$data['pdv_payment_methods'],true))&&mb_strlen(trim($data['pix_instructions']??''))<3)throw ValidationException::withMessages(['pix_instructions'=>'Informe instruções do Pix manual.']);
        }
        try{return response()->json(['data'=>$settings->run($request->attributes->get('core_session'),$store,$data)])->header('Cache-Control','no-store');}
        catch(QueryException $e){
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>match($s){'42501'=>'forbidden','P0001','22023'=>'operation_not_allowed',default=>'temporarily_unavailable'}],match($s){'42501'=>403,'P0001','22023'=>409,default=>503})->header('Cache-Control','no-store');
        }catch(JsonException|UnexpectedValueException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }
}
