<?php
namespace App\Http\Controllers;
use App\Services\FiadoManagement;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
final class FiadoManagementController
{
    public function __invoke(Request $request,string $store,FiadoManagement $service): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.fiado_manage_enabled'),404);
        $data=$request->validate(['action'=>['required','in:toggle,save_customer'],'enabled'=>['required','boolean']]);
        if($data['action']==='save_customer'){
            $data=$data+$request->validate([
                'name'=>['required','string','min:2','max:120'],
                'phone'=>['required','string','regex:/\A[0-9]{10,11}\z/'],
                'limit'=>['required','numeric','decimal:0,2','min:0','max:100000'],
                'due_days'=>['required','integer','min:1','max:365'],
                'approval_mode'=>['required','in:automatic,manual'],
                'block_overdue'=>['required','boolean'],
            ]);
        }
        if(array_diff(array_keys($request->all()),array_keys($data))) throw ValidationException::withMessages(['action'=>'Campos não suportados.']);
        try{
            return response()->json(['data'=>$service->run($request->attributes->get('core_session'),$store,$data)])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $state=$e->errorInfo[0]??'';
            return response()->json(['error'=>match($state){'42501'=>'forbidden','22023','P0001'=>'operation_not_allowed',default=>'temporarily_unavailable'}],match($state){'42501'=>403,'22023','P0001'=>409,default=>503})->header('Cache-Control','no-store');
        }
    }
}
