-- Requires 001..005; financial confirmation is minutes-only and not legal payroll.
CREATE TABLE IF NOT EXISTS work_month_archives (
 company_id BIGINT UNSIGNED NOT NULL,
 month VARCHAR(9) NOT NULL,
 snapshot_json LONGTEXT NOT NULL,
 created_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,month),
 FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_month_reviews (
 company_id BIGINT UNSIGNED NOT NULL,
 month VARCHAR(9) NOT NULL,
 status ENUM('pending_review','reviewed','approved') NOT NULL DEFAULT 'pending_review',
 reviewer_user_id BIGINT UNSIGNED NULL,
 reviewed_at VARCHAR(24) NULL,
 approver_user_id BIGINT UNSIGNED NULL,
 approved_at VARCHAR(24) NULL,
 PRIMARY KEY(company_id,month),
 FOREIGN KEY(company_id,month) REFERENCES work_month_archives(company_id,month),
 FOREIGN KEY(company_id,reviewer_user_id) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,approver_user_id) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_month_finance (
 company_id BIGINT UNSIGNED NOT NULL,
 month VARCHAR(9) NOT NULL,
 snapshot_sha256 CHAR(64) NOT NULL,
 include_surplus TINYINT(1) NOT NULL DEFAULT 0,
 payroll_json LONGTEXT NOT NULL,
 confirmed_by BIGINT UNSIGNED NOT NULL,
 confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,month),
 FOREIGN KEY(company_id,month) REFERENCES work_month_archives(company_id,month),
 FOREIGN KEY(company_id,confirmed_by) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
