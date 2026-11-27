<?php
namespace App\Http\Controllers;
use App\Services\OwnOrderActions;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
final class OwnOrderActionsController
{
    public function __invoke(Request $request,string $store,string $order,OwnOrderActions $actions): JsonResponse
    {
        abort_unless(config('pitacco.actions_enabled'),404);
        $data=$request->validate([
            'action'=>['required','string','in:accept,ready,complete_pickup,reject'],
            'reason'=>['required_if:action,reject','nullable','string','min:3','max:240'],
        ]);
        try {
            $result=$actions->run($request->attributes->get('core_session'),$store,$order,$data['action'],$data['reason']??null);
        } catch(QueryException $error) {
            $state=$error->errorInfo[0]??'';
            return response()->json(['error'=>$state==='P0001'?'transition_not_allowed':($state==='42501'?'forbidden':'temporarily_unavailable')],match($state){'P0001'=>409,'42501'=>403,default=>503});
        }
        return response()->json(['data'=>$result]);
    }
}
