<?php
// Copy to php/config.php (outside DocumentRoot); never commit real credentials.
return [
    'db_host' => getenv('HOZORYAR_DB_HOST') ?: 'localhost',
    'db_port' => getenv('HOZORYAR_DB_PORT') ?: '3306',
    'db_name' => getenv('HOZORYAR_DB_NAME') ?: '',
    'db_user' => getenv('HOZORYAR_DB_USER') ?: '',
    'db_pass' => getenv('HOZORYAR_DB_PASS') ?: '',
];
