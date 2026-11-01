-- Install after 003_requests.sql; only in Hozoryar's dedicated database.
CREATE TABLE IF NOT EXISTS company_holidays (
 company_id BIGINT UNSIGNED NOT NULL,
 work_date DATE NOT NULL,
 title VARCHAR(120) NOT NULL,
 PRIMARY KEY(company_id,work_date),
 FOREIGN KEY(company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS official_calendar_years (
 jalali_year SMALLINT UNSIGNED PRIMARY KEY,
 payload_json MEDIUMTEXT NOT NULL,
 fetched_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
