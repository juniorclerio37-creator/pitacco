<?php
// Experimental only: no application or public listener in production.
return [
    'default'=>'reverb',
    'servers'=>[
        'reverb'=>[
            'host'=>'127.0.0.1','port'=>8092,'path'=>'','hostname'=>'127.0.0.1',
            'options'=>['tls'=>[]],'max_request_size'=>10000,
            'scaling'=>['enabled'=>false,'channel'=>'pitacco-core-ci','server'=>[]],
            'pulse_ingest_interval'=>15,'telescope_ingest_interval'=>15,
        ],
    ],
    'apps'=>[
        'provider'=>'config',
        'apps'=>env('APP_ENV') === 'testing' && env('PITACCO_REALTIME_ENABLED', false) === true ? [[
            'key'=>env('PITACCO_REALTIME_KEY'),
            'secret'=>env('PITACCO_REALTIME_SECRET'),
            'app_id'=>'pitacco-core-ci',
            'options'=>['host'=>'127.0.0.1','port'=>8092,'scheme'=>'http','useTLS'=>false],
            'allowed_origins'=>['pitacco.test'],
            'ping_interval'=>60,'activity_timeout'=>30,
            'max_connections'=>20,'max_message_size'=>4096,'max_channels_per_connection'=>5,
            'accept_client_events_from'=>'none',
            'rate_limiting'=>['enabled'=>true,'max_attempts'=>60,'decay_seconds'=>60,'terminate_on_limit'=>true],
        ]] : [],
    ],
];
