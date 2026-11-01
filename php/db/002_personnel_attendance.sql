-- Apply only after 001_auth_foundation.sql to a dedicated Hozoryar database.
CREATE TABLE IF NOT EXISTS company_settings (
 company_id BIGINT UNSIGNED PRIMARY KEY,
 map_provider ENUM('osm','neshan') NOT NULL DEFAULT 'osm',
 neshan_api_key VARCHAR(200) NULL,
 sms_provider ENUM('disabled','kavenegar') NOT NULL DEFAULT 'disabled',
 sms_api_key VARCHAR(200) NULL,
 require_location TINYINT(1) NOT NULL DEFAULT 0,
 enforce_shift_window TINYINT(1) NOT NULL DEFAULT 0,
 geofence_lat DECIMAL(10,7) NULL,
 geofence_lng DECIMAL(10,7) NULL,
 geofence_radius_m INT NOT NULL DEFAULT 200,
 approval_steps TINYINT NOT NULL DEFAULT 1,
 annual_leave_minutes INT NOT NULL DEFAULT 12480,
 features_json TEXT NOT NULL,
 FOREIGN KEY(company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS zones (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(100) NOT NULL,
 requires_substitute TINYINT(1) NOT NULL DEFAULT 0,
 UNIQUE KEY uq_zone_name(company_id,name),
 UNIQUE KEY uq_zone_company_id(company_id,id),
 FOREIGN KEY(company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users ADD COLUMN zone_id BIGINT UNSIGNED NULL,
 ADD COLUMN can_be_substitute TINYINT(1) NOT NULL DEFAULT 0,
 ADD CONSTRAINT fk_user_zone FOREIGN KEY(company_id,zone_id) REFERENCES zones(company_id,id);

CREATE TABLE IF NOT EXISTS shifts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(120) NOT NULL,
 start_time CHAR(5) NOT NULL,
 end_time CHAR(5) NOT NULL,
 duty_minutes SMALLINT UNSIGNED NOT NULL,
 daily_ot_cap SMALLINT UNSIGNED NOT NULL DEFAULT 27,
 schedule_kind ENUM('fixed','weekly','rotating','rotation_segments','floating','advanced','auto') NOT NULL DEFAULT 'fixed',
 schedule_json TEXT NOT NULL,
 UNIQUE KEY uq_shift_company_id(company_id,id),
 FOREIGN KEY(company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assignments (
 company_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 shift_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(company_id,user_id),
 FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,shift_id) REFERENCES shifts(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 checked_in_at VARCHAR(24) NOT NULL,
 checked_out_at VARCHAR(24) NULL,
 lat DECIMAL(10,7) NULL,
 lng DECIMAL(10,7) NULL,
 accuracy DECIMAL(10,2) NULL,
 KEY ix_attendance_user(company_id,user_id,checked_in_at),
 UNIQUE KEY uq_attendance_company_id(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_events (
 company_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 event_id VARCHAR(64) NOT NULL,
 action ENUM('in','out') NOT NULL,
 attendance_id BIGINT UNSIGNED NOT NULL,
 recorded_at VARCHAR(24) NOT NULL,
 PRIMARY KEY(company_id,user_id,event_id),
 FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,attendance_id) REFERENCES attendance(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 action VARCHAR(80) NOT NULL,
 target_type VARCHAR(80) NOT NULL,
 target_id BIGINT UNSIGNED NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_audit_company(company_id,created_at),
 FOREIGN KEY(company_id,actor_user_id) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
