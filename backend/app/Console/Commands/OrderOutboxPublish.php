<?php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Pusher\Pusher;
use Throwable;

final class OrderOutboxPublish extends Command
{
    protected $signature = 'pitacco:outbox-publish';
    protected $description = 'Publish one pending order invalidation (isolated testing only)';

    public function handle(): int
    {
        if (!app()->environment('testing') || !config('pitacco.realtime_enabled') || !config('pitacco.outbox_publish_enabled') || !class_exists(Pusher::class)) {
            $this->error('Transmissor experimental desativado.');
            return self::FAILURE;
        }
        $key=config('core_realtime.key');
        $secret=config('core_realtime.secret');
        if (!is_string($key)||$key===''||!is_string($secret)||strlen($secret)<32) {
            $this->error('Configuração indisponível.');
            return self::FAILURE;
        }
        try {
            $p=new Pusher($key,$secret,'pitacco-core-ci',[
                'host'=>'127.0.0.1','port'=>8092,'scheme'=>'http','useTLS'=>false,'timeout'=>3,
            ]);
            $db=DB::connection('core_outbox');
            $sent=$db->transaction(function () use ($db,$p) {
                $db->statement("set local statement_timeout = '5s'");
                $db->statement("set local lock_timeout = '2s'");
                $db->statement("set local idle_in_transaction_session_timeout = '8s'");
                $event=$db->selectOne("select id,store_id,resource from core_auth.order_invalidation_fixture where published_at is null order by created_at,id limit 1 for update skip locked");
                if (!$event) return false;
                if ($event->resource!=='orders') throw new \RuntimeException('invalid resource');
                $p->trigger('private-pitacco.store.'.$event->store_id,'pitacco.invalidate',['resource'=>'orders','event_id'=>$event->id]);
                $changed=$db->update('update core_auth.order_invalidation_fixture set published_at=clock_timestamp() where id=cast(? as uuid) and published_at is null',[$event->id]);
                if ($changed!==1) throw new \RuntimeException('ack failed');
                return true;
            });
            $this->line($sent?'published=1':'published=0');
            return self::SUCCESS;
        } catch(Throwable $e) {
            // A transport error or uncertain commit must not expose credentials or payload.
            $this->error('Publicação não confirmada.');
            return self::FAILURE;
        }
    }
}
