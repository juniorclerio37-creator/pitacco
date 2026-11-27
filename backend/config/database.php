<?php
$base = [
    'driver' => 'pgsql',
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', '5432'),
    'database' => env('DB_DATABASE', 'pitacco_core_dev'),
    'charset' => 'utf8',
    'prefix' => '',
    'search_path' => 'public',
    'sslmode' => env('DB_SSLMODE', 'prefer'),
];
return [
    'default' => 'pgsql',
    'connections' => [
        'pgsql' => $base + ['username'=>env('DB_USERNAME','pitacco_core_app'),'password'=>env('DB_PASSWORD')],
        'core_wallet' => $base + ['username'=>env('CORE_WALLET_DB_USERNAME','pitacco_core_wallet'),'password'=>env('CORE_WALLET_DB_PASSWORD')],
        'core_profile' => $base + ['username'=>env('CORE_PROFILE_DB_USERNAME','pitacco_core_profile'),'password'=>env('CORE_PROFILE_DB_PASSWORD')],
        'core_fiado_manage' => $base + ['username'=>env('CORE_FIADO_MANAGE_DB_USERNAME','pitacco_core_fiado_manage'),'password'=>env('CORE_FIADO_MANAGE_DB_PASSWORD')],
        'core_fiado_statement' => $base + ['username'=>env('CORE_FIADO_STATEMENT_DB_USERNAME','pitacco_core_fiado_statement'),'password'=>env('CORE_FIADO_STATEMENT_DB_PASSWORD')],
        'core_fiado_read' => $base + ['username'=>env('CORE_FIADO_DB_USERNAME','pitacco_core_fiado_read'),'password'=>env('CORE_FIADO_DB_PASSWORD')],
        'core_tracking' => $base + ['username'=>env('CORE_TRACKING_DB_USERNAME','pitacco_core_tracking'),'password'=>env('CORE_TRACKING_DB_PASSWORD')],
        'core_checkout' => $base + ['username'=>env('CORE_CHECKOUT_DB_USERNAME','pitacco_core_checkout'),'password'=>env('CORE_CHECKOUT_DB_PASSWORD')],
        'core_actions' => $base + ['username'=>env('CORE_ACTIONS_DB_USERNAME','pitacco_core_actions'),'password'=>env('CORE_ACTIONS_DB_PASSWORD')],
        'core_orders' => $base + ['username'=>env('CORE_ORDERS_DB_USERNAME','pitacco_core_orders'),'password'=>env('CORE_ORDERS_DB_PASSWORD')],
        'core_auth' => $base + ['username'=>env('CORE_AUTH_DB_USERNAME','pitacco_core_auth'),'password'=>env('CORE_AUTH_DB_PASSWORD')],
        'menu' => $base + ['username'=>env('MENU_DB_USERNAME','pitacco_core_menu'),'password'=>env('MENU_DB_PASSWORD')],
    ],
    'redis' => [
        'client' => 'phpredis',
        'options' => ['prefix' => env('CORE_REDIS_PREFIX','pitacco_core:')],
        'default' => ['host'=>env('REDIS_HOST','127.0.0.1'),'password'=>env('REDIS_PASSWORD'),'port'=>env('REDIS_PORT',6379),'database'=>0,'timeout'=>2,'read_timeout'=>2],
        'cache' => ['host'=>env('REDIS_HOST','127.0.0.1'),'password'=>env('REDIS_PASSWORD'),'port'=>env('REDIS_PORT',6379),'database'=>1,'timeout'=>2,'read_timeout'=>2],
    ],
];
