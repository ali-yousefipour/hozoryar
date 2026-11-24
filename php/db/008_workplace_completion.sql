-- Independent workplace GPS and auditable completion of an open attendance.
ALTER TABLE zones
 ADD COLUMN geofence_lat DECIMAL(10,7) NULL,
 ADD COLUMN geofence_lng DECIMAL(10,7) NULL,
 ADD COLUMN geofence_radius_m INT UNSIGNED NOT NULL DEFAULT 200;
ALTER TABLE attendance_corrections MODIFY old_out VARCHAR(24) NULL;
