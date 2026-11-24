<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
$root = dirname(__DIR__, 2);
$output = $root . '/data/hozoryar-shared-host.zip';
if (!is_dir(dirname($output))) mkdir(dirname($output), 0750, true);
$zip = new ZipArchive();
if ($zip->open($output, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
    fwrite(STDERR, "Cannot create deployment archive.\n"); exit(1);
}
foreach (['php/app','php/lib','php/db','php/cli','web','branding','docs'] as $directory) {
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root.'/'.$directory, FilesystemIterator::SKIP_DOTS));
    foreach ($files as $file) {
        if (!$file->isFile() || $file->isLink()) continue;
        $relative = str_replace('\\','/',substr($file->getPathname(),strlen($root)+1));
        $zip->addFile($file->getPathname(),'hozoryar/'.$relative);
    }
}
$zip->addFile($root.'/php/config.example.php','hozoryar/php/config.example.php');
$zip->addFile($root.'/docs/SHARED_HOST_SETUP.md','INSTALL.md');
$zip->addFromString('public_html/index.php', "<?php\ndeclare(strict_types=1);\nrequire dirname(__DIR__) . '/hozoryar/php/app/index.php';\n");
$zip->addFile($root.'/php/app/.htaccess','public_html/.htaccess');
$zip->addFromString('hozoryar/.htaccess', "Require all denied\n");
$zip->close();
echo "Deployment package: $output\n";
