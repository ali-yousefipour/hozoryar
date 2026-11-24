CREATE TABLE IF NOT EXISTS attendance_devices (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 zone_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(100) NOT NULL,
 model VARCHAR(100) NULL,
 ip_address VARCHAR(45) NULL,
 port SMALLINT UNSIGNED NULL,
 token_hash CHAR(64) NOT NULL,
 enabled TINYINT(1) NOT NULL DEFAULT 1,
 last_seen_at DATETIME NULL,
 UNIQUE KEY uq_device_zone_name(company_id,zone_id,name),
 FOREIGN KEY(company_id,zone_id) REFERENCES zones(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
