<?php
declare(strict_types=1);

$method = request_method();
if ($method !== 'GET') {
    json_response(['ok' => false, 'error' => 'Method not allowed'], 405);
}

require_auth();

function weather_code_label(int $code): string
{
    if ($code === 0) return 'jasno';
    if (in_array($code, [1, 2, 3], true)) return 'oblacno';
    if (in_array($code, [45, 48], true)) return 'mlha';
    if (in_array($code, [51, 53, 55, 56, 57], true)) return 'mrholeni';
    if (in_array($code, [61, 63, 65, 66, 67, 80, 81, 82], true)) return 'dest';
    if (in_array($code, [71, 73, 75, 77, 85, 86], true)) return 'snih';
    if (in_array($code, [95, 96, 99], true)) return 'bourka';
    return 'aktualni pocasi';
}

function weather_fallback(): array
{
    return [
        'place' => 'Brno',
        'summary' => 'predpoved neni dostupna',
        'temperature' => null,
        'wind_speed' => null,
        'date' => date('Y-m-d'),
    ];
}

$lat = isset($_GET['lat']) ? (float)$_GET['lat'] : 49.1951;
$lng = isset($_GET['lng']) ? (float)$_GET['lng'] : 16.6068;
$query = http_build_query([
    'latitude' => $lat,
    'longitude' => $lng,
    'current' => 'temperature_2m,weather_code,wind_speed_10m',
    'daily' => 'weather_code,temperature_2m_max,temperature_2m_min',
    'forecast_days' => 1,
    'timezone' => 'Europe/Prague',
]);
$context = stream_context_create(['http' => ['timeout' => 3]]);
$raw = @file_get_contents('https://api.open-meteo.com/v1/forecast?' . $query, false, $context);
if ($raw === false) {
    json_response(['ok' => true, 'data' => weather_fallback()]);
}

$payload = json_decode($raw, true);
if (!is_array($payload)) {
    json_response(['ok' => true, 'data' => weather_fallback()]);
}

$current = is_array($payload['current'] ?? null) ? $payload['current'] : [];
$code = (int)($current['weather_code'] ?? 0);
json_response([
    'ok' => true,
    'data' => [
        'place' => 'Brno',
        'summary' => weather_code_label($code),
        'temperature' => isset($current['temperature_2m']) ? (float)$current['temperature_2m'] : null,
        'wind_speed' => isset($current['wind_speed_10m']) ? (float)$current['wind_speed_10m'] : null,
        'weather_code' => $code,
        'date' => date('Y-m-d'),
    ],
]);
