-- Apply after 006_work_archives.sql in Hozoryar's dedicated database.
CREATE TABLE IF NOT EXISTS platform_admins (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 username VARCHAR(60) NOT NULL UNIQUE,
 name VARCHAR(160) NOT NULL,
 password_hash VARCHAR(255) NOT NULL,
 active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_sessions (
 token_hash CHAR(64) PRIMARY KEY,
 admin_id BIGINT UNSIGNED NOT NULL,
 expires_at DATETIME NOT NULL,
 KEY idx_platform_sessions_expiry(expires_at),
 FOREIGN KEY(admin_id) REFERENCES platform_admins(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_corrections (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 attendance_id BIGINT UNSIGNED NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 old_in VARCHAR(24) NOT NULL,
 old_out VARCHAR(24) NOT NULL,
 new_in VARCHAR(24) NOT NULL,
 new_out VARCHAR(24) NOT NULL,
 reason VARCHAR(500) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_corrections_attendance(company_id,attendance_id,id),
 FOREIGN KEY(company_id,attendance_id) REFERENCES attendance(company_id,id),
 FOREIGN KEY(company_id,actor_user_id) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
