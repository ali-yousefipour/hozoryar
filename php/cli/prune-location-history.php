<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit;}
require_once dirname(__DIR__).'/lib/Db.php';

// Run by a shared-host cron job once daily, even when no employee reports locations.
$cutoff=gmdate('Y-m-d\TH:i:s',time()-30*86400).'.000Z';
$count=Db::run('DELETE FROM location_history WHERE recorded_at<?',[$cutoff]);
echo "Hozoryar location history retention processed ($count rows).\n";
