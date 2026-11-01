-- Company-scoped monitoring data. Retention: 30 days for location_history.
CREATE TABLE IF NOT EXISTS locations (
 company_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 lat DECIMAL(10,7) NOT NULL,
 lng DECIMAL(10,7) NOT NULL,
 accuracy DECIMAL(10,2) NULL,
 recorded_at VARCHAR(24) NOT NULL,
 PRIMARY KEY(company_id,user_id),
 FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS location_history (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 lat DECIMAL(10,7) NOT NULL,
 lng DECIMAL(10,7) NOT NULL,
 accuracy DECIMAL(10,2) NULL,
 recorded_at VARCHAR(24) NOT NULL,
 KEY idx_location_recent(company_id,user_id,recorded_at),
 FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitoring_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 attendance_id BIGINT UNSIGNED NOT NULL,
 kind ENUM('gps_off','gps_on','internet_off','internet_on') NOT NULL,
 recorded_at VARCHAR(24) NOT NULL,
 KEY idx_monitor_user(company_id,user_id,recorded_at),
 FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,attendance_id) REFERENCES attendance(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
