<?php

declare(strict_types=1);

/*
 * Gemockter Google-Token-Endpunkt für die PHP-Tests (php -S … api/tests/google-mock.php).
 *
 * Der «code» ist base64url-kodiertes JSON {claims, challenge}: Der Mock prüft wie Google
 * grant_type, client_id/-secret, redirect_uri und PKCE (S256 des code_verifier = challenge)
 * und antwortet mit einem id_token aus den claims.
 */

header('Content-Type: application/json');

$fehler = static function (string $grund): void {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_grant', 'error_description' => $grund]);
};

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) !== '/token') {
    http_response_code(404);
    return;
}
$p = $_POST;
$roh = base64_decode(strtr((string) ($p['code'] ?? ''), '-_', '+/'), true);
$code = $roh === false ? null : json_decode($roh, true);
if (!is_array($code)) {
    $fehler('code');
    return;
}
$challenge = rtrim(strtr(base64_encode(hash('sha256', (string) ($p['code_verifier'] ?? ''), true)), '+/', '-_'), '=');
$pruefungen = [
    'grant_type' => ($p['grant_type'] ?? '') === 'authorization_code',
    'client_id' => ($p['client_id'] ?? '') === 'client-123.apps.googleusercontent.com',
    'client_secret' => ($p['client_secret'] ?? '') === 'secret-xyz',
    'redirect_uri' => ($p['redirect_uri'] ?? '') === 'http://localhost:4321/api/auth/google/callback',
    'pkce' => hash_equals((string) ($code['challenge'] ?? ''), $challenge),
];
foreach ($pruefungen as $was => $ok) {
    if (!$ok) {
        $fehler($was);
        return;
    }
}
$b64 = static fn (string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
echo json_encode([
    'access_token' => 'ya29.test',
    'token_type' => 'Bearer',
    'expires_in' => 3599,
    'id_token' => $b64('{"alg":"RS256","typ":"JWT"}') . '.' . $b64(json_encode($code['claims'])) . '.c2ln',
]);
