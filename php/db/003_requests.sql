-- Install after 002_personnel_attendance.sql in the dedicated Hozoryar database.
CREATE TABLE IF NOT EXISTS personnel_requests (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 type ENUM('annual_leave','sick_leave','unpaid_leave','mission') NOT NULL,
 work_date DATE NOT NULL,
 end_date DATE NOT NULL,
 unit ENUM('hourly','daily') NOT NULL DEFAULT 'hourly',
 minutes SMALLINT UNSIGNED NOT NULL,
 description VARCHAR(500) NOT NULL DEFAULT '',
 status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
 substitute_user_id BIGINT UNSIGNED NULL,
 decided_by BIGINT UNSIGNED NULL,
 decided_at VARCHAR(24) NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_request_company_id(company_id,id),
 KEY idx_requests_substitute(company_id,substitute_user_id,status,work_date,end_date),
 KEY idx_requests_user(company_id,user_id,type,status,work_date,end_date),
 FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,substitute_user_id) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,decided_by) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS request_decisions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 request_id BIGINT UNSIGNED NOT NULL,
 stage TINYINT UNSIGNED NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 outcome ENUM('approved','rejected') NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_request_stage(company_id,request_id,stage),
 FOREIGN KEY(company_id,request_id) REFERENCES personnel_requests(company_id,id),
 FOREIGN KEY(company_id,actor_user_id) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS substitute_assignments (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id BIGINT UNSIGNED NOT NULL,
 request_id BIGINT UNSIGNED NOT NULL,
 substitute_user_id BIGINT UNSIGNED NOT NULL,
 absent_user_id BIGINT UNSIGNED NOT NULL,
 from_date DATE NOT NULL,
 to_date DATE NOT NULL,
 UNIQUE KEY uq_assignment_request(company_id,request_id),
 KEY idx_substitute_period(company_id,substitute_user_id,from_date,to_date),
 FOREIGN KEY(company_id,request_id) REFERENCES personnel_requests(company_id,id),
 FOREIGN KEY(company_id,substitute_user_id) REFERENCES users(company_id,id),
 FOREIGN KEY(company_id,absent_user_id) REFERENCES users(company_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
