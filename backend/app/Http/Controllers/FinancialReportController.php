<?php
namespace App\Http\Controllers;
use App\Services\FinancialReport;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use DateTimeImmutable;
use JsonException;
use UnexpectedValueException;
final class FinancialReportController
{
    public function __invoke(Request $request,string $store,FinancialReport $report): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.financial_report_enabled'),404);
        $data=$request->validate(['start'=>['required','date_format:Y-m-d'],'end'=>['required','date_format:Y-m-d','after_or_equal:start']]);
        if((new DateTimeImmutable($data['start']))->diff(new DateTimeImmutable($data['end']))->days>365)throw ValidationException::withMessages(['end'=>'Informe um período de até 366 dias.']);
        try{
            $rows=$report->read($request->attributes->get('core_session'),$store,$data['start'],$data['end']);
            return response()->json(['data'=>['start'=>$data['start'],'end'=>$data['end'],'timezone'=>'America/Sao_Paulo','metrics'=>$rows]])->header('Cache-Control','no-store');
        }catch(QueryException|JsonException|UnexpectedValueException){
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }
}
