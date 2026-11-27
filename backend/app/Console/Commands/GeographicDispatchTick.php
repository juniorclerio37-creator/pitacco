<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

final class GeographicDispatchTick extends Command
{
    protected $signature = 'pitacco:dispatch-tick';
    protected $description = 'Execute one isolated geographic dispatch cycle (testing only)';

    public function handle(): int
    {
        if (!app()->environment('testing') || !config('pitacco.auto_dispatch_enabled')) {
            $this->error('Alocação automática experimental desativada.');
            return self::FAILURE;
        }

        try {
            $db = DB::connection('core_auto_dispatch');
            $assigned = $db->transaction(function () use ($db) {
                $db->statement("set local statement_timeout = '5s'");
                $db->statement("set local lock_timeout = '2s'");
                return (bool) $db->selectOne('select core_auth.geographic_dispatch_tick_fixture() as assigned')->assigned;
            });
        } catch (QueryException $e) {
            // Never print SQL, coordinates, IDs or credentials.
            $this->error('Ciclo não confirmado; operação indisponível.');
            return self::FAILURE;
        }
        $this->line($assigned ? 'assigned=1' : 'assigned=0');
        return self::SUCCESS;
    }
}
